import 'dart:async';

import 'package:flutter/material.dart';
import 'package:flutter_map/flutter_map.dart';
import 'package:go_router/go_router.dart';
import 'package:latlong2/latlong.dart';
import 'package:url_launcher/url_launcher.dart';

import '../../app/app_routes.dart';
import '../../app/theme/app_colors.dart';
import '../../core/di/service_locator.dart';
import '../../data/models/filter_models.dart';
import '../../data/models/map_models.dart';
import '../../data/services/location_service.dart';
import '../../shared/extensions/context_extensions.dart';
import '../../shared/widgets/app_scaffold.dart';
import '../filters/filter_panel.dart';
import '../filters/filter_state.dart';

class DiscoveryMapScreen extends StatefulWidget {
  const DiscoveryMapScreen({
    super.key,
    this.marketplace,
    this.queryParameters = const {},
  });

  final String? marketplace;
  final Map<String, String> queryParameters;

  @override
  State<DiscoveryMapScreen> createState() => _DiscoveryMapScreenState();
}

class _DiscoveryMapScreenState extends State<DiscoveryMapScreen> {
  final _controller = MapController();
  late FilterState _filters = FilterState.fromQueryParameters(
    widget.queryParameters,
    marketplace: widget.marketplace ?? ServiceLocator.instance.settingsRepository.marketplaceCode,
  );
  List<FilterDefinition> _definitions = const [];
  MapDescriptor? _descriptor;
  MapSearchPage? _page;
  MapMarkerItem? _selected;
  List<NearbyPlace> _places = const [];
  String _style = 'standard';
  bool _loading = false;
  String? _error;
  Timer? _debounce;
  LatLng _center = const LatLng(31.5204, 74.3587);

  String get _marketplace =>
      widget.marketplace ?? _filters.marketplace ?? ServiceLocator.instance.settingsRepository.marketplaceCode ?? 'gold';

  String get _platform => LocationService.platformName();

  @override
  void initState() {
    super.initState();
    _filters.marketplace = _marketplace;
    WidgetsBinding.instance.addPostFrameCallback((_) => _bootstrap());
  }

  @override
  void dispose() {
    _debounce?.cancel();
    super.dispose();
  }

  Future<void> _bootstrap() async {
    final sl = ServiceLocator.instance;
    final caps = await sl.mapsRepository.capabilities(platform: _platform);
    caps.when(
      success: (d) {
        if (!mounted) return;
        setState(() => _descriptor = d);
      },
      failure: (_, _) {},
    );
    final defs = await sl.filtersRepository.definitions(marketplace: _marketplace);
    defs.when(
      success: (items) {
        if (!mounted) return;
        setState(() => _definitions = items);
      },
      failure: (_, _) {},
    );
    final gps = await sl.locationService.currentGps();
    if (gps != null && mounted) {
      _center = LatLng(gps.lat, gps.lng);
      try {
        _controller.move(_center, 12);
      } catch (_) {}
    }
    sl.mapsRepository.track('map_open', metadata: {'marketplace': _marketplace});
    await _reload();
  }

  Future<void> _reload() async {
    setState(() {
      _loading = true;
      _error = null;
    });
    LatLngBounds? bounds;
    var zoom = 11.0;
    try {
      bounds = _controller.camera.visibleBounds;
      zoom = _controller.camera.zoom;
      _center = _controller.camera.center;
    } catch (_) {}
    final dsl = _filters.toDsl();
    dsl['marketplace'] = _marketplace;
    final result = await ServiceLocator.instance.mapsRepository.search(
      marketplace: _marketplace,
      dsl: dsl,
            minLat: bounds?.southWest.latitude,
            maxLat: bounds?.northEast.latitude,
            minLng: bounds?.southWest.longitude,
            maxLng: bounds?.northEast.longitude,
      zoom: zoom,
      platform: _platform,
      style: _style,
    );
    if (!mounted) return;
    result.when(
      success: (page) {
        final items = page.clustered
            ? page.items
            : clusterClientSide(page.items, zoom: zoom);
        setState(() {
          _page = MapSearchPage(
            items: items,
            total: page.total,
            clustered: page.clustered || items.any((e) => e.isCluster),
            dsl: page.dsl,
            facets: page.facets,
          );
          _loading = false;
        });
      },
      failure: (message, _) => setState(() {
        _error = message;
        _loading = false;
      }),
    );
  }

  void _onMapMoved(bool hasGesture) {
    if (!hasGesture) return;
    _debounce?.cancel();
    _debounce = Timer(const Duration(milliseconds: 450), () {
      ServiceLocator.instance.mapsRepository.track('map_move', metadata: {'marketplace': _marketplace});
      _reload();
    });
  }

