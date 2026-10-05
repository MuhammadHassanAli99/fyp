import '../../core/network/api_exception.dart';
import '../../core/result/result.dart';
import '../models/chat_models.dart';
import '../remote/chat_api.dart';

class ChatRepository {
  ChatRepository(this._chat, this._calls);

  final ChatApi _chat;
  final CallsApi _calls;

  Future<Result<List<ConversationModel>>> listConversations() async {
    try {
      return Success(await _chat.listConversations());
    } on ApiException catch (e) {
      return Failure(e.message, code: e.code);
    } catch (e) {
      return Failure(e.toString());
    }
  }

  Future<Result<ConversationModel>> openForListing(String listingId) async {
    try {
      return Success(await _chat.openForListing(listingId));
    } on ApiException catch (e) {
      return Failure(e.message, code: e.code);
    } catch (e) {
      return Failure(e.toString());
    }
  }

  Future<Result<ConversationModel>> getConversation(String uuid) async {
    try {
      return Success(await _chat.getConversation(uuid));
    } on ApiException catch (e) {
      return Failure(e.message, code: e.code);
    } catch (e) {
      return Failure(e.toString());
    }
  }

  Future<Result<List<ChatMessage>>> getMessages(
    String uuid, {
    int? beforeId,
  }) async {
    try {
      return Success(await _chat.getMessages(uuid, beforeId: beforeId));
    } on ApiException catch (e) {
      return Failure(e.message, code: e.code);
    } catch (e) {
      return Failure(e.toString());
    }
  }

  Future<Result<List<ChatMessage>>> sync({required DateTime after}) async {
    try {
      return Success(await _chat.sync(after: after));
    } on ApiException catch (e) {
      return Failure(e.message, code: e.code);
    } catch (e) {
      return Failure(e.toString());
    }
  }

  Future<Result<ChatMessage>> sendText(
    String uuid,
    String body, {
    String? clientMessageId,
    int? replyToId,
  }) async {
    try {
      return Success(
        await _chat.sendMessage(
          uuid,
          kind: 'text',
          body: body,
          clientMessageId: clientMessageId,
          replyToId: replyToId,
        ),
      );
    } on ApiException catch (e) {
      return Failure(e.message, code: e.code);
    } catch (e) {
      return Failure(e.toString());
    }
  }

  Future<Result<ChatMessage>> sendMedia(
    String uuid, {
    required String kind,
    required List<Map<String, dynamic>> attachments,
    String? body,
    String? clientMessageId,
    int? durationMs,
    int? replyToId,
  }) async {
    try {
      return Success(
        await _chat.sendMessage(
          uuid,
          kind: kind,
          body: body,
          clientMessageId: clientMessageId,
          attachments: attachments,
          durationMs: durationMs,
          replyToId: replyToId,
        ),
      );
    } on ApiException catch (e) {
      return Failure(e.message, code: e.code);
    } catch (e) {
      return Failure(e.toString());
    }
  }

  Future<Result<ChatMessage>> sendLocation(
    String uuid,
    ChatLocation location, {
    String? clientMessageId,
  }) async {
    try {
      return Success(
        await _chat.sendMessage(
          uuid,
          kind: 'location',
          clientMessageId: clientMessageId,
          location: location.toJson(),
        ),
      );
    } on ApiException catch (e) {
      return Failure(e.message, code: e.code);
    } catch (e) {
      return Failure(e.toString());
    }
  }

  Future<Result<ChatMessage>> editMessage(
    String uuid,
    int messageId,
    String body,
  ) async {
    try {
      return Success(await _chat.editMessage(uuid, messageId, body));
    } on ApiException catch (e) {
      return Failure(e.message, code: e.code);
    } catch (e) {
      return Failure(e.toString());
    }
  }

  Future<Result<bool>> deleteMessage(
    String uuid,
    int messageId, {
    required String type,
  }) async {
    try {
      await _chat.deleteMessage(uuid, messageId, type: type);
      return const Success(true);
    } on ApiException catch (e) {
      return Failure(e.message, code: e.code);
    } catch (e) {
      return Failure(e.toString());
    }
  }

  Future<Result<TranslationResult>> translate(
    String uuid,
    int messageId,
    String language,
  ) async {
    try {
      return Success(await _chat.translate(uuid, messageId, language));
    } on ApiException catch (e) {
      return Failure(e.message, code: e.code);
    } catch (e) {
      return Failure(e.toString());
    }
  }

  Future<Result<bool>> markRead(String uuid, {int? lastReadMessageId}) async {
    try {
      await _chat.markRead(uuid, lastReadMessageId: lastReadMessageId);
      return const Success(true);
    } on ApiException catch (e) {
      return Failure(e.message, code: e.code);
    } catch (e) {
      return Failure(e.toString());
    }
  }

  Future<Result<ConversationModel>> mute(String uuid, bool muted) async {
    try {
      return Success(await _chat.patchConversation(uuid, muted: muted));
    } on ApiException catch (e) {
      return Failure(e.message, code: e.code);
    } catch (e) {
      return Failure(e.toString());
    }
  }

  Future<Result<bool>> blockUser(int userId) async {
    try {
      await _chat.blockUser(userId);
      return const Success(true);
    } on ApiException catch (e) {
      return Failure(e.message, code: e.code);
    } catch (e) {
      return Failure(e.toString());
    }
  }

  Future<Result<bool>> report({
    required String entityType,
    required int entityId,
    required String reasonCode,
    String? conversationUuid,
  }) async {
    try {
      await _chat.report(
        entityType: entityType,
        entityId: entityId,
        reasonCode: reasonCode,
        conversationUuid: conversationUuid,
      );
      return const Success(true);
    } on ApiException catch (e) {
      return Failure(e.message, code: e.code);
    } catch (e) {
      return Failure(e.toString());
    }
  }

  Future<Result<CallSession>> startCall({
    int? calleeId,
    int? conversationId,
    String? conversationUuid,
    String? listingId,
    String kind = 'voice',
  }) async {
    try {
      return Success(
        await _calls.initiate(
          calleeId: calleeId,
          conversationId: conversationId,
          conversationUuid: conversationUuid,
          listingId: listingId,
          kind: kind,
        ),
      );
    } on ApiException catch (e) {
      return Failure(e.message, code: e.code);
    } catch (e) {
      return Failure(e.toString());
    }
  }

  Future<Result<List<CallSession>>> callHistory() async {
    try {
      return Success(await _calls.history());
    } on ApiException catch (e) {
      return Failure(e.message, code: e.code);
    } catch (e) {
      return Failure(e.toString());
    }
  }

  Future<Result<bool>> updateCallStatus(String uuid, String status) async {
    try {
      await _calls.updateStatus(uuid, status);
      return const Success(true);
    } on ApiException catch (e) {
      return Failure(e.message, code: e.code);
    } catch (e) {
      return Failure(e.toString());
    }
  }

  Future<Result<bool>> signalCall(
    String uuid, {
    required String type,
    Object? payload,
  }) async {
    try {
      await _calls.signal(uuid, type: type, payload: payload);
      return const Success(true);
    } on ApiException catch (e) {
      return Failure(e.message, code: e.code);
    } catch (e) {
      return Failure(e.toString());
    }
  }

  Future<Result<MaskedCallSession>> startMaskedCall(String listingId) async {
    try {
      return Success(await _calls.masked(listingId: listingId));
    } on ApiException catch (e) {
      return Failure(e.message, code: e.code);
    } catch (e) {
      return Failure(e.toString());
    }
  }
}
