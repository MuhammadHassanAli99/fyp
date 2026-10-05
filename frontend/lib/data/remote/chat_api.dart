import '../../core/network/api_client.dart';
import '../models/chat_models.dart';

class ChatApi {
  ChatApi(this._client);
  final ApiClient _client;

  Future<List<ConversationModel>> listConversations({int limit = 30}) =>
      _client.get(
        '/chat/conversations',
        queryParameters: {'limit': limit},
        parser: (data) => (data as List)
            .map((e) => ConversationModel.fromJson(e as Map<String, dynamic>))
            .toList(),
      );

  Future<ConversationModel> openForListing(String listingId) => _client.post(
        '/chat/conversations',
        data: {'listingId': listingId},
        parser: (data) =>
            ConversationModel.fromJson(data as Map<String, dynamic>),
      );

  Future<ConversationModel> getConversation(String uuid) => _client.get(
        '/chat/conversations/$uuid',
        parser: (data) =>
            ConversationModel.fromJson(data as Map<String, dynamic>),
      );

  Future<ConversationModel> patchConversation(
    String uuid, {
    bool? muted,
    bool? archived,
    bool? pinned,
  }) =>
      _client.patch(
        '/chat/conversations/$uuid',
        data: {
          'muted': ?muted,
          'archived': ?archived,
          'pinned': ?pinned,
        },
        parser: (data) =>
            ConversationModel.fromJson(data as Map<String, dynamic>),
      );

  Future<List<ChatMessage>> getMessages(
    String uuid, {
    int limit = 50,
    int? beforeId,
  }) =>
      _client.get(
        '/chat/conversations/$uuid/messages',
        queryParameters: {
          'limit': limit,
          'beforeId': ?beforeId,
        },
        parser: (data) => (data as List)
            .map((e) => ChatMessage.fromJson(e as Map<String, dynamic>))
            .toList(),
      );

  Future<List<ChatMessage>> sync({required DateTime after}) => _client.get(
        '/chat/sync',
        queryParameters: {'after': after.toUtc().toIso8601String()},
        parser: (data) => (data as List)
            .map((e) => ChatMessage.fromJson(e as Map<String, dynamic>))
            .toList(),
      );

  Future<ChatMessage> sendMessage(
    String uuid, {
    required String kind,
    String? body,
    String? clientMessageId,
    int? replyToId,
    List<Map<String, dynamic>>? attachments,
    int? durationMs,
    Map<String, dynamic>? location,
  }) =>
      _client.post(
        '/chat/conversations/$uuid/messages',
        data: {
          'kind': kind,
          'body': ?body,
          'clientMessageId': ?clientMessageId,
          'replyToId': ?replyToId,
          'attachments': ?attachments,
          'durationMs': ?durationMs,
          'location': ?location,
        },
        parser: (data) => ChatMessage.fromJson(data as Map<String, dynamic>),
      );

  Future<ChatMessage> editMessage(String uuid, int messageId, String body) =>
      _client.patch(
        '/chat/conversations/$uuid/messages/$messageId',
        data: {'body': body},
        parser: (data) => ChatMessage.fromJson(data as Map<String, dynamic>),
      );

  Future<void> deleteMessage(
    String uuid,
    int messageId, {
    String type = 'for_me',
  }) async {
    await _client.delete(
      '/chat/conversations/$uuid/messages/$messageId?type=$type',
      parser: (_) => true,
    );
  }

  Future<TranslationResult> translate(
    String uuid,
    int messageId,
    String targetLanguage,
  ) =>
      _client.post(
        '/chat/conversations/$uuid/messages/$messageId/translate',
        data: {'targetLanguage': targetLanguage},
        parser: (data) =>
            TranslationResult.fromJson(data as Map<String, dynamic>),
      );

  Future<void> markRead(String uuid, {int? lastReadMessageId}) async {
    await _client.post(
      '/chat/conversations/$uuid/read',
      data: {
        'lastReadMessageId': ?lastReadMessageId,
      },
      parser: (_) => true,
    );
  }

  Future<void> blockUser(int userId, {String? reason}) async {
    await _client.post(
      '/chat/blocks',
      data: {'userId': userId, 'reason': ?reason},
      parser: (_) => true,
    );
  }

  Future<void> unblockUser(int userId) async {
    await _client.delete('/chat/blocks/$userId', parser: (_) => true);
  }

  Future<void> report({
    required String entityType,
    required int entityId,
    required String reasonCode,
    String? description,
    String? conversationUuid,
  }) async {
    await _client.post(
      '/chat/reports',
      data: {
        'entityType': entityType,
        'entityId': entityId,
        'reasonCode': reasonCode,
        'description': ?description,
        'conversationUuid': ?conversationUuid,
      },
      parser: (_) => true,
    );
  }
}

class CallsApi {
  CallsApi(this._client);
  final ApiClient _client;

  Future<List<CallSession>> history({int limit = 30}) => _client.get(
        '/calls',
        queryParameters: {'limit': limit},
        parser: (data) => (data as List)
            .map((e) => CallSession.fromJson(e as Map<String, dynamic>))
            .toList(),
      );

  Future<CallSession> initiate({
    int? calleeId,
    int? conversationId,
    String? conversationUuid,
    String? listingId,
    String kind = 'voice',
  }) =>
      _client.post(
        '/calls',
        data: {
          'calleeId': ?calleeId,
          'conversationId': ?conversationId,
          'conversationUuid': ?conversationUuid,
          'listingId': ?listingId,
          'kind': kind,
        },
        parser: (data) => CallSession.fromJson(data as Map<String, dynamic>),
      );

  Future<CallSession> getCall(String uuid) => _client.get(
        '/calls/$uuid',
        parser: (data) => CallSession.fromJson(data as Map<String, dynamic>),
      );

  Future<void> updateStatus(String uuid, String status) async {
    await _client.patch(
      '/calls/$uuid/status',
      data: {'status': status},
      parser: (_) => true,
    );
  }

  Future<void> signal(
    String uuid, {
    required String type,
    Object? payload,
  }) async {
    await _client.post(
      '/calls/$uuid/signal',
      data: {'type': type, 'payload': ?payload},
      parser: (_) => true,
    );
  }

  Future<MaskedCallSession> masked({required String listingId}) => _client.post(
        '/calls/masked',
        data: {'listingId': listingId},
        parser: (data) =>
            MaskedCallSession.fromJson(data as Map<String, dynamic>),
      );
}

class UploadsApi {
  UploadsApi(this._client);
  final ApiClient _client;

  Future<SignedUpload> sign({
    required String purpose,
    required String mimeType,
    required int sizeBytes,
    String? filename,
  }) =>
      _client.post(
        '/uploads/sign',
        data: {
          'purpose': purpose,
          'mimeType': mimeType,
          'sizeBytes': sizeBytes,
          'filename': ?filename,
        },
        parser: (data) => SignedUpload.fromJson(data as Map<String, dynamic>),
      );

  Future<void> putBytes({
    required String uploadUrl,
    required List<int> bytes,
    required String mimeType,
  }) =>
      _client.putBytes(uploadUrl, bytes: bytes, contentType: mimeType);
}
