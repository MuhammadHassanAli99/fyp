import '../../../core/network/api_client.dart';
import '../../../core/network/api_exception.dart';
import '../../../core/result/result.dart';
import 'support_models.dart';

class SupportApi {
  SupportApi(this._client);
  final ApiClient _client;

  Future<Result<Map<String, dynamic>>> catalog() => _mapGet('/support/catalog');

  Future<Result<List<KbArticleSummary>>> searchKb({String? q, String? marketplace}) async {
    try {
      final data = await _client.get(
        '/support/kb',
        queryParameters: {
          if (q != null && q.isNotEmpty) 'q': q,
          'marketplaceCode': ?marketplace,
          'perPage': 20,
        },
        parser: (d) {
          final items = d is Map ? d['items'] : d;
          return ((items as List?) ?? const [])
              .whereType<Map>()
              .map((row) => KbArticleSummary.fromJson(Map<String, dynamic>.from(row)))
              .toList();
        },
      );
      return Success(data);
    } on ApiException catch (e) {
      return Failure(e.message, code: e.code);
    } catch (e) {
      return Failure(e.toString());
    }
  }

  Future<Result<Map<String, dynamic>>> article(String slug) => _mapGet('/support/kb/$slug');

  Future<Result<List<Map<String, dynamic>>>> faqs({String? marketplace}) async {
    try {
      final data = await _client.get(
        '/support/faqs',
        queryParameters: {'marketplaceCode': ?marketplace},
        parser: (d) => ((d as List?) ?? const []).whereType<Map>().map((e) => Map<String, dynamic>.from(e)).toList(),
      );
      return Success(data);
    } on ApiException catch (e) {
      return Failure(e.message, code: e.code);
    } catch (e) {
      return Failure(e.toString());
    }
  }

  Future<Result<List<SupportTicketSummary>>> tickets() async {
    try {
      final data = await _client.get(
        '/support/tickets',
        parser: (d) {
          final items = d is Map ? d['items'] : d;
          return ((items as List?) ?? const [])
              .whereType<Map>()
              .map((row) => SupportTicketSummary.fromJson(Map<String, dynamic>.from(row)))
              .toList();
        },
      );
      return Success(data);
    } on ApiException catch (e) {
      return Failure(e.message, code: e.code);
    } catch (e) {
      return Failure(e.toString());
    }
  }

  Future<Result<Map<String, dynamic>>> ticket(String uuid) => _mapGet('/support/tickets/$uuid');

  Future<Result<Map<String, dynamic>>> createTicket(Map<String, dynamic> body) => _mapPost('/support/tickets', body);

  Future<Result<Map<String, dynamic>>> reply(String uuid, String text) =>
      _mapPost('/support/tickets/$uuid/reply', {'body': text});

  Future<Result<Map<String, dynamic>>> feedback(String uuid, {required int rating, String? comment}) =>
      _mapPost('/support/tickets/$uuid/feedback', {'rating': rating, 'comment': ?comment});

  Future<Result<Map<String, dynamic>>> changeStatus(String uuid, String status) =>
      _mapPost('/support/tickets/$uuid/status', {'status': status});

  Future<Result<Map<String, dynamic>>> openLiveChat(Map<String, dynamic> body) => _mapPost('/support/chat', body);

  Future<Result<List<ForumTopicSummary>>> forumTopics() async {
    try {
      final data = await _client.get(
        '/support/forum/topics',
        parser: (d) {
          final items = d is Map ? d['items'] : d;
          return ((items as List?) ?? const [])
              .whereType<Map>()
              .map((row) => ForumTopicSummary.fromJson(Map<String, dynamic>.from(row)))
              .toList();
        },
      );
      return Success(data);
    } on ApiException catch (e) {
      return Failure(e.message, code: e.code);
    } catch (e) {
      return Failure(e.toString());
    }
  }

  Future<Result<Map<String, dynamic>>> forumTopic(String slug) => _mapGet('/support/forum/topics/$slug');

  Future<Result<Map<String, dynamic>>> createTopic(Map<String, dynamic> body) =>
      _mapPost('/support/forum/topics', body);

  Future<Result<Map<String, dynamic>>> createPost(String slug, String text) =>
      _mapPost('/support/forum/topics/$slug/posts', {'body': text});

  Future<Result<List<SupportTicketSummary>>> agentQueue() async {
    try {
      final data = await _client.get(
        '/support/agent/queue',
        parser: (d) {
          final items = d is Map ? d['items'] : d;
          return ((items as List?) ?? const [])
              .whereType<Map>()
              .map((row) => SupportTicketSummary.fromJson(Map<String, dynamic>.from(row)))
              .toList();
        },
      );
      return Success(data);
    } on ApiException catch (e) {
      return Failure(e.message, code: e.code);
    } catch (e) {
      return Failure(e.toString());
    }
  }

  Future<Result<Map<String, dynamic>>> analytics() => _mapGet('/support/analytics');

  Future<Result<Map<String, dynamic>>> _mapGet(String path, {Map<String, dynamic>? query}) async {
    try {
      final data = await _client.get(
        path,
        queryParameters: query,
        parser: (d) => d is Map ? Map<String, dynamic>.from(d) : <String, dynamic>{'value': d},
      );
      return Success(data);
    } on ApiException catch (e) {
      return Failure(e.message, code: e.code);
    } catch (e) {
      return Failure(e.toString());
    }
  }

  Future<Result<Map<String, dynamic>>> _mapPost(String path, Map<String, dynamic> data) async {
    try {
      final result = await _client.post(
        path,
        data: data,
        parser: (d) => d is Map ? Map<String, dynamic>.from(d) : <String, dynamic>{'value': d},
      );
      return Success(result);
    } on ApiException catch (e) {
      return Failure(e.message, code: e.code);
    } catch (e) {
      return Failure(e.toString());
    }
  }
}
