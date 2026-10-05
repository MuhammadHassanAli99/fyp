import 'dart:async';
import 'dart:convert';
import 'dart:io';

import 'package:flutter/foundation.dart';
import 'package:flutter/material.dart';
import 'package:geolocator/geolocator.dart';
import 'package:go_router/go_router.dart';
import 'package:image_picker/image_picker.dart';
import 'package:path_provider/path_provider.dart';
import 'package:record/record.dart';
import 'package:share_plus/share_plus.dart';
import 'package:signals_flutter/signals_flutter.dart'
    hide AsyncState, AsyncLoading, AsyncData, AsyncError;
import 'package:uuid/uuid.dart';

import '../../app/router.dart';
import '../../app/theme/app_colors.dart';
import '../../core/auth/guest_feature.dart';
import '../../core/di/service_locator.dart';
import '../../core/result/async_state.dart';
import '../../core/storage/prefs_storage.dart';
import '../../data/models/filter_models.dart';
import '../../data/models/listing_model.dart';
import '../../data/models/search_models.dart';
import '../../shared/extensions/context_extensions.dart';
import '../../shared/widgets/app_scaffold.dart';
import '../../shared/widgets/listing_card.dart';
import '../filters/filter_panel.dart';
import '../filters/filter_state.dart';
import '../advertisements/ad_slot.dart';
import 'search_store.dart';

class SearchScreen extends StatefulWidget {
  const SearchScreen({
    super.key,
    this.initialQuery,
    this.startNearby = false,
    this.initialParams = const {},
  });

  final String? initialQuery;
  final bool startNearby;
  final Map<String, String> initialParams;

  @override
  State<SearchScreen> createState() => _SearchScreenState();
}

class _SearchScreenState extends State<SearchScreen> {
  late final SearchStore _store;
  final _controller = TextEditingController();
  final _focus = FocusNode();
  final _recorder = AudioRecorder();
  Timer? _debounce;
  bool _recording = false;
  List<FilterDefinition> _definitions = const [];

  @override
  void initState() {
    super.initState();
    final sl = ServiceLocator.instance;
    _store = SearchStore(sl.searchRepository, sl.settingsRepository);
    _store.filterState = FilterState.fromQueryParameters(
      widget.initialParams,
      marketplace: sl.settingsRepository.marketplaceCode,
    );
    final initial = widget.initialQuery?.trim();
    if (initial != null && initial.isNotEmpty) {
      _controller.text = initial;
      _store.query.value = initial;
    } else {
      _restoreLastSearch();
    }
    _store.nearby.value = widget.startNearby;
    _store.loadDiscovery();
    sl.filtersRepository.definitions(marketplace: _store.marketplace).then((result) {
      result.when(
        success: (items) {
          if (mounted) setState(() => _definitions = items);
        },
        failure: (_, _) {},
      );
    });
    if (widget.startNearby) {
      _enableNearby();
    } else if (initial != null && initial.isNotEmpty) {
      _runAndPersist();
    } else if (_store.filterState.isEmpty) {
      _focus.requestFocus();
    } else {
      _runAndPersist();
    }
  }

  @override
  void dispose() {
    _debounce?.cancel();
    _controller.dispose();
    _focus.dispose();
    _recorder.dispose();
    super.dispose();
  }

  void _onQueryChanged(String value) {
    _store.query.value = value;
    _debounce?.cancel();
    _debounce = Timer(const Duration(milliseconds: 180), () {
      _store.suggest(value);
    });
  }

  void _restoreLastSearch() {
    final raw = ServiceLocator.instance.prefs.getString(PrefsKeys.lastPublicSearch);
    if (raw == null || raw.isEmpty) return;
    try {
      final decoded = jsonDecode(raw);
      if (decoded is! Map) return;
      final map = Map<String, dynamic>.from(decoded);
      final q = map['q']?.toString();
      if (q != null && q.isNotEmpty && _controller.text.isEmpty) {
        _controller.text = q;
        _store.query.value = q;
      }
      final params = <String, String>{};
      map.forEach((key, value) {
        if (key == 'q' || value == null) return;
        params[key] = value.toString();
      });
      if (params.isNotEmpty) {
        _store.applyFilters(
          FilterState.fromQueryParameters(params, marketplace: _store.marketplace),
        );
      }
    } catch (_) {}
  }