  Future<void> _openFilters() async {
    final next = await showFilterPanel(
      context,
      initial: _filters.copy(),
      marketplace: _marketplace,
    );
    if (next == null) return;
    setState(() {
      _filters = next;
      _filters.marketplace = _marketplace;
      _selected = null;
    });
    ServiceLocator.instance.mapsRepository.track('filter_apply', metadata: {'count': _filters.activeCount});
    await _reload();
  }

  Future<void> _selectMarker(MapMarkerItem item) async {
    if (item.isCluster) {
      try {
        _controller.move(LatLng(item.latitude, item.longitude), (_controller.camera.zoom + 2).clamp(3, 18));
      } catch (_) {}
      await _reload();
      return;
    }
    setState(() => _selected = item);
    ServiceLocator.instance.mapsRepository.track(
      'marker_click',
      listingId: item.listingId,
      metadata: {'marketplace': item.marketplace},
    );
    if (_descriptor?.capabilities.places == true && item.listingId != null) {
      final places = await ServiceLocator.instance.mapsRepository.places(
        lat: item.latitude,
        lng: item.longitude,
        listingId: item.listingId,
        types: _marketplace == 'property' ? 'school,hospital,shopping,transport' : null,
      );
      if (!mounted) return;
      places.when(
        success: (items) => setState(() => _places = items),
        failure: (_, _) => setState(() => _places = const []),
      );
    }
  }

