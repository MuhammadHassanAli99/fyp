import 'package:cached_network_image/cached_network_image.dart';
import 'package:flutter/material.dart';
import 'package:go_router/go_router.dart';
import 'package:signals_flutter/signals_flutter.dart'
    hide AsyncState, AsyncLoading, AsyncData, AsyncError;

import '../../app/theme/app_colors.dart';
import '../../core/di/service_locator.dart';
import '../../shared/widgets/app_scaffold.dart';
import '../../shared/widgets/listing_card.dart';
import '../reviews/reviews_section.dart';
import 'profile_store.dart';

class PublicProfileScreen extends StatefulWidget {
  const PublicProfileScreen({super.key, required this.username});

  final String username;

  @override
  State<PublicProfileScreen> createState() => _PublicProfileScreenState();
}

class _PublicProfileScreenState extends State<PublicProfileScreen> {
  late final ProfileStore _store;

  @override
  void initState() {
    super.initState();
    _store = ServiceLocator.instance.profileStore;
    WidgetsBinding.instance.addPostFrameCallback((_) {
      if (mounted) _store.loadPublic(widget.username);
    });
  }

  @override
  Widget build(BuildContext context) {
    return AppScaffold(
      title: '@${widget.username}',
      body: SignalBuilder(
        builder: (context) {
          final state = _store.publicProfile.value;
          if (state.isLoading && state.dataOrNull == null) {
            return const LoadingView(message: 'Loading profile…');
          }
          if (state.hasError && state.dataOrNull == null) {
            return EmptyState(
              title: 'Profile not found',
              subtitle: state.errorMessage,
              action: TextButton(
                onPressed: () => _store.loadPublic(widget.username),
                child: const Text('Retry'),
              ),
            );
          }
          final profile = state.dataOrNull;
          if (profile == null) {
            return const EmptyState(title: 'Profile not found');
          }
          final listings = _store.publicListings.value.dataOrNull?.items ?? const [];
          final reviews = _store.publicReviews.value.dataOrNull ?? const [];

          return ListView(
            padding: const EdgeInsets.fromLTRB(16, 24, 16, 48),
            children: [
              Center(
                child: CircleAvatar(
                  radius: 44,
                  backgroundColor: AppColors.charcoalSurface,
                  backgroundImage: profile.avatarUrl != null
                      ? CachedNetworkImageProvider(profile.avatarUrl!)
                      : null,
                  child: profile.avatarUrl == null
                      ? Text(
                          profile.displayName.isEmpty
                              ? 'U'
                              : profile.displayName[0].toUpperCase(),
                          style: const TextStyle(fontSize: 28, color: AppColors.gold),
                        )
                      : null,
                ),
              ),
              const SizedBox(height: 12),
              Text(
                profile.displayName,
                textAlign: TextAlign.center,
                style: Theme.of(context).textTheme.headlineSmall,
              ),
              Text(
                '@${profile.username}',
                textAlign: TextAlign.center,
                style: const TextStyle(color: AppColors.gold),
              ),
              if (profile.verificationLabel != null)
                Padding(
                  padding: const EdgeInsets.only(top: 8),
                  child: Row(
                    mainAxisAlignment: MainAxisAlignment.center,
                    children: [
                      const Icon(Icons.verified, color: AppColors.success, size: 18),
                      const SizedBox(width: 6),
                      Text(profile.verificationLabel!),
                    ],
                  ),
                ),
              const SizedBox(height: 8),
              Text(
                'Trust: ${profile.trustLevel} · ${profile.ratingAverage.toStringAsFixed(1)} (${profile.ratingCount})',
                textAlign: TextAlign.center,
              ),
              if (profile.city != null || profile.country != null)
                Text(
                  [profile.city, profile.country].whereType<String>().join(', '),
                  textAlign: TextAlign.center,
                ),
              if (profile.bio != null) ...[
                const SizedBox(height: 16),
                Text(profile.bio!, textAlign: TextAlign.center),
              ],
              if (profile.businesses.isNotEmpty) ...[
                const SizedBox(height: 24),
                Text('Businesses', style: Theme.of(context).textTheme.titleMedium),
                const SizedBox(height: 8),
                for (final business in profile.businesses)
                  Card(
                    child: ListTile(
                      leading: const Icon(Icons.apartment_outlined, color: AppColors.gold),
                      title: Text(business.name),
                      subtitle: Text(business.kindLabel),
                      trailing: business.verified
                          ? const Icon(Icons.verified, color: AppColors.success)
                          : null,
                      onTap: () => context.push('/business/${business.id}'),
                    ),
                  ),
              ],
              if (listings.isNotEmpty) ...[
                const SizedBox(height: 24),
                Text('Listings', style: Theme.of(context).textTheme.titleMedium),
                const SizedBox(height: 8),
                for (final listing in listings.take(12))
                  Padding(
                    padding: const EdgeInsets.only(bottom: 12),
                    child: ListingCard(
                      listing: listing,
                      onTap: () => context.push('/listing/${listing.routeId}'),
                    ),
                  ),
              ],
              if (profile.showReviews && profile.id > 0)
                ReviewsSection.forUser(userId: profile.id)
              else if (reviews.isNotEmpty) ...[
                const SizedBox(height: 24),
                Text('Reviews', style: Theme.of(context).textTheme.titleMedium),
                for (final review in reviews.take(10))
                  Card(
                    child: ListTile(
                      title: Text('${review['rating'] ?? ''} · ${review['title'] ?? 'Review'}'),
                      subtitle: Text(review['body'] as String? ?? ''),
                    ),
                  ),
              ],
            ],
          );
        },
      ),
    );
  }
}