  Future<void> _runAndPersist() async {
    await _store.run();
    final params = {
      if (_store.query.value.trim().isNotEmpty) 'q': _store.query.value.trim(),
      ..._store.filterState.toQueryParameters(),
    };
    await ServiceLocator.instance.prefs.setString(
      PrefsKeys.lastPublicSearch,
      jsonEncode(params),
    );
  }

  Future<void> _openFilters() async {
    final next = await showFilterPanel(
      context,
      initial: _store.filterState.copy(),
      marketplace: _store.marketplaceParam ?? _store.marketplace,
    );
    if (next == null) return;
    _store.applyFilters(next);
    await _runAndPersist();
    if (!mounted) return;
    final uri = Uri(
      path: AppRoutes.search,
      queryParameters: {
        if (_store.query.value.trim().isNotEmpty) 'q': _store.query.value.trim(),
        ..._store.filterState.toQueryParameters(),
      },
    );
    context.go(uri.toString());
  }

  Future<void> _share() async {
    final uri = Uri(
      path: AppRoutes.search,
      queryParameters: {
        if (_store.query.value.trim().isNotEmpty) 'q': _store.query.value.trim(),
        ..._store.filterState.toQueryParameters(),
      },
    );
    await SharePlus.instance.share(ShareParams(text: uri.toString()));
  }

