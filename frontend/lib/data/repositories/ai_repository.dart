import '../../core/network/api_exception.dart';
import '../../core/result/result.dart';
import '../models/ai_models.dart';
import '../remote/ai_api.dart';

class AiRepository {
  AiRepository(this._api);
  final AiApi _api;

  Future<Result<AiDescription>> generateDescription({
    required String categoryName,
    required String title,
    double? price,
    String? city,
    Map<String, dynamic> attributes = const {},
    Map<String, dynamic> details = const {},
    int? listingId,
  }) =>
      _wrap(
        () => _api.generateDescription(
          categoryName: categoryName,
          title: title,
          price: price,
          city: city,
          attributes: attributes,
          details: details,
          listingId: listingId,
        ),
      );

  Future<Result<AiQueuedJob>> enhanceImage(int mediaId) =>
      _wrap(() => _api.enhanceImage(mediaId));

  Future<Result<AiJob>> job(String uuid) => _wrap(() => _api.job(uuid));

  Future<Result<void>> acceptContent({
    required String entityType,
    required int entityId,
    required String kind,
    String? editedContent,
  }) =>
      _wrap(
        () => _api.acceptContent(
          entityType: entityType,
          entityId: entityId,
          kind: kind,
          editedContent: editedContent,
        ),
      );

  Future<Result<void>> feedback({
    String? jobUuid,
    required String feedback,
    String? comment,
  }) =>
      _wrap(() => _api.feedback(jobUuid: jobUuid, feedback: feedback, comment: comment));

  Future<Result<AiRecommendations>> recommendations({int? marketplaceId}) =>
      _wrap(() => _api.recommendations(marketplaceId: marketplaceId));

  Future<Result<AiSupportTurn>> support({
    required String message,
    String? sessionUuid,
    bool confirmTool = false,
  }) =>
      _wrap(
        () => _api.support(
          message: message,
          sessionUuid: sessionUuid,
          confirmTool: confirmTool,
        ),
      );

  Future<Result<T>> _wrap<T>(Future<T> Function() run) async {
    try {
      return Success(await run());
    } on ApiException catch (e) {
      return Failure(e.message, code: e.code);
    } catch (e) {
      return Failure(e.toString());
    }
  }
}