  Future<void> _directions(MapMarkerItem item) async {
    if (_descriptor?.capabilities.directions != true) return;
    final origin = await ServiceLocator.instance.locationService.currentGps();
    final result = await ServiceLocator.instance.mapsRepository.directions(
      lat: item.latitude,
      lng: item.longitude,
      originLat: origin?.lat,
      originLng: origin?.lng,
      platform: _platform,
    );
    result.when(
      success: (data) async {
        final url = data['url']?.toString();
        if (url == null || url.isEmpty) return;
        ServiceLocator.instance.mapsRepository.track('directions_click', listingId: item.listingId);
        await launchUrl(Uri.parse(url), mode: LaunchMode.externalApplication);
      },
      failure: (message, _) {
        if (!mounted) return;
        ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(message)));
      },
    );
  }

  Future<void> _streetView(MapMarkerItem item) async {
    if (_descriptor?.capabilities.streetView != true) return;
    final result = await ServiceLocator.instance.mapsRepository.streetView(
      lat: item.latitude,
      lng: item.longitude,
      platform: _platform,
    );
    result.when(
      success: (data) async {
        if (data['supported'] != true) return;
        final url = data['url']?.toString();
        final disclaimer = data['disclaimer']?.toString();
        if (disclaimer != null && mounted) {
          ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(disclaimer)));
        }
        if (url == null || url.isEmpty) return;
        ServiceLocator.instance.mapsRepository.track('street_view', listingId: item.listingId);
        await launchUrl(Uri.parse(url), mode: LaunchMode.externalApplication);
      },
      failure: (_, _) {},
    );
  }

  String get _tileUrl {
    final provider = _descriptor?.provider;
    if (_style == 'satellite') {
      return provider?.satelliteTileUrl ??
          'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}';
    }
    if (_style == 'hybrid') {
      return provider?.hybridTileUrl ??
          provider?.satelliteTileUrl ??
          'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}';
    }
    return provider?.tileUrl ?? 'https://tile.openstreetmap.org/{z}/{x}/{y}.png';
  }

  IconData _pinIcon() {
    return switch (_marketplace) {
      'property' => Icons.home,
      'vehicles' => Icons.directions_car,
      _ => Icons.storefront,
    };
  }

  @override
  Widget build(BuildContext context) {
    final title = switch (_marketplace) {
      'property' => 'Property map',
      'vehicles' => 'Vehicle map',
      'gold' => 'Gold map',
      _ => 'Map',
    };
    final caps = _descriptor?.capabilities;
    final items = _page?.items ?? const <MapMarkerItem>[];
    final map = Stack(
      children: [
        FlutterMap(
          mapController: _controller,
          options: MapOptions(
            initialCenter: _center,
            initialZoom: 11,
            onPositionChanged: (_, hasGesture) => _onMapMoved(hasGesture),
            onTap: (_, _) => setState(() {
              _selected = null;
              _places = const [];
            }),
          ),
          children: [
            TileLayer(
              urlTemplate: _tileUrl,
              userAgentPackageName: 'marketplace',
            ),
            MarkerLayer(
              markers: [
                for (final place in _places)
                  Marker(
                    point: LatLng(place.latitude, place.longitude),
                    width: 28,
                    height: 28,
                    child: Tooltip(
                      message: '${place.name} (${place.type})',
                      child: const Icon(Icons.place, color: AppColors.success, size: 22),
                    ),
                  ),
                for (final item in items)
                  Marker(
                    point: LatLng(item.latitude, item.longitude),
                    width: item.isCluster ? 44 : 40,
                    height: item.isCluster ? 44 : 40,
                    child: GestureDetector(
                      onTap: () => _selectMarker(item),
                      child: item.isCluster
                          ? _ClusterBadge(count: item.count)
                          : Icon(
                              _pinIcon(),
                              color: _selected?.listingId == item.listingId
                                  ? AppColors.goldLight
                                  : item.approximate
                                      ? AppColors.goldMuted
                                      : AppColors.gold,
                              size: 32,
                            ),
                    ),
                  ),
              ],
            ),
          ],
        ),
        if (_loading)
          const Positioned(
            top: 12,
            left: 0,
            right: 0,
            child: Center(child: CircularProgressIndicator()),
          ),
        Positioned(
          top: 8,
          right: 8,
          child: Column(
            children: [
              Material(
                color: Theme.of(context).colorScheme.surface,
                borderRadius: BorderRadius.circular(8),
                child: IconButton(
                  tooltip: 'Filters',
                  icon: Badge(
                    isLabelVisible: _filters.activeCount > 0,
                    label: Text('${_filters.activeCount}'),
                    child: const Icon(Icons.tune),
                  ),
                  onPressed: _openFilters,
                ),
              ),
              if (caps?.satellite == true) ...[
                const SizedBox(height: 8),
                Material(
                  color: Theme.of(context).colorScheme.surface,
                  borderRadius: BorderRadius.circular(8),
                  child: IconButton(
                    tooltip: _style == 'standard' ? 'Satellite' : 'Standard map',
                    icon: Icon(_style == 'standard' ? Icons.satellite_alt : Icons.map_outlined),
                    onPressed: () {
                      setState(() => _style = _style == 'standard' ? 'satellite' : 'standard');
                      ServiceLocator.instance.mapsRepository.track('satellite');
                    },
                  ),
                ),
              ],
              const SizedBox(height: 8),
              Material(
                color: Theme.of(context).colorScheme.surface,
                borderRadius: BorderRadius.circular(8),
                child: IconButton(
                  tooltip: 'My location',
                  icon: const Icon(Icons.my_location),
                  onPressed: () async {
                    final gps = await ServiceLocator.instance.locationService.currentGps();
                    if (gps == null || !mounted) return;
                    _center = LatLng(gps.lat, gps.lng);
                    _controller.move(_center, 13);
                    ServiceLocator.instance.mapsRepository.track('nearby_search');
                    await _reload();
                  },
                ),
              ),
            ],
          ),
        ),
        if (_error != null)
          Positioned(
            bottom: 24,
            left: 16,
            right: 16,
            child: Material(
              color: Colors.black87,
              borderRadius: BorderRadius.circular(8),
              child: Padding(
                padding: const EdgeInsets.all(12),
                child: Text(_error!, style: const TextStyle(color: Colors.white)),
              ),
            ),
          ),
        if (_selected != null)
          Positioned(
            left: 12,
            right: 12,
            bottom: 16,
            child: _ListingPreviewCard(
              item: _selected!,
              capabilities: caps,
              marketplace: _marketplace,
              onOpen: () {
                ServiceLocator.instance.mapsRepository.track(
                  'listing_click',
                  listingId: _selected!.listingId,
                );
                context.push('/listing/${_selected!.listingId}');
              },
              onDirections: caps?.directions == true ? () => _directions(_selected!) : null,
              onStreetView: caps?.streetView == true ? () => _streetView(_selected!) : null,
              streetViewDisclaimer: _descriptor?.streetViewDisclaimer,
            ),
          ),
      ],
    );

    return AppScaffold(
      title: title,
      actions: [
        IconButton(
          tooltip: 'List view',
          icon: const Icon(Icons.view_list_outlined),
          onPressed: () {
            final params = _filters.toQueryParameters();
            params['marketplace'] = _marketplace;
            context.push(Uri(path: AppRoutes.search, queryParameters: params).toString());
          },
        ),
      ],
      body: Column(
        children: [
          FilterChipsBar(
            state: _filters,
            definitions: _definitions,
            onChanged: () {
              setState(() {});
              _reload();
            },
          ),
          if (_page != null)
            Padding(
              padding: const EdgeInsets.fromLTRB(16, 0, 16, 8),
              child: Align(
                alignment: Alignment.centerLeft,
                child: Text(
                  '${_page!.total} listings · ${items.where((e) => e.isCluster).isNotEmpty ? 'clustered' : 'markers'}',
                  style: Theme.of(context).textTheme.bodySmall,
                ),
              ),
            ),
          Expanded(
            child: context.isDesktop
                ? Row(
                    children: [
                      SizedBox(
                        width: 360,
                        child: _MarkerList(
                          items: items.where((e) => !e.isCluster).toList(),
                          selectedId: _selected?.listingId,
                          onTap: _selectMarker,
                        ),
                      ),
                      Expanded(child: map),
                    ],
                  )
                : map,
          ),
        ],
      ),
    );
  }
}

