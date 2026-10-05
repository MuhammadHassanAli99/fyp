import 'package:flutter/material.dart';
import 'package:go_router/go_router.dart';
import 'package:signals_flutter/signals_flutter.dart'
    hide AsyncState, AsyncLoading, AsyncData, AsyncError;
import 'package:timeago/timeago.dart' as timeago;

import '../../app/localization/app_localizations_wrapper.dart';
import '../../app/router.dart';
import '../../core/auth/guest_feature.dart';
import '../../core/di/service_locator.dart';
import '../../core/result/async_state.dart';
import '../../data/models/notification_models.dart';
import '../../data/services/notification_deeplink.dart';
import '../../shared/extensions/context_extensions.dart';
import '../../shared/widgets/app_scaffold.dart';
import 'notification_store.dart';

class NotificationCenterScreen extends StatefulWidget {
  const NotificationCenterScreen({super.key});

  @override
  State<NotificationCenterScreen> createState() => _NotificationCenterScreenState();
}

class _NotificationCenterScreenState extends State<NotificationCenterScreen> {
  late final NotificationCenterStore _store;
  final _scroll = ScrollController();

  @override
  void initState() {
    super.initState();
    final sl = ServiceLocator.instance;
    _store = NotificationCenterStore(sl.notificationsRepository, sl.realtimeClient);
    _store.listen();
    _store.load();
    _scroll.addListener(() {
      if (_scroll.position.pixels > _scroll.position.maxScrollExtent - 400) {
        _store.loadMore();
      }
    });
  }

  @override
  void dispose() {
    _scroll.dispose();
    _store.dispose();
    super.dispose();
  }

  String _filterLabel(BuildContext context, String code) {
    final l10n = context.l10n;
    return switch (code) {
      'unread' => l10n.notificationsUnread,
      'gold' => l10n.goldMarketplace,
      'property' => l10n.propertyMarketplace,
      'vehicles' => l10n.vehiclesMarketplace,
      'messages' => l10n.notificationsMessages,
      'security' => l10n.notificationsSecurity,
      'payments' => l10n.notificationsPayments,
      'system' => l10n.notificationsSystem,
      _ => l10n.notificationsAll,
    };
  }

  @override
  Widget build(BuildContext context) {
    final l10n = context.l10n;
    return AppScaffold(
      title: l10n.notifications,
      actions: [
        IconButton(
          tooltip: l10n.notificationSettings,
          onPressed: () => context.push(AppRoutes.notificationSettings),
          icon: const Icon(Icons.tune),
        ),
        IconButton(
          tooltip: l10n.markAllRead,
          onPressed: _store.markAllRead,
          icon: const Icon(Icons.done_all),
        ),
      ],
      body: GuestGate(
        feature: GuestFeature.account,
        message: l10n.guestRestrictionMessage,
        child: Column(
          children: [
            SignalBuilder(builder: (context) {
              final selected = _store.filter.value;
              return SizedBox(
                height: 48,
                child: ListView(
                  scrollDirection: Axis.horizontal,
                  padding: const EdgeInsets.symmetric(horizontal: 12),
                  children: [
                    for (final code in NotificationCenterStore.filters)
                      Padding(
                        padding: const EdgeInsets.only(right: 8, top: 8),
                        child: ChoiceChip(
                          label: Text(_filterLabel(context, code)),
                          selected: selected == code,
                          onSelected: (_) => _store.setFilter(code),
                        ),
                      ),
                  ],
                ),
              );
            }),
            Expanded(
              child: SignalBuilder(builder: (context) {
                final state = _store.items.value;
                if (state.isLoading && state.dataOrNull == null) {
                  return LoadingView(message: l10n.notificationsLoading);
                }
                if (state case AsyncError(:final message)) {
                  return EmptyState(
                    title: l10n.notificationsLoadError,
                    subtitle: message,
                    action: FilledButton(onPressed: _store.load, child: Text(l10n.retry)),
                  );
                }
                final list = state.dataOrNull ?? [];
                if (list.isEmpty) {
                  return EmptyState(
                    title: l10n.notificationsEmpty,
                    subtitle: l10n.notificationsEmptyHint,
                  );
                }
                final wide = context.isWide;
                return RefreshIndicator(
                  onRefresh: _store.load,
                  child: ListView.separated(
                    controller: _scroll,
                    padding: EdgeInsets.symmetric(
                      horizontal: wide ? 24 : 8,
                      vertical: 8,
                    ),
                    itemCount: list.length,
                    separatorBuilder: (_, _) => const Divider(height: 1),
                    itemBuilder: (context, index) => _NotificationTile(
                      item: list[index],
                      onOpen: () async {
                        await _store.markRead(list[index].uuid);
                        if (!context.mounted) return;
                        context.push('/notifications/${list[index].uuid}');
                      },
                      onDismiss: () => _store.hide(list[index].uuid),
                    ),
                  ),
                );
              }),
            ),
          ],
        ),
      ),
    );
  }
}

