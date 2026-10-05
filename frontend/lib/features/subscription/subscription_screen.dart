import 'package:flutter/material.dart';
import 'package:go_router/go_router.dart';
import 'package:signals_flutter/signals_flutter.dart'
    hide AsyncState, AsyncLoading, AsyncData, AsyncError;

import '../../app/localization/app_localizations_wrapper.dart';
import '../../app/router.dart';
import '../../app/theme/app_colors.dart';
import '../../core/di/service_locator.dart';
import '../../data/models/subscription_models.dart';
import '../../features/payment/checkout_nav.dart';
import '../../shared/widgets/app_scaffold.dart';
import 'subscription_store.dart';

class SubscriptionScreen extends StatefulWidget {
  const SubscriptionScreen({super.key});

  @override
  State<SubscriptionScreen> createState() => _SubscriptionScreenState();
}

class _SubscriptionScreenState extends State<SubscriptionScreen> {
  late final SubscriptionStore _store;

  @override
  void initState() {
    super.initState();
    _store = ServiceLocator.instance.subscriptionStore;
    _store.listen();
    _store.load();
  }

  @override
  Widget build(BuildContext context) {
    final l10n = context.l10n;
    return AppScaffold(
      title: l10n.subscription,
      body: SignalBuilder(
        builder: (context) {
          if (_store.isGuest) {
            return _CenteredMessage(
              title: l10n.signInToContinue,
              action: l10n.login,
              onPressed: () => context.push(AppRoutes.login),
            );
          }

          final snapState = _store.snapshot.value;
          if (snapState.isLoading && snapState.dataOrNull == null) {
            return const Center(child: CircularProgressIndicator());
          }
          if (snapState.hasError && snapState.dataOrNull == null) {
            return _CenteredMessage(
              title: snapState.errorMessage ?? l10n.subscriptionLoadError,
              action: l10n.retry,
              onPressed: _store.load,
            );
          }

          final snap = snapState.dataOrNull;
          final catalog = _store.plans.value.dataOrNull ?? const [];
          final invoices = _store.invoices.value.dataOrNull ?? const [];
          final error = _store.errorMessage.value;

          return RefreshIndicator(
            onRefresh: _store.load,
            child: ListView(
              padding: const EdgeInsets.fromLTRB(16, 16, 16, 48),
              children: [
                if (error != null)
                  Card(
                    color: Theme.of(context).colorScheme.errorContainer,
                    child: ListTile(
                      leading: const Icon(Icons.error_outline),
                      title: Text(error),
                    ),
                  ),
                if (snap?.overLimit == true)
                  Card(
                    color: AppColors.charcoalSurface,
                    child: ListTile(
                      leading: const Icon(Icons.warning_amber_outlined, color: AppColors.gold),
                      title: Text(l10n.subscriptionOverLimit),
                      subtitle: Text(snap?.overLimitMessage ?? l10n.subscriptionOverLimitHint),
                    ),
                  ),
                if (snap != null) _CurrentPlanCard(snapshot: snap, store: _store),
                const SizedBox(height: 20),
                Text(l10n.choosePlan, style: Theme.of(context).textTheme.titleMedium),
                const SizedBox(height: 8),
                SegmentedButton<String>(
                  segments: [
                    ButtonSegment(value: 'monthly', label: Text(l10n.billingMonthly)),
                    ButtonSegment(value: 'yearly', label: Text(l10n.billingYearly)),
                  ],
                  selected: {_store.interval.value},
                  onSelectionChanged: (value) => _store.interval.value = value.first,
                ),
                const SizedBox(height: 12),
                ...catalog.map((plan) => _PlanCard(plan: plan, snapshot: snap, store: _store)),
                if (snap != null && snap.usage.isNotEmpty) ...[
                  const SizedBox(height: 24),
                  Text(l10n.subscriptionUsage, style: Theme.of(context).textTheme.titleMedium),
                  const SizedBox(height: 8),
                  ...snap.usage.map(_UsageTile.new),
                ],
                if (invoices.isNotEmpty) ...[
                  const SizedBox(height: 24),
                  Text(l10n.subscriptionInvoices, style: Theme.of(context).textTheme.titleMedium),
                  const SizedBox(height: 8),
                  ...invoices.map(
                    (invoice) => ListTile(
                      leading: const Icon(Icons.receipt_long_outlined),
                      title: Text(invoice.invoiceNumber),
                      subtitle: Text(invoice.issuedAt?.split('T').first ?? invoice.status),
                      trailing: Text(
                        '${invoice.totalAmount.toStringAsFixed(2)} ${invoice.currency}',
                      ),
                    ),
                  ),
                ],
                const SizedBox(height: 16),
                ListTile(
                  leading: const Icon(Icons.support_agent_outlined),
                  title: const Text('Billing support'),
                  subtitle: const Text('Plans, renewals and invoices share the same support platform'),
                  onTap: () => context.push(
                    AppRoutes.supportWith(const SupportContextQuery(category: 'subscriptions', entityType: 'subscription')),
                  ),
                ),
              ],
            ),
          );
        },
      ),
    );
  }
}