class _ClusterBadge extends StatelessWidget {
  const _ClusterBadge({required this.count});
  final int count;

  @override
  Widget build(BuildContext context) {
    return Container(
      alignment: Alignment.center,
      decoration: const BoxDecoration(color: AppColors.gold, shape: BoxShape.circle),
      child: Text(
        count > 99 ? '99+' : '$count',
        style: const TextStyle(color: Colors.black, fontWeight: FontWeight.w700, fontSize: 12),
      ),
    );
  }
}

class _MarkerList extends StatelessWidget {
  const _MarkerList({required this.items, required this.onTap, this.selectedId});
  final List<MapMarkerItem> items;
  final ValueChanged<MapMarkerItem> onTap;
  final int? selectedId;

  @override
  Widget build(BuildContext context) {
    if (items.isEmpty) {
      return const Center(child: Text('Zoom or pan the map to load listings.'));
    }
    return ListView.separated(
      itemCount: items.length,
      separatorBuilder: (_, _) => const Divider(height: 1),
      itemBuilder: (context, index) {
        final item = items[index];
        return ListTile(
          selected: item.listingId == selectedId,
          title: Text(item.title ?? 'Listing'),
          subtitle: Text([
            if (item.price != null) '${item.currency ?? ''} ${item.price!.toStringAsFixed(0)}',
            if (item.approximate) 'Approximate location',
          ].join(' · ')),
          onTap: () => onTap(item),
        );
      },
    );
  }
}

class _ListingPreviewCard extends StatelessWidget {
  const _ListingPreviewCard({
    required this.item,
    required this.marketplace,
    required this.onOpen,
    this.capabilities,
    this.onDirections,
    this.onStreetView,
    this.streetViewDisclaimer,
  });

  final MapMarkerItem item;
  final String marketplace;
  final VoidCallback onOpen;
  final MapCapabilities? capabilities;
  final VoidCallback? onDirections;
  final VoidCallback? onStreetView;
  final String? streetViewDisclaimer;

  @override
  Widget build(BuildContext context) {
    final attrs = item.attributes;
    final details = switch (marketplace) {
      'property' => [
          if (attrs['bedrooms'] != null) '${attrs['bedrooms']} bed',
          if (attrs['bathrooms'] != null) '${attrs['bathrooms']} bath',
          if (attrs['areaSqm'] != null) '${attrs['areaSqm']} m²',
        ],
      'vehicles' => [
          if (attrs['make'] != null) '${attrs['make']}',
          if (attrs['model'] != null) '${attrs['model']}',
          if (attrs['year'] != null) '${attrs['year']}',
        ],
      _ => [
          if (attrs['form'] != null) '${attrs['form']}',
          if (attrs['karat'] != null) '${attrs['karat']}K',
        ],
    };
    return Material(
      elevation: 8,
      borderRadius: BorderRadius.circular(12),
      color: Theme.of(context).colorScheme.surface,
      child: Padding(
        padding: const EdgeInsets.all(12),
        child: Column(
          mainAxisSize: MainAxisSize.min,
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Text(item.title ?? 'Listing', style: Theme.of(context).textTheme.titleMedium),
            if (item.price != null)
              Text(
                '${item.currency ?? ''} ${item.price!.toStringAsFixed(0)}',
                style: const TextStyle(color: AppColors.gold, fontWeight: FontWeight.w700),
              ),
            if (details.isNotEmpty) Text(details.join(' · ')),
            if (item.approximate)
              Text(
                'Approximate location — exact coordinates are hidden for privacy.',
                style: Theme.of(context).textTheme.bodySmall,
              ),
            if (onStreetView != null && streetViewDisclaimer != null)
              Text(
                streetViewDisclaimer!,
                style: Theme.of(context).textTheme.bodySmall?.copyWith(color: AppColors.goldMuted),
              ),
            const SizedBox(height: 8),
            Wrap(
              spacing: 8,
              children: [
                FilledButton(onPressed: onOpen, child: const Text('View listing')),
                if (onDirections != null)
                  OutlinedButton(onPressed: onDirections, child: const Text('Directions')),
                if (onStreetView != null)
                  OutlinedButton(onPressed: onStreetView, child: const Text('Street View')),
              ],
            ),
          ],
        ),
      ),
    );
  }
}