  Future<void> _enableNearby() async {
    try {
      final enabled = await Geolocator.isLocationServiceEnabled();
      if (!enabled) {
        if (mounted) {
          ScaffoldMessenger.of(context).showSnackBar(
            const SnackBar(content: Text('Turn on location to search nearby.')),
          );
        }
        return;
      }
      var permission = await Geolocator.checkPermission();
      if (permission == LocationPermission.denied) {
        permission = await Geolocator.requestPermission();
      }
      if (permission == LocationPermission.denied ||
          permission == LocationPermission.deniedForever) {
        if (mounted) {
          ScaffoldMessenger.of(context).showSnackBar(
            const SnackBar(content: Text('Location permission is required for nearby search.')),
          );
        }
        return;
      }
      final position = await Geolocator.getCurrentPosition(
        locationSettings: const LocationSettings(
          accuracy: LocationAccuracy.medium,
          timeLimit: Duration(seconds: 8),
        ),
      );
      _store.lat.value = position.latitude;
      _store.lng.value = position.longitude;
      _store.nearby.value = true;
      await _store.run();
    } catch (e) {
      if (!mounted) return;
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(content: Text('Could not read location: $e')),
      );
    }
  }

  Future<void> _save() async {
    final sl = ServiceLocator.instance;
    if (!sl.guestFeatureGuard.allows(GuestFeature.saveSearch)) {
      context.push(AppRoutes.login);
      return;
    }
    final error = await _store.saveCurrent();
    if (!mounted) return;
    ScaffoldMessenger.of(context).showSnackBar(
      SnackBar(
        content: Text(
          error ??
              'Search saved. You will be notified when matching listings are published.',
        ),
      ),
    );
  }

  Future<void> _pickImage() async {
    final sl = ServiceLocator.instance;
    if (!sl.authRepository.hasActiveSession || sl.authRepository.isGuest) {
      context.push(AppRoutes.login);
      return;
    }
    try {
      final picked = await ImagePicker().pickImage(
        source: ImageSource.gallery,
        imageQuality: 85,
        maxWidth: 1600,
      );
      if (picked == null) return;
      final bytes = await picked.readAsBytes();
      final uploaded = await sl.mediaUploadService.uploadBytes(
        bytes: bytes,
        purpose: 'search_image',
        mimeType: picked.mimeType ?? 'image/jpeg',
        filename: picked.name,
      );
      final result = await sl.searchRepository.image(imageUrl: uploaded.fileUrl);
      if (!mounted) return;
      result.when(
        success: (page) {
          if (page.disclaimer != null && page.disclaimer!.isNotEmpty) {
            ScaffoldMessenger.of(context).showSnackBar(
              SnackBar(content: Text(page.disclaimer!)),
            );
          }
          _store.applyImage(page);
        },
        failure: (message, _) => ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(content: Text(message)),
        ),
      );
    } catch (e) {
      if (!mounted) return;
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(content: Text('Image search failed: $e')),
      );
    }
  }

  Future<void> _toggleVoice() async {
    if (kIsWeb) {
      await _promptTranscript();
      return;
    }
    final sl = ServiceLocator.instance;
    try {
      if (_recording) {
        final path = await _recorder.stop();
        setState(() => _recording = false);
        if (path == null || path.isEmpty) return;
        if (!sl.authRepository.hasActiveSession || sl.authRepository.isGuest) {
          await _promptTranscript();
          return;
        }
        final uploaded = await sl.mediaUploadService.uploadFile(
          file: File(path),
          purpose: 'search_voice',
          mimeType: 'audio/m4a',
        );
        final result = await sl.searchRepository.voice(audioUrl: uploaded.fileUrl);
        if (!mounted) return;
        result.when(
          success: (page) {
            if (page.items.isEmpty && (page.zeroResult?.message.isEmpty ?? true)) {
              _promptTranscript();
              return;
            }
            _store.applyVoice(page);
          },
          failure: (message, _) {
            ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(message)));
            _promptTranscript();
          },
        );
      } else {
        final hasPerm = await _recorder.hasPermission();
        if (!hasPerm) {
          await _promptTranscript();
          return;
        }
        final dir = await getTemporaryDirectory();
        final path = '${dir.path}/search_${const Uuid().v4()}.m4a';
        await _recorder.start(
          const RecordConfig(encoder: AudioEncoder.aacLc),
          path: path,
        );
        setState(() => _recording = true);
      }
    } catch (e) {
      setState(() => _recording = false);
      if (!mounted) return;
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(content: Text('Voice search unavailable. Type the query instead.')),
      );
      await _promptTranscript();
    }
  }

  Future<void> _promptTranscript() async {
    final typed = TextEditingController(text: _controller.text);
    final transcript = await showDialog<String>(
      context: context,
      builder: (context) => AlertDialog(
        title: const Text('Voice search'),
        content: TextField(
          controller: typed,
          autofocus: true,
          decoration: const InputDecoration(
            hintText: 'Type what you said…',
          ),
        ),
        actions: [
          TextButton(onPressed: () => Navigator.pop(context), child: const Text('Cancel')),
          FilledButton(
            onPressed: () => Navigator.pop(context, typed.text.trim()),
            child: const Text('Search'),
          ),
        ],
      ),
    );
    typed.dispose();
    if (transcript == null || transcript.isEmpty) return;
    _controller.text = transcript;
    _store.query.value = transcript;
    final result = await ServiceLocator.instance.searchRepository.voice(
      transcript: transcript,
    );
    if (!mounted) return;
    result.when(
      success: _store.applyVoice,
      failure: (message, _) => ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(content: Text(message)),
      ),
    );
  }

  @override
  Widget build(BuildContext context) {
    final isGuest = ServiceLocator.instance.authRepository.isGuest;
    return AppScaffold(
      title: 'Search',
      actions: [
        IconButton(
          icon: const Icon(Icons.map_outlined),
          tooltip: 'Map',
          onPressed: () {
            final params = {
              'marketplace': _store.marketplace,
              ..._store.filterState.toQueryParameters(),
            };
            context.push(Uri(path: AppRoutes.map, queryParameters: params).toString());
          },
        ),
        IconButton(
          icon: const Icon(Icons.share_outlined),
          tooltip: 'Share search',
          onPressed: _share,
        ),
        IconButton(
          icon: const Icon(Icons.tune),
          tooltip: 'Filters',
          onPressed: _openFilters,
        ),
        IconButton(
          icon: const Icon(Icons.bookmark_border),
          tooltip: 'Saved searches',
          onPressed: () {
            if (!ServiceLocator.instance.guestFeatureGuard.allows(GuestFeature.saveSearch)) {
              context.push(AppRoutes.login);
              return;
            }
            context.push(AppRoutes.searchSaved);
          },
        ),
      ],
      body: Column(
        children: [
          Padding(
            padding: EdgeInsets.fromLTRB(context.isCompact ? 12 : 16, 0, context.isCompact ? 12 : 16, 8),
            child: TextField(
              controller: _controller,
              focusNode: _focus,
              textInputAction: TextInputAction.search,
              decoration: InputDecoration(
                hintText: 'Search gold, property, vehicles…',
                isDense: context.isCompact,
                prefixIcon: const Icon(Icons.search),
                suffixIcon: Row(
                  mainAxisSize: MainAxisSize.min,
                  children: [
                    SignalBuilder(builder: (context) {
                      final on = _store.useAi.value;
                      return IconButton(
                        tooltip: 'AI search',
                        icon: Icon(Icons.auto_awesome, color: on ? AppColors.gold : null),
                        onPressed: () {
                          _store.useAi.value = !on;
                          if (_controller.text.trim().isNotEmpty) _store.run();
                        },
                      );
                    }),
                    IconButton(
                      tooltip: _recording ? 'Stop' : 'Voice search',
                      icon: Icon(
                        _recording ? Icons.stop_circle_outlined : Icons.mic_none,
                        color: _recording ? AppColors.error : null,
                      ),
                      onPressed: _toggleVoice,
                    ),
                    IconButton(
                      tooltip: 'Image search',
                      icon: const Icon(Icons.image_outlined),
                      onPressed: _pickImage,
                    ),
                  ],
                ),
              ),
              onChanged: _onQueryChanged,
              onSubmitted: (value) {
                _store.query.value = value;
                _runAndPersist();
              },
            ),
          ),
          SignalBuilder(builder: (context) {
            _store.globalScope.value;
            _store.nearby.value;
            _store.radiusKm.value;
            _store.sort.value;
            return SizedBox(
              height: 44,
              child: ListView(
                scrollDirection: Axis.horizontal,
                padding: const EdgeInsets.symmetric(horizontal: 16),
                children: [
                  Padding(
                    padding: const EdgeInsets.only(right: 8),
                    child: ChoiceChip(
                      label: Text(_store.marketplace),
                      selected: !_store.globalScope.value,
                      onSelected: (_) {
                        _store.globalScope.value = false;
                        if (_controller.text.trim().isNotEmpty) _store.run();
                      },
                    ),
                  ),
                  Padding(
                    padding: const EdgeInsets.only(right: 8),
                    child: ChoiceChip(
                      label: const Text('All marketplaces'),
                      selected: _store.globalScope.value,
                      onSelected: (_) {
                        _store.globalScope.value = true;
                        if (_controller.text.trim().isNotEmpty) _store.run();
                      },
                    ),
                  ),
                  Padding(
                    padding: const EdgeInsets.only(right: 8),
                    child: FilterChip(
                      label: const Text('Nearby'),
                      selected: _store.nearby.value,
                      onSelected: (selected) {
                        if (selected) {
                          _enableNearby();
                        } else {
                          _store.nearby.value = false;
                          _store.run();
                        }
                      },
                    ),
                  ),
                  if (_store.nearby.value)
                    for (final km in const [1.0, 5.0, 10.0, 25.0, 50.0, 100.0])
                      Padding(
                        padding: const EdgeInsets.only(right: 8),
                        child: ChoiceChip(
                          label: Text('${km.toInt()} km'),
                          selected: _store.radiusKm.value == km,
                          onSelected: (_) {
                            _store.radiusKm.value = km;
                            _store.run();
                          },
                        ),
                      ),
                  Padding(
                    padding: const EdgeInsets.only(right: 8),
                    child: ActionChip(
                      label: Text('Sort: ${_store.sort.value.replaceAll('_', ' ')}'),
                      onPressed: () async {
                        final next = await showModalBottomSheet<String>(
                          context: context,
                          builder: (context) => SafeArea(
                            child: Column(
                              mainAxisSize: MainAxisSize.min,
                              children: [
                                for (final option in const [
                                  ('relevance', 'Relevance'),
                                  ('newest', 'Newest'),
                                  ('price_asc', 'Price: low to high'),
                                  ('price_desc', 'Price: high to low'),
                                  ('distance', 'Distance'),
                                ])
                                  ListTile(
                                    title: Text(option.$2),
                                    onTap: () => Navigator.pop(context, option.$1),
                                  ),
                              ],
                            ),
                          ),
                        );
                        if (next != null) {
                          _store.sort.value = next;
                          _store.run();
                        }
                      },
                    ),
                  ),
                  ActionChip(
                    label: const Text('Save'),
                    onPressed: _save,
                  ),
                ],
              ),
            );
          }),
          SignalBuilder(builder: (context) {
            _store.filterTick.value;
            return FilterChipsBar(
              state: _store.filterState,
              definitions: _definitions,
              onChanged: () {
                _store.filterTick.value++;
                _runAndPersist();
              },
              onSave: _save,
            );
          }),
          Expanded(
            child: SignalBuilder(builder: (context) {
              final suggestions = _store.suggestions.value;
              if (_focus.hasFocus && suggestions.isNotEmpty) {
                return ListView.separated(
                  itemCount: suggestions.length,
                  separatorBuilder: (_, _) => const Divider(height: 1),
                  itemBuilder: (context, index) {
                    final item = suggestions[index];
                    return ListTile(
                      leading: Icon(_kindIcon(item.kind)),
                      title: Text(item.term),
                      subtitle: Text(item.kind.replaceAll('_', ' ')),
                      onTap: () {
                        _controller.text = item.term;
                        _store.applySuggestion(item.term);
                      },
                    );
                  },
                );
              }
              final state = _store.results.value;
              if (state is AsyncIdle<SearchPage>) {
                return _DiscoveryPanel(
                  store: _store,
                  onTerm: (term) {
                    _controller.text = term;
                    _store.applySuggestion(term);
                  },
                );
              }
              if (state is AsyncLoading<SearchPage> && state.previous == null) {
                return const LoadingView(message: 'Searching…');
              }
              if (state is AsyncError<SearchPage> && state.previous == null) {
                return EmptyState(
                  title: 'Search failed',
                  subtitle: state.message,
                  action: FilledButton(
                    onPressed: _store.run,
                    child: const Text('Retry'),
                  ),
                );
              }
              final page = state.dataOrNull;
              if (page == null) {
                return const LoadingView(message: 'Searching…');
              }
              return NotificationListener<ScrollNotification>(
                onNotification: (n) {
                  if (n.metrics.pixels > n.metrics.maxScrollExtent - 480) {
                    _store.loadMore();
                  }
                  return false;
                },
                child: _ResultsView(
                  page: page,
                  isGuest: isGuest,
                  onClarification: _store.applyClarification,
                  onSuggestion: (term) {
                    _controller.text = term;
                    _store.applySuggestion(term);
                  },
                  onFacet: (key, value) {
                    _store.filterState.setValue(key, value);
                    _store.filterTick.value++;
                    _runAndPersist();
                  },
                  onOpen: (listing, index) {
                    _store.trackClick(listing.id, index);
                    context.push('/listing/${listing.id}');
                  },
                ),
              );
            }),
          ),
        ],
      ),
    );
  }

  IconData _kindIcon(String kind) {
    return switch (kind) {
      'recent' => Icons.history,
      'location' => Icons.place_outlined,
      'make' || 'model' || 'brand' => Icons.directions_car_outlined,
      'gold_term' => Icons.diamond_outlined,
      'property_kind' => Icons.home_outlined,
      'vehicle_part' => Icons.settings_input_component_outlined,
      _ => Icons.search,
    };
  }
}

