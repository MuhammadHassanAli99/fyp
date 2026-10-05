import 'package:cached_network_image/cached_network_image.dart';
import 'package:flutter/material.dart';
import 'package:go_router/go_router.dart';
import 'package:signals_flutter/signals_flutter.dart'
    hide AsyncState, AsyncLoading, AsyncData, AsyncError;

import '../../app/localization/app_localizations_wrapper.dart';
import '../../app/router.dart';
import '../../app/theme/app_colors.dart';
import '../../core/di/service_locator.dart';
import '../../shared/widgets/app_scaffold.dart';
import 'profile_store.dart';

class ProfileScreen extends StatefulWidget {
  const ProfileScreen({super.key});

  @override
  State<ProfileScreen> createState() => _ProfileScreenState();
}

class _ProfileScreenState extends State<ProfileScreen> {
  late final ProfileStore _store;

  @override
  void initState() {
    super.initState();
    final sl = ServiceLocator.instance;
    _store = sl.profileStore;
    WidgetsBinding.instance.addPostFrameCallback((_) {
      if (!mounted) return;
      _store.loadMine();
      _store.loadBusinesses();
      _store.loadVerification();
    });
  }

  @override
  Widget build(BuildContext context) {
    final l10n = context.l10n;
    final isGuest = _store.isGuest;

    return AppScaffold(
      title: l10n.profile,
      actions: [
        if (!isGuest)
          IconButton(
            tooltip: l10n.editProfile,
            onPressed: () => context.push(AppRoutes.profileEdit),
            icon: const Icon(Icons.edit_outlined),
          ),
      ],
      body: SignalBuilder(
        builder: (context) {
          final me = _store.me.value.dataOrNull;
          final profile = me?['profile'] is Map
              ? Map<String, dynamic>.from(me!['profile'] as Map)
              : const <String, dynamic>{};
          final name = profile['displayName'] as String? ??
              _store.currentUser?.name ??
              (isGuest ? 'Guest' : 'User');
          final username = me?['username'] as String? ??
              _store.currentUser?.username;
          final avatar = profile['avatarUrl'] as String? ??
              profile['avatarThumbUrl'] as String?;
          final bio = profile['bio'] as String?;
          final completeness = (profile['completeness'] as num?)?.toInt() ?? 0;
          final verification = _store.verification.value.dataOrNull;
          final businesses = _store.businesses.value.dataOrNull ?? const [];

          return Center(
            child: ConstrainedBox(
              constraints: BoxConstraints(maxWidth: contextWidth(context)),
              child: ListView(
                padding: const EdgeInsets.fromLTRB(16, 24, 16, 48),
                children: [
                  Center(child: _Avatar(url: avatar, name: name, radius: 44)),
                  const SizedBox(height: 16),
                  Text(
                    name,
                    textAlign: TextAlign.center,
                    style: Theme.of(context).textTheme.headlineSmall,
                  ),
                  if (username != null && username.isNotEmpty)
                    Text(
                      '@$username',
                      textAlign: TextAlign.center,
                      style: Theme.of(context).textTheme.bodyMedium?.copyWith(
                            color: AppColors.gold,
                          ),
                    ),
                  if (verification != null &&
                      (verification.identityVerified ||
                          verification.businessVerified))
                    Padding(
                      padding: const EdgeInsets.only(top: 8),
                      child: Wrap(
                        alignment: WrapAlignment.center,
                        spacing: 8,
                        children: [
                          if (verification.identityVerified)
                            const _Badge(label: 'Identity verified'),
                          if (verification.businessVerified)
                            const _Badge(label: 'Business verified'),
                        ],
                      ),
                    ),
                  if (bio != null && bio.isNotEmpty) ...[
                    const SizedBox(height: 12),
                    Text(bio, textAlign: TextAlign.center),
                  ],
                  if (!isGuest) ...[
                    const SizedBox(height: 16),
                    LinearProgressIndicator(
                      value: completeness / 100,
                      color: AppColors.gold,
                      backgroundColor: AppColors.charcoalSurface,
                    ),
                    const SizedBox(height: 6),
                    Text(
                      'Profile $completeness% complete',
                      textAlign: TextAlign.center,
                      style: Theme.of(context).textTheme.bodySmall,
                    ),
                  ],
                  const SizedBox(height: 28),
                  if (isGuest)
                    FilledButton(
                      onPressed: () => context.push(AppRoutes.login),
                      child: Text(l10n.signInToContinue),
                    )
                  else ...[
                    _ProfileTile(
                      icon: Icons.workspace_premium_outlined,
                      title: l10n.subscription,
                      subtitle: l10n.subscriptionSubtitle,
                      onTap: () => context.push(AppRoutes.subscription),
                    ),
                    _ProfileTile(
                      icon: Icons.campaign_outlined,
                      title: 'Advertise',
                      subtitle: 'Campaigns, sponsored listings and billing',
                      onTap: () => context.push(AppRoutes.advertise),
                    ),
                    if (ServiceLocator.instance.authRepository.currentUser?.hasAdminAccess == true)
                      _ProfileTile(
                        icon: Icons.admin_panel_settings_outlined,
                        title: 'Control Plane',
                        subtitle: 'Users, companies, listings, finance, trust and operations',
                        onTap: () => context.push(AppRoutes.admin),
                      ),
                    _ProfileTile(
                      icon: Icons.support_agent_outlined,
                      title: 'Help & Support',
                      subtitle: 'Tickets, live chat, knowledge base, AI and forum',
                      onTap: () => context.push(AppRoutes.support),
                    ),
                    _ProfileTile(
                      icon: Icons.edit_outlined,
                      title: l10n.editProfile,
                      subtitle: 'Name, username, bio and photo',
                      onTap: () => context.push(AppRoutes.profileEdit),
                    ),
                    _ProfileTile(
                      icon: Icons.verified_outlined,
                      title: l10n.verification,
                      subtitle: verification?.overallStatus ?? 'Not started',
                      onTap: () => context.push(AppRoutes.verification),
                    ),
                    _ProfileTile(
                      icon: Icons.apartment_outlined,
                      title: l10n.businessProfiles,
                      subtitle: businesses.isEmpty
                          ? 'Company, dealer, agency, builder, gold shop'
                          : '${businesses.length} business${businesses.length == 1 ? '' : 'es'}',
                      onTap: () => context.push(AppRoutes.businesses),
                    ),
                    _ProfileTile(
                      icon: Icons.lock_outline,
                      title: l10n.privacy,
                      onTap: () => context.push(AppRoutes.profilePrivacy),
                    ),
                    if (username != null && username.isNotEmpty)
                      _ProfileTile(
                        icon: Icons.public_outlined,
                        title: 'Public profile',
                        onTap: () => context.push('/u/$username'),
                      ),
                    _ProfileTile(
                      icon: Icons.view_list_outlined,
                      title: l10n.myAds,
                      subtitle:
                          'View and manage all your gold, property & vehicle ads',
                      onTap: () => context.push(AppRoutes.seller),
                    ),
                  ],
                  _ProfileTile(
                    icon: Icons.settings_outlined,
                    title: l10n.settings,
                    onTap: () => context.push(AppRoutes.settings),
                  ),
                  if (!isGuest) ...[
                    _ProfileTile(
                      icon: Icons.devices_outlined,
                      title: 'Devices & sessions',
                      subtitle: 'See where you are signed in and sign out remotely',
                      onTap: () => context.push(AppRoutes.devices),
                    ),
                    ListTile(
                      leading: const Icon(Icons.logout, color: AppColors.goldMuted),
                      title: Text(l10n.logout),
                      onTap: () async {
                        await ServiceLocator.instance.authRepository.logout();
                        ServiceLocator.instance.routerRefresh.refresh();
                        if (context.mounted) context.go(AppRoutes.login);
                      },
                    ),
                  ],
                ],
              ),
            ),
          );
        },
      ),
    );
  }
}

