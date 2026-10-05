import 'package:flutter/material.dart';
import 'package:go_router/go_router.dart';
import 'package:signals_flutter/signals_flutter.dart'
    hide AsyncState, AsyncLoading, AsyncData, AsyncError;

import '../../app/localization/app_localizations_wrapper.dart';
import '../../app/router.dart';
import '../../app/theme/app_colors.dart';
import '../../core/di/service_locator.dart';
import '../../data/models/marketplace_model.dart';
import '../../shared/extensions/context_extensions.dart';
import '../../shared/widgets/app_scaffold.dart';
import 'marketplace_select_store.dart';

class MarketplaceSelectScreen extends StatefulWidget {
  const MarketplaceSelectScreen({super.key});

  @override
  State<MarketplaceSelectScreen> createState() =>
      _MarketplaceSelectScreenState();
}

class _MarketplaceSelectScreenState extends State<MarketplaceSelectScreen> {
  late final MarketplaceSelectStore _store;

  @override
  void initState() {
    super.initState();
    final sl = ServiceLocator.instance;
    _store = MarketplaceSelectStore(sl.catalogRepository, sl.settingsRepository);
    _store.load();
  }

  @override
  Widget build(BuildContext context) {
    final l10n = context.l10n;
    return AppScaffold(
      showBack: false,
      showSellFab: false,
      body: SignalBuilder(builder: (context) {
        final state = _store.marketplaces.value;
        if (state.isLoading) return const LoadingView();
        if (state.hasError && state.dataOrNull == null) {
          return EmptyState(
            title: state.errorMessage ?? l10n.chooseMarketplace,
            action: FilledButton(
              onPressed: _store.load,
              child: Text(l10n.retry),
            ),
          );
        }

        final list = state.dataOrNull ?? [];
        return AnimatedSwitcher(
          duration: const Duration(milliseconds: 400),
          child: SingleChildScrollView(
            key: ValueKey(list.length),
            padding: const EdgeInsets.all(24),
            child: Center(
              child: ConstrainedBox(
                constraints: const BoxConstraints(maxWidth: 900),
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.stretch,
                  children: [
                    Text(
                      l10n.appName,
                      textAlign: TextAlign.center,
                      style: Theme.of(context).textTheme.displaySmall?.copyWith(
                            color: AppColors.gold,
                            letterSpacing: 4,
                          ),
                    ),
                    const SizedBox(height: 12),
                    Text(
                      l10n.chooseMarketplace,
                      textAlign: TextAlign.center,
                      style: Theme.of(context).textTheme.headlineSmall,
                    ),
                    const SizedBox(height: 8),
                    Text(
                      l10n.marketplaceSubtitle,
                      textAlign: TextAlign.center,
                      style: Theme.of(context).textTheme.bodyLarge?.copyWith(
                            color: context.colors.onSurface.withValues(alpha: 0.7),
                          ),
                    ),
                    const SizedBox(height: 32),
                    LayoutBuilder(
                      builder: (context, constraints) {
                        final crossAxisCount = context.isWide ? 3 : 1;
                        return GridView.builder(
                          shrinkWrap: true,
                          physics: const NeverScrollableScrollPhysics(),
                          gridDelegate:
                              SliverGridDelegateWithFixedCrossAxisCount(
                            crossAxisCount: crossAxisCount,
                            crossAxisSpacing: 16,
                            mainAxisSpacing: 16,
                            childAspectRatio: context.isWide ? 0.85 : 1.6,
                          ),
                          itemCount: list.length,
                          itemBuilder: (_, i) => _MarketplaceCard(
                            marketplace: list[i],
                            heroTag: 'marketplace-${list[i].code}',
                            onTap: () async {
                              await _store.select(list[i].code);
                              ServiceLocator.instance.compareStore.clear();
                              ServiceLocator.instance.routerRefresh.refresh();
                              if (context.mounted) context.go(AppRoutes.home);
                            },
                          ),
                        );
                      },
                    ),
                  ],
                ),
              ),
            ),
          ),
        );
      }),
    );
  }
}

class _MarketplaceCard extends StatelessWidget {
  const _MarketplaceCard({
    required this.marketplace,
    required this.heroTag,
    required this.onTap,
  });

  final MarketplaceModel marketplace;
  final String heroTag;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    final l10n = context.l10n;
    final (title, subtitle, icon) = switch (marketplace.code) {
      'gold' => (l10n.goldMarketplace, l10n.goldDescription, Icons.diamond_outlined),
      'property' => (l10n.propertyMarketplace, l10n.propertyDescription, Icons.home_work_outlined),
      'vehicles' => (l10n.vehiclesMarketplace, l10n.vehiclesDescription, Icons.directions_car_outlined),
      _ => (marketplace.name, marketplace.description ?? '', Icons.store_outlined),
    };

    return Hero(
      tag: heroTag,
      child: Material(
        color: Colors.transparent,
        child: InkWell(
          onTap: onTap,
          borderRadius: BorderRadius.circular(20),
          child: Ink(
            decoration: BoxDecoration(
              borderRadius: BorderRadius.circular(20),
              gradient: LinearGradient(
                begin: Alignment.topLeft,
                end: Alignment.bottomRight,
                colors: [
                  AppColors.charcoalLight,
                  AppColors.charcoalSurface,
                ],
              ),
              border: Border.all(color: AppColors.gold.withValues(alpha: 0.35)),
            ),
            child: Padding(
              padding: const EdgeInsets.all(24),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Icon(icon, color: AppColors.gold, size: 36),
                  const Spacer(),
                  Text(title, style: Theme.of(context).textTheme.headlineSmall?.copyWith(
                        color: AppColors.gold,
                      )),
                  const SizedBox(height: 8),
                  Text(
                    subtitle,
                    style: Theme.of(context).textTheme.bodyMedium?.copyWith(
                          color: AppColors.stone.withValues(alpha: 0.85),
                        ),
                  ),
                  const SizedBox(height: 16),
                  Row(
                    children: [
                      Text(l10n.continueLabel,
                          style: const TextStyle(color: AppColors.goldLight)),
                      const SizedBox(width: 4),
                      const Icon(Icons.arrow_forward, color: AppColors.goldLight, size: 18),
                    ],
                  ),
                ],
              ),
            ),
          ),
        ),
      ),
    );
  }
}