class _DiscoveryPanel extends StatelessWidget {
  const _DiscoveryPanel({required this.store, required this.onTerm});

  final SearchStore store;
  final ValueChanged<String> onTerm;

  @override
  Widget build(BuildContext context) {
    return SignalBuilder(builder: (context) {
      final recent = store.recent.value;
      final trending = store.trending.value;
      final saved = store.saved.value;
      return ListView(
        padding: const EdgeInsets.fromLTRB(16, 8, 16, 24),
        children: [
          if (recent.isNotEmpty) ...[
            Row(
              children: [
                Text('Recent', style: Theme.of(context).textTheme.titleMedium),
                const Spacer(),
                TextButton(onPressed: store.clearRecent, child: const Text('Clear')),
              ],
            ),
            for (final item in recent)
              ListTile(
                contentPadding: EdgeInsets.zero,
                leading: const Icon(Icons.history),
                title: Text(item.term),
                trailing: IconButton(
                  icon: const Icon(Icons.close),
                  onPressed: () => store.deleteRecent(item.id),
                ),
                onTap: () => onTerm(item.term),
              ),
          ],
          if (trending.isNotEmpty) ...[
            const SizedBox(height: 8),
            Text('Trending', style: Theme.of(context).textTheme.titleMedium),
            const SizedBox(height: 8),
            Wrap(
              spacing: 8,
              runSpacing: 8,
              children: [
                for (final item in trending)
                  ActionChip(
                    label: Text(item.term),
                    onPressed: () => onTerm(item.term),
                  ),
              ],
            ),
          ],
          if (saved.isNotEmpty) ...[
            const SizedBox(height: 16),
            Text('Saved searches', style: Theme.of(context).textTheme.titleMedium),
            for (final item in saved.take(5))
              ListTile(
                contentPadding: EdgeInsets.zero,
                leading: const Icon(Icons.bookmark_outline),
                title: Text(item.name),
                subtitle: Text(item.alertFrequency ?? 'instant'),
                onTap: () => onTerm(item.originalQuery ?? item.name),
              ),
          ],
          if (recent.isEmpty && trending.isEmpty && saved.isEmpty)
            const EmptyState(
              title: 'Search across Gold, Property, and Vehicles',
              subtitle: 'Try “automatic Toyota under 50 lakh near Islamabad” or “24k gold 10 gram”.',
            ),
        ],
      );
    });
  }
}

