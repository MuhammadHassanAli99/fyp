class ListingCompleteness {
  const ListingCompleteness({
    required this.score,
    required this.missing,
  });

  final int score;
  final List<String> missing;

  bool get readyToSubmit => missing.isEmpty && score >= 50;
}

ListingCompleteness scoreListingDraft({
  required String title,
  required String description,
  required String price,
  required int? categoryId,
  required int mediaCount,
  required bool detailsPresent,
  String? contactPhone,
}) {
  var score = 0;
  final missing = <String>[];

  if (title.trim().length >= 6) {
    score += 15;
  } else {
    missing.add('title');
  }
  if (description.trim().length > 80) score += 20;
  final parsedPrice = double.tryParse(price.trim());
  if (parsedPrice != null && parsedPrice >= 0) {
    score += 15;
  } else {
    missing.add('price');
  }
  if (categoryId != null) {
    score += 10;
  } else {
    missing.add('category');
  }
  if (mediaCount >= 1) score += 10;
  if (mediaCount >= 5) score += 10;
  if (detailsPresent) score += 10;
  if (contactPhone != null && contactPhone.trim().isNotEmpty) {
    score += 10;
  } else {
    missing.add('contact');
  }

  return ListingCompleteness(score: score.clamp(0, 100).toInt(), missing: missing);
}
