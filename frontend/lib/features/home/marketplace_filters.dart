import 'package:flutter/material.dart';

import '../../app/theme/app_colors.dart';
import '../../data/models/listing_feed_query.dart';
import '../../data/models/listing_model.dart';
import '../filters/filter_panel.dart';
import '../filters/filter_state.dart';

Future<void> showMarketplaceSortSheet(
  BuildContext context, {
  required String marketplace,
  required String current,
  required ValueChanged<String> onSelected,
}) {
  final options = ListingSorts.forMarketplace(marketplace);
  return showModalBottomSheet<void>(
    context: context,
    builder: (ctx) => SafeArea(
      child: Column(
        mainAxisSize: MainAxisSize.min,
        children: [
          const Padding(
            padding: EdgeInsets.all(16),
            child: Text('Sort by', style: TextStyle(fontSize: 18, fontWeight: FontWeight.w600)),
          ),
          ...options.map(
            (o) => ListTile(
              title: Text(o.label),
              trailing: current == o.apiValue
                  ? const Icon(Icons.check, color: AppColors.gold)
                  : null,
              onTap: () {
                onSelected(o.apiValue);
                Navigator.pop(ctx);
              },
            ),
          ),
          const SizedBox(height: 8),
        ],
      ),
    ),
  );
}

Future<ListingFeedQuery?> showMarketplaceFilterSheet(
  BuildContext context, {
  required ListingFeedQuery query,
}) async {
  final applied = await showFilterPanel(
    context,
    initial: FilterState.fromListingFeedQuery(query),
    marketplace: query.marketplace,
  );
  if (applied == null) return null;
  return applied.toListingFeedQuery(query);
}
