import '../../core/network/api_client.dart';
import '../models/ai_models.dart';

class AiApi {
  AiApi(this._client);
  final ApiClient _client;

  Future<AiDescription> generateDescription({
    required String categoryName,
    required String title,
    double? price,
    String? city,
    Map<String, dynamic> attributes = const {},
    Map<String, dynamic> details = const {},
    int? listingId,
  }) =>
      _client.post(
        '/ai/description',
        data: {
          'categoryName': categoryName,
          'title': title,
          'price': ?price,
          'city': ?city,
          'attributes': attributes,
          'details': details,
          'listingId': ?listingId,
        },
        parser: (data) => AiDescription.fromJson(Map<String, dynamic>.from(data as Map)),
      );

  Future<AiQueuedJob> enhanceImage(int mediaId) => _client.post(
        '/ai/enhance',
        data: {'mediaId': mediaId},
        parser: (data) => AiQueuedJob.fromJson(Map<String, dynamic>.from(data as Map)),
      );

  Future<AiJob> job(String uuid) => _client.get(
        '/ai/jobs/$uuid',
        parser: (data) => AiJob.fromJson(Map<String, dynamic>.from(data as Map)),
      );

  Future<void> acceptContent({
    required String entityType,
    required int entityId,
    required String kind,
    String? editedContent,
  }) =>
      _client.post(
        '/ai/content/accept',
        data: {
          'entityType': entityType,
          'entityId': entityId,
          'kind': kind,
          'editedContent': ?editedContent,
        },
        parser: (_) {},
      );

  Future<void> feedback({
    String? jobUuid,
    required String feedback,
    String? comment,
  }) =>
      _client.post(
        '/ai/feedback',
        data: {
          'jobUuid': ?jobUuid,
          'feedback': feedback,
          'comment': ?comment,
        },
        parser: (_) {},
      );

  Future<AiRecommendations> recommendations({int? marketplaceId}) => _client.get(
        '/ai/recommendations',
        queryParameters: {
          'marketplaceId': ?marketplaceId,
        },
        parser: (data) => AiRecommendations.fromJson(Map<String, dynamic>.from(data as Map)),
      );

  Future<AiSupportTurn> support({
    required String message,
    String? sessionUuid,
    bool confirmTool = false,
  }) =>
      _client.post(
        '/ai/support',
        data: {
          'message': message,
          'sessionUuid': ?sessionUuid,
          if (confirmTool) 'confirmTool': true,
        },
        parser: (data) => AiSupportTurn.fromJson(Map<String, dynamic>.from(data as Map)),
      );
}