class _NotificationTile extends StatelessWidget {
  const _NotificationTile({
    required this.item,
    required this.onOpen,
    required this.onDismiss,
  });

  final NotificationItem item;
  final VoidCallback onOpen;
  final VoidCallback onDismiss;

  IconData get _icon {
    if (item.categoryCode.startsWith('chat.')) return Icons.chat_bubble_outline;
    if (item.categoryCode.startsWith('security.') || item.categoryCode.startsWith('account.')) {
      return Icons.shield_outlined;
    }
    if (item.categoryCode.startsWith('payment.') || item.categoryCode.startsWith('subscription.')) {
      return Icons.payments_outlined;
    }
    if (item.marketplace == 'GOLD') return Icons.diamond_outlined;
    if (item.marketplace == 'PROPERTY') return Icons.home_work_outlined;
    if (item.marketplace == 'VEHICLE') return Icons.directions_car_outlined;
    return Icons.notifications_outlined;
  }

  @override
  Widget build(BuildContext context) {
    final unread = !item.isRead;
    return Dismissible(
      key: ValueKey(item.uuid),
      direction: DismissDirection.endToStart,
      onDismissed: (_) => onDismiss(),
      background: Container(
        alignment: Alignment.centerRight,
        padding: const EdgeInsets.only(right: 16),
        color: Theme.of(context).colorScheme.errorContainer,
        child: const Icon(Icons.delete_outline),
      ),
      child: ListTile(
        leading: CircleAvatar(
          backgroundColor: unread
              ? Theme.of(context).colorScheme.primaryContainer
              : Theme.of(context).colorScheme.surfaceContainerHighest,
          child: Icon(_icon, size: 20),
        ),
        title: Text(
          item.title,
          maxLines: 1,
          overflow: TextOverflow.ellipsis,
          style: TextStyle(fontWeight: unread ? FontWeight.w600 : FontWeight.w400),
        ),
        subtitle: Text(
          [
            if (item.body != null && item.body!.isNotEmpty) item.body!,
            timeago.format(item.createdAt),
          ].join(' · '),
          maxLines: 2,
          overflow: TextOverflow.ellipsis,
        ),
        trailing: unread
            ? Container(
                width: 8,
                height: 8,
                decoration: BoxDecoration(
                  color: Theme.of(context).colorScheme.primary,
                  shape: BoxShape.circle,
                ),
              )
            : null,
        onTap: onOpen,
      ),
    );
  }
}

class NotificationDetailScreen extends StatefulWidget {
  const NotificationDetailScreen({super.key, required this.uuid});
  final String uuid;

  @override
  State<NotificationDetailScreen> createState() => _NotificationDetailScreenState();
}

class _NotificationDetailScreenState extends State<NotificationDetailScreen> {
  NotificationItem? _item;
  String? _error;

  @override
  void initState() {
    super.initState();
    _load();
  }

  Future<void> _load() async {
    final result = await ServiceLocator.instance.notificationsRepository.getOne(widget.uuid);
    if (!mounted) return;
    result.when(
      success: (item) => setState(() => _item = item),
      failure: (m, _) => setState(() => _error = m),
    );
    await ServiceLocator.instance.notificationsRepository.markRead(widget.uuid);
  }

  @override
  Widget build(BuildContext context) {
    final l10n = context.l10n;
    final item = _item;
    return AppScaffold(
      title: l10n.notifications,
      body: item == null
          ? (_error != null
              ? EmptyState(title: l10n.notificationsLoadError, subtitle: _error)
              : LoadingView(message: l10n.notificationsLoading))
          : ListView(
              padding: const EdgeInsets.all(20),
              children: [
                Text(item.title, style: Theme.of(context).textTheme.headlineSmall),
                const SizedBox(height: 8),
                Text(timeago.format(item.createdAt), style: Theme.of(context).textTheme.bodySmall),
                if (item.body != null) ...[
                  const SizedBox(height: 16),
                  Text(item.body!),
                ],
                const SizedBox(height: 24),
                FilledButton(
                  onPressed: () {
                    final route = safeNotificationRoute(
                      item.deepLink,
                      actionType: item.actionType,
                      actionTarget: item.actionTarget,
                    );
                    openNotificationRoute(context, route);
                  },
                  child: Text(l10n.openNotification),
                ),
              ],
            ),
    );
  }
}
