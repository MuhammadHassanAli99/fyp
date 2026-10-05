import 'package:flutter/material.dart';
import 'package:signals_flutter/signals_flutter.dart'
    hide AsyncState, AsyncLoading, AsyncData, AsyncError;

import '../../app/localization/app_localizations_wrapper.dart';
import '../../core/di/service_locator.dart';
import '../../core/result/async_state.dart';
import '../../data/models/notification_models.dart';
import '../../shared/widgets/app_scaffold.dart';
import 'notification_store.dart';

class NotificationSettingsScreen extends StatefulWidget {
  const NotificationSettingsScreen({super.key});

  @override
  State<NotificationSettingsScreen> createState() => _NotificationSettingsScreenState();
}

class _NotificationSettingsScreenState extends State<NotificationSettingsScreen> {
  late final NotificationSettingsStore _store;

  @override
  void initState() {
    super.initState();
    _store = NotificationSettingsStore(ServiceLocator.instance.notificationsRepository);
    _store.load();
  }

  @override
  Widget build(BuildContext context) {
    final l10n = context.l10n;
    return AppScaffold(
      title: l10n.notificationSettings,
      body: SignalBuilder(builder: (context) {
        final state = _store.prefs.value;
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
        final prefs = state.dataOrNull;
        if (prefs == null) return const SizedBox.shrink();
        return ListView(
          padding: const EdgeInsets.all(16),
          children: [
            Text(l10n.quietHours, style: Theme.of(context).textTheme.titleMedium),
            SwitchListTile(
              title: Text(l10n.quietHours),
              subtitle: Text(
                '${prefs.quietHours.startTime ?? '23:00'} → ${prefs.quietHours.endTime ?? '07:00'}',
              ),
              value: prefs.quietHours.enabled,
              onChanged: (v) => _store.setQuietHours(enabled: v),
            ),
            SwitchListTile(
              title: Text(l10n.quietHoursAllowUrgent),
              value: prefs.quietHours.allowUrgent,
              onChanged: (v) => _store.setQuietHours(allowUrgent: v),
            ),
            const Divider(height: 32),
            Text(l10n.channelPreferences, style: Theme.of(context).textTheme.titleMedium),
            const SizedBox(height: 8),
            for (final category in prefs.categories) _CategoryCard(category: category, store: _store),
          ],
        );
      }),
    );
  }
}

class _CategoryCard extends StatelessWidget {
  const _CategoryCard({required this.category, required this.store});

  final NotificationCategoryPref category;
  final NotificationSettingsStore store;

  @override
  Widget build(BuildContext context) {
    final l10n = context.l10n;
    return Card(
      margin: const EdgeInsets.only(bottom: 12),
      child: Padding(
        padding: const EdgeInsets.fromLTRB(12, 8, 12, 8),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Text(category.name, style: Theme.of(context).textTheme.titleSmall),
            if (category.locked)
              Padding(
                padding: const EdgeInsets.only(top: 4),
                child: Text(
                  l10n.securityNotificationsLocked,
                  style: Theme.of(context).textTheme.bodySmall,
                ),
              ),
            Wrap(
              spacing: 8,
              children: [
                FilterChip(
                  label: Text(l10n.channelPush),
                  selected: category.pushEnabled,
                  onSelected: category.locked
                      ? null
                      : (v) => store.setChannel(category.categoryCode, push: v),
                ),
                FilterChip(
                  label: Text(l10n.channelInApp),
                  selected: category.inAppEnabled,
                  onSelected: (v) => store.setChannel(category.categoryCode, inApp: v),
                ),
                FilterChip(
                  label: Text(l10n.channelEmail),
                  selected: category.emailEnabled,
                  onSelected: category.locked
                      ? null
                      : (v) => store.setChannel(category.categoryCode, email: v),
                ),
                FilterChip(
                  label: Text(l10n.channelSms),
                  selected: category.smsEnabled,
                  onSelected: category.locked
                      ? null
                      : (v) => store.setChannel(category.categoryCode, sms: v),
                ),
              ],
            ),
          ],
        ),
      ),
    );
  }
}