class _ResultsView extends StatelessWidget {
  const _ResultsView({
    required this.page,
    required this.isGuest,
    required this.onClarification,
    required this.onSuggestion,
    required this.onOpen,
    required this.onFacet,
  });

  final SearchPage page;
  final bool isGuest;
  final ValueChanged<String> onClarification;
  final ValueChanged<String> onSuggestion;
  final void Function(ListingModel listing, int index) onOpen;
  final void Function(String key, String value) onFacet;

  @override
  Widget build(BuildContext context) {
    if (page.clarification.needed && page.items.isEmpty) {
      return EmptyState(
        title: page.clarification.questions.isNotEmpty
            ? page.clarification.questions.first
            : 'Need a bit more detail',
        subtitle: 'Only the missing choice is asked so results stay accurate.',
        action: Wrap(
          spacing: 8,
          children: [
            FilledButton(onPressed: () => onClarification('buy'), child: const Text('Buy')),
            OutlinedButton(onPressed: () => onClarification('rent'), child: const Text('Rent')),
          ],
        ),
      );
    }

    final grouped = page.groups.entries.where((e) => e.value.isNotEmpty).toList();
    final empty = page.items.isEmpty && page.parts.isEmpty;
    if (empty) {
      final help = page.zeroResult;
      return ListView(
        padding: const EdgeInsets.all(24),
        children: [
          EmptyState(
            title: help?.message.isNotEmpty == true ? help!.message : 'No matching listings',
            subtitle: 'Suggestions below use only the filters from your search.',
          ),
          if (help != null)
            for (final suggestion in help.suggestions)
              ListTile(
                leading: const Icon(Icons.lightbulb_outline),
                title: Text(suggestion),
                onTap: () => onSuggestion(suggestion),
              ),
        ],
      );
    }

    return CustomScrollView(
      slivers: [
        if (page.explanation != null && page.explanation!.isNotEmpty)
          SliverToBoxAdapter(
            child: Padding(
              padding: const EdgeInsets.fromLTRB(16, 8, 16, 8),
              child: Text(page.explanation!, style: Theme.of(context).textTheme.bodyMedium),
            ),
          ),
        if (page.disclaimer != null && page.disclaimer!.isNotEmpty)
          SliverToBoxAdapter(
            child: Padding(
              padding: const EdgeInsets.symmetric(horizontal: 16),
              child: Text(
                page.disclaimer!,
                style: Theme.of(context).textTheme.bodySmall?.copyWith(color: AppColors.goldLight),
              ),
            ),
          ),
        if (page.facets.isNotEmpty)
          SliverToBoxAdapter(
            child: Padding(
              padding: const EdgeInsets.fromLTRB(16, 8, 16, 8),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  for (final group in page.facets.take(6)) ...[
                    Text(group.label, style: Theme.of(context).textTheme.titleSmall),
                    const SizedBox(height: 6),
                    Wrap(
                      spacing: 8,
                      runSpacing: 8,
                      children: [
                        for (final bucket in group.buckets.take(8))
                          ActionChip(
                            label: Text('${bucket.label} (${bucket.count})'),
                            onPressed: () => onFacet(group.key, bucket.value),
                          ),
                      ],
                    ),
                    const SizedBox(height: 8),
                  ],
                ],
              ),
            ),
          ),
        if (grouped.length > 1)
          for (final group in grouped) ...[
            SliverToBoxAdapter(
              child: Padding(
                padding: const EdgeInsets.fromLTRB(16, 16, 16, 8),
                child: Text(
                  group.key[0].toUpperCase() + group.key.substring(1),
                  style: Theme.of(context).textTheme.titleMedium,
                ),
              ),
            ),
            SliverPadding(
              padding: const EdgeInsets.symmetric(horizontal: 16),
              sliver: SliverList.separated(
                itemCount: group.value.length,
                separatorBuilder: (_, _) => const SizedBox(height: 10),
                itemBuilder: (context, index) {
                  final listing = group.value[index];
                  return ListingCard(
                    listing: listing,
                    compact: context.isCompact,
                    isGuest: isGuest,
                    onTap: () => onOpen(listing, index),
                  );
                },
              ),
            ),
          ]
        else
          SliverPadding(
            padding: const EdgeInsets.all(16),
            sliver: SliverList.separated(
              itemCount: page.items.length,
              separatorBuilder: (_, _) => const SizedBox(height: 10),
              itemBuilder: (context, index) {
                  final listing = page.items[index];
                  final ad = index == 2 && page.contextualAds.isNotEmpty
                      ? page.contextualAds.first
                      : null;
                  return Column(
                    children: [
                      ListingCard(
                        listing: listing,
                        compact: context.isCompact,
                        isGuest: isGuest,
                        onTap: () => onOpen(listing, index),
                      ),
                      if (ad != null) AdSlot(placementCode: 'search_native_3', ads: [ad]),
                    ],
                  );
                },
            ),
          ),
        if (page.parts.isNotEmpty)
          SliverToBoxAdapter(
            child: Padding(
              padding: const EdgeInsets.fromLTRB(16, 16, 16, 8),
              child: Text('Vehicle parts', style: Theme.of(context).textTheme.titleMedium),
            ),
          ),
        if (page.parts.isNotEmpty)
          SliverList.builder(
            itemCount: page.parts.length,
            itemBuilder: (context, index) {
              final part = page.parts[index];
              return ListTile(
                title: Text(part.name),
                subtitle: Text([
                  if (part.brand != null) part.brand,
                  if (part.price != null) '${part.currency ?? ''} ${part.price}',
                ].whereType<String>().join(' · ')),
              );
            },
          ),
        const SliverToBoxAdapter(child: SizedBox(height: 24)),
      ],
    );
  }
}