class _CurrentPlanCard extends StatelessWidget {
  const _CurrentPlanCard({required this.snapshot, required this.store});

  final SubscriptionSnapshot snapshot;
  final SubscriptionStore store;

  @override
  Widget build(BuildContext context) {
    final l10n = context.l10n;
    final sub = snapshot.subscription;
    final name = sub?.planName ?? snapshot.entitlements.planCode;
    final pending = sub?.pendingPlanName;
    return Card(
      child: Padding(
        padding: const EdgeInsets.all(16),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Text(l10n.currentPlan, style: Theme.of(context).textTheme.labelLarge),
            const SizedBox(height: 4),
            Text(name, style: Theme.of(context).textTheme.headlineSmall),
            if (sub?.status != null)
              Text('${l10n.status}: ${sub!.status}'),
            if (sub?.currentPeriodEnd != null)
              Text('${l10n.renewsOn}: ${sub!.currentPeriodEnd!.split('T').first}'),
            if (pending != null) Text('${l10n.pendingChange}: $pending'),
            if (sub?.cancelAtPeriodEnd == true) Text(l10n.cancelsAtPeriodEnd),
            const SizedBox(height: 12),
            if (sub?.cancelAtPeriodEnd == true)
              OutlinedButton(
                onPressed: store.busy.value ? null : () => store.resume(),
                child: Text(l10n.resumePlan),
              )
            else if ((sub?.tier ?? snapshot.entitlements.planTier) > 0)
              OutlinedButton(
                onPressed: store.busy.value
                    ? null
                    : () async {
                        final ok = await showDialog<bool>(
                          context: context,
                          builder: (context) => AlertDialog(
                            title: Text(l10n.cancelPlan),
                            content: Text(l10n.cancelPlanHint),
                            actions: [
                              TextButton(
                                onPressed: () => Navigator.pop(context, false),
                                child: Text(MaterialLocalizations.of(context).cancelButtonLabel),
                              ),
                              FilledButton(
                                onPressed: () => Navigator.pop(context, true),
                                child: Text(l10n.cancelPlan),
                              ),
                            ],
                          ),
                        );
                        if (ok == true) await store.cancelAtPeriodEnd();
                      },
                child: Text(l10n.cancelPlan),
              ),
          ],
        ),
      ),
    );
  }
}

class _PlanCard extends StatelessWidget {
  const _PlanCard({required this.plan, required this.snapshot, required this.store});

  final SubscriptionPlan plan;
  final SubscriptionSnapshot? snapshot;
  final SubscriptionStore store;

