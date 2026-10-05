import 'package:flutter/material.dart';
import 'package:go_router/go_router.dart';
import 'package:signals_flutter/signals_flutter.dart'
    hide AsyncState, AsyncLoading, AsyncData, AsyncError;

import '../../app/theme/app_colors.dart';
import '../../core/di/service_locator.dart';
import 'data/review_models.dart';
import 'reviews_store.dart';

class ReviewsSection extends StatefulWidget {
  const ReviewsSection({
    super.key,
    required this.listingId,
    this.isOwner = false,
  }) : userId = null;

  const ReviewsSection.forUser({
    super.key,
    required this.userId,
    this.isOwner = false,
  })  : listingId = 0;

  final int listingId;
  final int? userId;
  final bool isOwner;

  @override
  State<ReviewsSection> createState() => _ReviewsSectionState();
}

class _ReviewsSectionState extends State<ReviewsSection> {
  late final ReviewsStore _store;

  @override
  void initState() {
    super.initState();
    _store = ReviewsStore(ServiceLocator.instance.reviewsApi);
    final userId = widget.userId;
    if (userId != null && userId > 0) {
      _store.loadForSeller(userId);
    } else if (widget.listingId > 0) {
      _store.loadForListing(widget.listingId);
    }
  }

  Future<void> _helpful(ReviewItem review) async {
    try {
      await _store.helpful(review.uuid, helpful: true);
    } catch (e) {
      if (!mounted) return;
      ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text('$e')));
    }
  }

  Future<void> _report(ReviewItem review) async {
    final reason = await _prompt(title: 'Report review', label: 'Reason', maxLines: 3);
    if (reason == null || reason.isEmpty) return;
    try {
      await _store.report(review.uuid, reason: reason);
      if (!mounted) return;
      ScaffoldMessenger.of(context).showSnackBar(const SnackBar(content: Text('Report submitted')));
    } catch (e) {
      if (!mounted) return;
      ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text('$e')));
    }
  }

  Future<void> _reply(ReviewItem review) async {
    final body = await _prompt(title: 'Official reply', label: 'Reply', maxLines: 4);
    if (body == null || body.isEmpty) return;
    try {
      await _store.reply(review.uuid, body);
      if (!mounted) return;
      ScaffoldMessenger.of(context).showSnackBar(const SnackBar(content: Text('Reply published')));
    } catch (e) {
      if (!mounted) return;
      ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text('$e')));
    }
  }

  Future<String?> _prompt({
    required String title,
    required String label,
    int maxLines = 1,
  }) async {
    final controller = TextEditingController();
    final result = await showDialog<String>(
      context: context,
      builder: (context) => AlertDialog(
        title: Text(title),
        content: TextField(
          controller: controller,
          maxLines: maxLines,
          decoration: InputDecoration(labelText: label),
          autofocus: true,
        ),
        actions: [
          TextButton(onPressed: () => Navigator.pop(context), child: const Text('Cancel')),
          FilledButton(
            onPressed: () => Navigator.pop(context, controller.text.trim()),
            child: const Text('Send'),
          ),
        ],
      ),
    );
    controller.dispose();
    return result;
  }

  @override
  Widget build(BuildContext context) {
    return SignalBuilder(
      builder: (context) {
        final summary = _store.summary.value.dataOrNull;
        final reviews = _store.items.value.dataOrNull ?? const [];
        final eligible = _store.eligibility.value?.eligible == true;
        final canWrite = widget.listingId > 0 && eligible && !widget.isOwner;
        return Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            const SizedBox(height: 20),
            Row(
              children: [
                Text('Reviews', style: Theme.of(context).textTheme.titleMedium),
                const Spacer(),
                if (summary != null && summary.count > 0)
                  Text('${summary.average.toStringAsFixed(1)}★ · ${summary.count}'),
              ],
            ),
            if (summary != null && summary.verifiedCount > 0)
              Padding(
                padding: const EdgeInsets.only(top: 4),
                child: Text(
                  '${summary.verifiedCount} verified',
                  style: Theme.of(context).textTheme.bodySmall?.copyWith(color: AppColors.goldMuted),
                ),
              ),
            if (canWrite)
              Padding(
                padding: const EdgeInsets.only(top: 8),
                child: OutlinedButton.icon(
                  onPressed: () => context.push('/listing/${widget.listingId}/review'),
                  icon: const Icon(Icons.rate_review_outlined),
                  label: const Text('Write a review'),
                ),
              ),
            if (_store.eligibility.value != null &&
                !eligible &&
                !widget.isOwner &&
                widget.listingId > 0 &&
                _store.eligibility.value!.reason.isNotEmpty)
              Padding(
                padding: const EdgeInsets.only(top: 8),
                child: Text(
                  _store.eligibility.value!.reason,
                  style: Theme.of(context).textTheme.bodySmall,
                ),
              ),
            const SizedBox(height: 8),
            if (reviews.isEmpty)
              Text('No reviews yet', style: Theme.of(context).textTheme.bodySmall)
            else
              for (final review in reviews.take(6))
                _ReviewTile(
                  review: review,
                  isOwner: widget.isOwner,
                  onHelpful: () => _helpful(review),
                  onReport: () => _report(review),
                  onReply: () => _reply(review),
                ),
          ],
        );
      },
    );
  }
}

class _ReviewTile extends StatelessWidget {
  const _ReviewTile({
    required this.review,
    required this.isOwner,
    required this.onHelpful,
    required this.onReport,
    required this.onReply,
  });

  final ReviewItem review;
  final bool isOwner;
  final VoidCallback onHelpful;
  final VoidCallback onReport;
  final VoidCallback onReply;

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.only(bottom: 8),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          ListTile(
            contentPadding: EdgeInsets.zero,
            title: Text(
              '${review.rating.toStringAsFixed(1)}★ ${review.title ?? review.reviewerName ?? 'Review'}',
            ),
            subtitle: Text(
              [
                if (review.verificationLabel != null) review.verificationLabel!,
                if (review.body != null) review.body!,
              ].join(' · '),
              maxLines: 3,
              overflow: TextOverflow.ellipsis,
            ),
          ),
          if (review.criteria.isNotEmpty)
            Wrap(
              spacing: 6,
              children: [
                for (final criterion in review.criteria.take(6))
                  Chip(
                    visualDensity: VisualDensity.compact,
                    label: Text(
                      '${criterion.label} ${criterion.rating?.toStringAsFixed(0) ?? ''}',
                      style: const TextStyle(fontSize: 11),
                    ),
                  ),
              ],
            ),
          Row(
            children: [
              TextButton.icon(
                onPressed: onHelpful,
                icon: const Icon(Icons.thumb_up_outlined, size: 16),
                label: Text(review.helpfulCount > 0 ? '${review.helpfulCount}' : 'Helpful'),
              ),
              TextButton(onPressed: onReport, child: const Text('Report')),
              if (isOwner) TextButton(onPressed: onReply, child: const Text('Reply')),
            ],
          ),
        ],
      ),
    );
  }
}
