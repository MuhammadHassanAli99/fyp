import 'dart:async';

import 'package:signals/signals.dart' hide AsyncState, AsyncLoading, AsyncData, AsyncError;
import 'package:uuid/uuid.dart';

import '../../core/result/async_state.dart';
import '../../data/models/chat_models.dart';
import '../../data/repositories/chat_repository.dart';
import '../../data/services/realtime_client.dart';

class ChatInboxStore {
  ChatInboxStore(this._repo, [this._realtime]);

  final ChatRepository _repo;
  final RealtimeClient? _realtime;
  final conversations =
      signal<AsyncState<List<ConversationModel>>>(const AsyncIdle());
  StreamSubscription<RealtimeEvent>? _sub;

  void listen() {
    _sub?.cancel();
    _sub = _realtime?.events.listen((event) {
      if (event.name == 'chat:inbox' ||
          event.name == 'message:new' ||
          event.name == 'connected') {
        load();
      }
    });
  }

  Future<void> load() async {
    conversations.value = AsyncLoading(previous: conversations.value.dataOrNull);
    final result = await _repo.listConversations();
    result.when(
      success: (items) => conversations.value = AsyncData(items),
      failure: (m, code) => conversations.value = AsyncError(m, code: code),
    );
  }

  void dispose() {
    _sub?.cancel();
  }
}

class ConversationStore {
  ConversationStore(this._repo, this.conversationUuid, [this._realtime]);

  final ChatRepository _repo;
  final String conversationUuid;
  final RealtimeClient? _realtime;

  final conversation = signal<AsyncState<ConversationModel>>(const AsyncIdle());
  final messages = signal<AsyncState<List<ChatMessage>>>(const AsyncIdle());
  final sending = signal(false);
  final error = signal<String?>(null);
  final typingPeer = signal(false);
  final replyTo = signal<ChatMessage?>(null);
  final editing = signal<ChatMessage?>(null);
  final uploadProgress = signal<double?>(null);
  final offline = signal(false);

  StreamSubscription<RealtimeEvent>? _sub;
  Timer? _typingStop;
  DateTime? _lastTypingSent;

  void attachRealtime() {
    _realtime?.joinConversation(conversationUuid);
    _sub?.cancel();
    _sub = _realtime?.events.listen(_onEvent);
  }

  void _onEvent(RealtimeEvent event) {
    switch (event.name) {
      case 'disconnected':
        offline.value = true;
      case 'connected':
        offline.value = false;
        unawaited(_reconcile());
      case 'typing:start':
        if (event.map?['conversationUuid'] == conversationUuid) {
          typingPeer.value = true;
        }
      case 'typing:stop':
        if (event.map?['conversationUuid'] == conversationUuid) {
          typingPeer.value = false;
        }
      case 'message:new':
        final msg = messageFromEvent(event.data);
        if (msg == null) return;
        _upsert(msg);
      case 'message:edited':
        final msg = messageFromEvent(event.data);
        if (msg != null) _upsert(msg);
      case 'message:deleted':
        final id = (event.map?['messageId'] as num?)?.toInt();
        if (id == null) return;
        final current = List<ChatMessage>.from(messages.value.dataOrNull ?? []);
        final idx = current.indexWhere((m) => m.id == id);
        if (idx >= 0) {
          current[idx] = current[idx].copyWith(deleted: true, body: null);
          messages.value = AsyncData(current);
        }
      case 'message:read':
        // Peer read cursor — ticks are rendered from message.status.
        break;
    }
  }

  void _upsert(ChatMessage msg) {
    final current = List<ChatMessage>.from(messages.value.dataOrNull ?? []);
    final idx = current.indexWhere(
      (m) => m.uuid == msg.uuid || (msg.id != 0 && m.id == msg.id),
    );
    if (idx >= 0) {
      current[idx] = msg;
    } else {
      current.add(msg);
    }
    messages.value = AsyncData(current);
  }

  Future<void> _reconcile() async {
    final after = _realtime?.lastSyncAt;
    if (after == null || after.millisecondsSinceEpoch <= 0) {
      await load();
      return;
    }
    final result = await _repo.sync(after: after);
    result.when(
      success: (list) {
        final mine = conversation.value.dataOrNull?.id;
        for (final msg in list) {
          if (mine == null || msg.conversationId == mine) _upsert(msg);
        }
      },
      failure: (_, _) {
        load();
      },
    );
  }

  Future<void> load() async {
    conversation.value = const AsyncLoading();
    messages.value = const AsyncLoading();

    final conv = await _repo.getConversation(conversationUuid);
    conv.when(
      success: (c) => conversation.value = AsyncData(c),
      failure: (m, code) => conversation.value = AsyncError(m, code: code),
    );

    final msgs = await _repo.getMessages(conversationUuid);
    msgs.when(
      success: (list) {
        messages.value = AsyncData(list);
        _repo.markRead(conversationUuid);
      },
      failure: (m, code) => messages.value = AsyncError(m, code: code),
    );
    attachRealtime();
  }