  @override
  Widget build(BuildContext context) {
    final l10n = context.l10n;
    final currentCode = snapshot?.entitlements.planCode;
    final currentTier = snapshot?.entitlements.planTier ?? 0;
    final isCurrent = currentCode == plan.code;
    final price = plan.priceFor(store.interval.value);
    final highlights = plan.features.where((f) => f.enabled).take(6).toList();

    String actionLabel;
    if (isCurrent) {
      actionLabel = l10n.currentPlan;
    } else if (plan.tier > currentTier) {
      actionLabel = l10n.upgradePlan;
    } else if (plan.tier < currentTier) {
      actionLabel = l10n.downgradePlan;
    } else {
      actionLabel = l10n.selectPlan;
    }

    return Card(
      margin: const EdgeInsets.only(bottom: 12),
      shape: isCurrent
          ? RoundedRectangleBorder(
              borderRadius: BorderRadius.circular(12),
              side: const BorderSide(color: AppColors.gold, width: 1.4),
            )
          : null,
      child: Padding(
        padding: const EdgeInsets.all(16),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Row(
              children: [
                Expanded(
                  child: Text(plan.name, style: Theme.of(context).textTheme.titleLarge),
                ),
                if (price != null)
                  Text(
                    price.amount <= 0
                        ? l10n.freePlan
                        : '${price.amount.toStringAsFixed(0)} ${price.currency}',
                    style: Theme.of(context).textTheme.titleMedium?.copyWith(color: AppColors.gold),
                  ),
              ],
            ),
            if (plan.description != null) ...[
              const SizedBox(height: 4),
              Text(plan.description!),
            ],
            const SizedBox(height: 8),
            ...highlights.map(
              (feature) => Padding(
                padding: const EdgeInsets.only(bottom: 4),
                child: Row(
                  children: [
                    const Icon(Icons.check, size: 16, color: AppColors.success),
                    const SizedBox(width: 8),
                    Expanded(
                      child: Text(
                        feature.unlimited
                            ? feature.name
                            : feature.limit == null
                                ? feature.name
                                : '${feature.name}: ${feature.limit}',
                      ),
                    ),
                  ],
                ),
              ),
            ),
            const SizedBox(height: 12),
            FilledButton(
              onPressed: isCurrent || store.busy.value
                  ? null
                  : () async {
                      final result = await store.selectPlan(plan);
                      if (!context.mounted) return;
                      result.when(
                        success: (checkout) {
                          if (checkout.requiresPayment && checkout.orderUuid != null) {
                            pushCheckout(context, checkout);
                            return;
                          }
                          final message = checkout.scheduled
                              ? l10n.planChangeScheduled
                              : checkout.overLimitMessage ?? l10n.planUpdated;
                          ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(message)));
                        },
                        failure: (m, _) =>
                            ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(m))),
                      );
                    },
              child: Text(actionLabel),
            ),
          ],
        ),
      ),
    );
  }
}

class _UsageTile extends StatelessWidget {
  const _UsageTile(this.meter);

  final UsageMeter meter;

  @override
  Widget build(BuildContext context) {
    final label = meter.unlimited
        ? '${meter.featureCode} · ${meter.used}'
        : '${meter.featureCode} · ${meter.used}/${meter.limit ?? '—'}';
    return Padding(
      padding: const EdgeInsets.only(bottom: 10),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Text(label),
          const SizedBox(height: 4),
          LinearProgressIndicator(
            value: meter.unlimited ? 0 : meter.fraction,
            color: AppColors.gold,
            backgroundColor: AppColors.charcoalSurface,
          ),
        ],
      ),
    );
  }
}

class _CenteredMessage extends StatelessWidget {
  const _CenteredMessage({required this.title, required this.action, required this.onPressed});

  final String title;
  final String action;
  final VoidCallback onPressed;

  @override
  Widget build(BuildContext context) {
    return Center(
      child: Padding(
        padding: const EdgeInsets.all(24),
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            Text(title, textAlign: TextAlign.center),
            const SizedBox(height: 16),
            FilledButton(onPressed: onPressed, child: Text(action)),
          ],
        ),
      ),
    );
  }
}