double contextWidth(BuildContext context) {
  final width = MediaQuery.sizeOf(context).width;
  if (width >= 1100) return 720;
  if (width >= 800) return 640;
  return 560;
}

class _Avatar extends StatelessWidget {
  const _Avatar({required this.name, this.url, this.radius = 40});

  final String name;
  final String? url;
  final double radius;

  @override
  Widget build(BuildContext context) {
    final initial = name.isEmpty ? 'U' : name[0].toUpperCase();
    if (url == null || url!.isEmpty) {
      return CircleAvatar(
        radius: radius,
        backgroundColor: AppColors.charcoalSurface,
        child: Text(
          initial,
          style: TextStyle(fontSize: radius * 0.7, color: AppColors.gold),
        ),
      );
    }
    return CircleAvatar(
      radius: radius,
      backgroundColor: AppColors.charcoalSurface,
      backgroundImage: CachedNetworkImageProvider(url!),
    );
  }
}

class _Badge extends StatelessWidget {
  const _Badge({required this.label});
  final String label;

  @override
  Widget build(BuildContext context) {
    return Chip(
      avatar: const Icon(Icons.verified, color: AppColors.success, size: 16),
      label: Text(label),
      visualDensity: VisualDensity.compact,
    );
  }
}

class _ProfileTile extends StatelessWidget {
  const _ProfileTile({
    required this.icon,
    required this.title,
    required this.onTap,
    this.subtitle,
  });

  final IconData icon;
  final String title;
  final String? subtitle;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    return Card(
      margin: const EdgeInsets.only(bottom: 10),
      child: ListTile(
        leading: Icon(icon, color: AppColors.gold),
        title: Text(title),
        subtitle: subtitle != null ? Text(subtitle!) : null,
        trailing: const Icon(Icons.chevron_right, color: AppColors.goldMuted),
        onTap: onTap,
      ),
    );
  }
}