  void onComposerChanged() {
    final now = DateTime.now();
    if (_lastTypingSent != null &&
        now.difference(_lastTypingSent!) < const Duration(seconds: 2)) {
      return;
    }
    _lastTypingSent = now;
    _realtime?.typingStart(conversationUuid);
    _typingStop?.cancel();
    _typingStop = Timer(const Duration(seconds: 3), () {
      _realtime?.typingStop(conversationUuid);
    });
  }

  Future<bool> sendText(String text) async {
    final body = text.trim();
    if (body.isEmpty) return false;
    sending.value = true;
    error.value = null;
    final editingMsg = editing.value;
    if (editingMsg != null) {
      final result = await _repo.editMessage(conversationUuid, editingMsg.id, body);
      sending.value = false;
      return result.when(
        success: (msg) {
          editing.value = null;
          _upsert(msg);
          return true;
        },
        failure: (m, _) {
          error.value = m;
          return false;
        },
      );
    }
    final result = await _repo.sendText(
      conversationUuid,
      body,
      clientMessageId: const Uuid().v4(),
      replyToId: replyTo.value?.id,
    );
    sending.value = false;
    return result.when(
      success: (msg) {
        replyTo.value = null;
        _upsert(msg);
        return true;
      },
      failure: (m, _) {
        error.value = m;
        return false;
      },
    );
  }

  Future<bool> sendMedia({
    required String kind,
    required List<Map<String, dynamic>> attachments,
    String? caption,
    int? durationMs,
  }) async {
    sending.value = true;
    error.value = null;
    final result = await _repo.sendMedia(
      conversationUuid,
      kind: kind,
      attachments: attachments,
      body: caption,
      clientMessageId: const Uuid().v4(),
      durationMs: durationMs,
      replyToId: replyTo.value?.id,
    );
    sending.value = false;
    uploadProgress.value = null;
    return result.when(
      success: (msg) {
        replyTo.value = null;
        _upsert(msg);
        return true;
      },
      failure: (m, _) {
        error.value = m;
        return false;
      },
    );
  }

  Future<bool> sendLocation(ChatLocation location) async {
    final result = await _repo.sendLocation(
      conversationUuid,
      location,
      clientMessageId: const Uuid().v4(),
    );
    return result.when(
      success: (msg) {
        _upsert(msg);
        return true;
      },
      failure: (m, _) {
        error.value = m;
        return false;
      },
    );
  }

  Future<void> deleteMessage(ChatMessage message, {required bool forEveryone}) async {
    final result = await _repo.deleteMessage(
      conversationUuid,
      message.id,
      type: forEveryone ? 'for_everyone' : 'for_me',
    );
    result.when(
      success: (_) {
        final current = List<ChatMessage>.from(messages.value.dataOrNull ?? []);
        if (forEveryone) {
          final idx = current.indexWhere((m) => m.id == message.id);
          if (idx >= 0) {
            current[idx] = current[idx].copyWith(deleted: true, body: null);
          }
        } else {
          current.removeWhere((m) => m.id == message.id);
        }
        messages.value = AsyncData(current);
      },
      failure: (m, _) => error.value = m,
    );
  }

  Future<void> translate(ChatMessage message, String language) async {
    final result = await _repo.translate(conversationUuid, message.id, language);
    result.when(
      success: (tr) {
        final current = List<ChatMessage>.from(messages.value.dataOrNull ?? []);
        final idx = current.indexWhere((m) => m.id == message.id);
        if (idx >= 0) {
          current[idx] = current[idx].copyWith(
            translatedBody: tr.unavailable ? tr.original : tr.translated,
            showTranslation: !tr.unavailable,
          );
          messages.value = AsyncData(current);
        }
        if (tr.unavailable) {
          error.value = 'Translation is unavailable right now';
        }
      },
      failure: (m, _) => error.value = m,
    );
  }

  Future<CallSession?> startCall({String kind = 'voice'}) async {
    final conv = conversation.value.dataOrNull;
    final peerId = conv?.peerId;
    if (peerId == null) {
      error.value = 'Cannot call — peer unknown';
      return null;
    }
    final result = await _repo.startCall(
      calleeId: peerId,
      conversationId: conv?.id,
      conversationUuid: conversationUuid,
      kind: kind,
    );
    return result.when(
      success: (call) => call,
      failure: (m, _) {
        error.value = m;
        return null;
      },
    );
  }

  Future<void> blockPeer() async {
    final peerId = conversation.value.dataOrNull?.peerId;
    if (peerId == null) return;
    final result = await _repo.blockUser(peerId);
    result.when(
      success: (_) {},
      failure: (m, _) => error.value = m,
    );
  }

  Future<void> report({required String entityType, required int entityId, required String reason}) async {
    final result = await _repo.report(
      entityType: entityType,
      entityId: entityId,
      reasonCode: reason,
      conversationUuid: conversationUuid,
    );
    result.when(success: (_) {}, failure: (m, _) => error.value = m);
  }

  void dispose() {
    _sub?.cancel();
    _typingStop?.cancel();
    _realtime?.leaveConversation(conversationUuid);
  }
}
