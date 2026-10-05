import 'package:flutter/material.dart';
import 'package:go_router/go_router.dart';
import 'package:signals_flutter/signals_flutter.dart'
    hide AsyncState, AsyncLoading, AsyncData, AsyncError;

import '../../app/theme/app_colors.dart';
import '../../core/di/service_locator.dart';
import '../../core/result/async_state.dart';
import '../../core/result/result.dart';
import '../../data/models/listing_model.dart';
import '../../shared/widgets/app_scaffold.dart';

class ListingManageScreen extends StatefulWidget {
  const ListingManageScreen({super.key, required this.listingId});

  final String listingId;

  @override
  State<ListingManageScreen> createState() => _ListingManageScreenState();
}

class _ListingManageScreenState extends State<ListingManageScreen> {
  final listing = signal<AsyncState<ListingModel>>(const AsyncIdle());
  final events = signal<List<Map<String, dynamic>>>(const []);
  String? _busy;

  @override
  void initState() {
    super.initState();
    _load();
  }

  Future<void> _load() async {
    listing.value = AsyncLoading(previous: listing.value.dataOrNull);
    final repo = ServiceLocator.instance.listingsRepository;
    final result = await repo.getById(widget.listingId);
    result.when(
      success: (item) => listing.value = AsyncData(item),
      failure: (m, code) => listing.value = AsyncError(m, code: code),
    );
    final eventResult = await repo.events(widget.listingId);
    eventResult.when(
      success: (items) => events.value = items,
      failure: (_, _) {},
    );
  }

  Future<void> _run(String label, Future<Result<Map<String, dynamic>>> Function() action) async {
    setState(() => _busy = label);
    final result = await action();
    if (!mounted) return;
    setState(() => _busy = null);
    result.when(
      success: (_) {
        ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text('$label completed')));
        _load();
      },
      failure: (m, _) => ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(m))),
    );
  }

  @override
  Widget build(BuildContext context) {
    return AppScaffold(
      title: 'Manage listing',
      body: SignalBuilder(builder: (_) {
        final state = listing.value;
        if (state.isLoading && state.dataOrNull == null) {
          return const Center(child: CircularProgressIndicator());
        }
        if (state case AsyncError(:final message)) {
          return Center(child: Text(message));
        }
        final item = state.dataOrNull;
        if (item == null) return const SizedBox.shrink();
        final repo = ServiceLocator.instance.listingsRepository;
        return ListView(
          padding: const EdgeInsets.all(16),
          children: [
            Text(item.title, style: Theme.of(context).textTheme.titleLarge),
            const SizedBox(height: 8),
            Wrap(
              spacing: 8,
              runSpacing: 8,
              children: [
                _chip('Lifecycle', item.effectiveLifecycle),
                _chip('Transaction', item.transactionStatus ?? 'available'),
                _chip('Moderation', item.moderationStatus ?? 'not_reviewed'),
                _chip('Expiration', item.expirationStatus ?? 'active'),
              ],
            ),
            if (item.expiresAt != null)
              Padding(
                padding: const EdgeInsets.only(top: 8),
                child: Text('Expires ${item.expiresAt!.toLocal()}'),
              ),
            const SizedBox(height: 16),
            if (_busy != null) LinearProgressIndicator(color: AppColors.gold),
            Wrap(
              spacing: 8,
              runSpacing: 8,
              children: [
                FilledButton(
                  onPressed: _busy != null
                      ? null
                      : () => _run('Submit', () => repo.submit(item.id)),
                  child: const Text('Submit for review'),
                ),
                OutlinedButton(
                  onPressed: _busy != null
                      ? null
                      : () => _run('Renew', () => repo.renew(item.id)),
                  child: const Text('Renew'),
                ),
                OutlinedButton(
                  onPressed: _busy != null
                      ? null
                      : () => _run('Archive', () => repo.archive(item.id)),
                  child: const Text('Archive'),
                ),
                OutlinedButton(
                  onPressed: _busy != null
                      ? null
                      : () => _run('Restore', () => repo.restore(item.id)),
                  child: const Text('Restore'),
                ),
                OutlinedButton(
                  onPressed: _busy != null
                      ? null
                      : () => _run('Mark sold', () => repo.setTransaction(item.id, 'sold')),
                  child: const Text('Mark sold'),
                ),
                if (item.effectiveLifecycle == 'rejected')
                  OutlinedButton(
                    onPressed: _busy != null
                        ? null
                        : () => _run(
                              'Appeal',
                              () => repo.appeal(
                                item.id,
                                'Please re-review this listing after the requested edits.',
                              ),
                            ),
                    child: const Text('Appeal'),
                  ),
              ],
            ),
            const SizedBox(height: 16),
            ListTile(
              leading: const Icon(Icons.auto_fix_high_outlined),
              title: const Text('Enhance photos'),
              subtitle: const Text('Colour and sharpness only. Originals are kept.'),
              onTap: _busy != null || item.firstMediaId == null
                  ? null
                  : () async {
                      final entitlements = ServiceLocator
                          .instance.subscriptionStore.snapshot.value.dataOrNull?.entitlements;
                      if (entitlements?.has('enhance_image') != true) {
                        ScaffoldMessenger.of(context).showSnackBar(
                          const SnackBar(content: Text('Image enhancement is not on your plan')),
                        );
                        return;
                      }
                      setState(() => _busy = 'Enhance');
                      final ai = ServiceLocator.instance.aiRepository;
                      final queued = await ai.enhanceImage(item.firstMediaId!);
                      if (!context.mounted) return;
                      if (queued case Success(:final data)) {
                        ScaffoldMessenger.of(context).showSnackBar(
                          SnackBar(content: Text('Enhancement queued (${data.jobUuid})')),
                        );
                        for (var i = 0; i < 8; i++) {
                          await Future<void>.delayed(const Duration(seconds: 2));
                          final status = await ai.job(data.jobUuid);
                          final done = status.dataOrNull;
                          if (done?.isDone == true || done?.isFailed == true) {
                            break;
                          }
                        }
                        if (mounted) {
                          setState(() => _busy = null);
                          _load();
                        }
                      } else if (queued case Failure(:final message)) {
                        if (!context.mounted) return;
                        setState(() => _busy = null);
                        ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(message)));
                      }
                    },
            ),
            ListTile(
              leading: const Icon(Icons.campaign_outlined),
              title: const Text('Promotions'),
              subtitle: const Text('Featured, boost, homepage — paid after server verification'),
              onTap: () => context.push('/listing/${item.routeId}/promotions'),
            ),
            ListTile(
              leading: const Icon(Icons.insights_outlined),
              title: const Text('Analytics'),
              subtitle: const Text('Views, impressions, and conversions'),
              onTap: () => context.push('/listing/${item.routeId}/analytics'),
            ),
            const SizedBox(height: 16),
            Text('History', style: Theme.of(context).textTheme.titleMedium),
            const SizedBox(height: 8),
            for (final event in events.value.take(20))
              ListTile(
                dense: true,
                title: Text(event['eventType']?.toString() ?? 'EVENT'),
                subtitle: Text(event['createdAt']?.toString() ?? ''),
              ),
          ],
        );
      }),
    );
  }

  Widget _chip(String label, String value) {
    return Chip(
      label: Text('$label: ${value.replaceAll('_', ' ')}'),
      backgroundColor: AppColors.gold.withValues(alpha: 0.12),
    );
  }
}
