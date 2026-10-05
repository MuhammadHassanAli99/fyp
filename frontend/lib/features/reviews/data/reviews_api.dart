import '../../../core/network/api_client.dart';
import 'review_models.dart';

class ReviewsApi {
  ReviewsApi(this._client);
  final ApiClient _client;

  Future<ReviewEligibility> eligibility({required int listingId}) => _client.get(
        '/reviews/eligibility',
        queryParameters: {'listingId': listingId},
        parser: (data) => ReviewEligibility.fromJson(Map<String, dynamic>.from(data as Map)),
      );

  Future<ReviewSummary> summary({
    required String subjectKind,
    required int subjectId,
  }) =>
      _client.get(
        '/reviews/summary',
        queryParameters: {'subjectKind': subjectKind, 'subjectId': subjectId},
        parser: (data) => ReviewSummary.fromJson(Map<String, dynamic>.from(data as Map)),
      );

  Future<List<ReviewItem>> list({
    required String subjectKind,
    required int subjectId,
  }) =>
      _client.get(
        '/reviews',
        queryParameters: {'subjectKind': subjectKind, 'subjectId': subjectId, 'limit': 20},
        parser: (data) {
          if (data is! List) return const <ReviewItem>[];
          return [
            for (final row in data)
              if (row is Map) ReviewItem.fromJson(Map<String, dynamic>.from(row)),
          ];
        },
      );

  Future<List<ReviewCriterion>> criteria({String? appliesTo, int? marketplaceId}) => _client.get(
        '/reviews/criteria',
        queryParameters: {
          'appliesTo': ?appliesTo,
          'marketplaceId': ?marketplaceId,
        },
        parser: (data) {
          if (data is! List) return const <ReviewCriterion>[];
          return [
            for (final row in data)
              if (row is Map) ReviewCriterion.fromJson(Map<String, dynamic>.from(row)),
          ];
        },
      );

  Future<ReviewItem> create({
    required int listingId,
    required double rating,
    String? title,
    String? body,
    List<Map<String, dynamic>> criteria = const [],
    List<Map<String, dynamic>> media = const [],
  }) =>
      _client.post(
        '/reviews',
        data: {
          'listingId': listingId,
          'rating': rating,
          'title': ?title,
          'body': ?body,
          if (criteria.isNotEmpty) 'criteria': criteria,
          if (media.isNotEmpty) 'media': media,
        },
        parser: (data) => ReviewItem.fromJson(Map<String, dynamic>.from(data as Map)),
      );

  Future<void> helpful(String uuid, {required bool helpful}) => _client.post(
        '/reviews/$uuid/helpful',
        data: {'helpful': helpful},
        parser: (_) {},
      );

  Future<void> report(String uuid, {required String reason}) => _client.post(
        '/reviews/$uuid/report',
        data: {'reason': reason},
        parser: (_) {},
      );

  Future<void> reply(String uuid, String body) => _client.post(
        '/reviews/$uuid/respond',
        data: {'body': body},
        parser: (_) {},
      );
}
