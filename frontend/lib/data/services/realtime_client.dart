import 'dart:async';

import 'package:socket_io_client/socket_io_client.dart' as io;

import '../../core/network/api_client.dart';
import '../../core/storage/secure_storage.dart';
import '../models/chat_models.dart';

/// Single Socket.IO client for chat, presence and call signalling.
class RealtimeClient {
  RealtimeClient(this._secureStorage);

  final SecureStorage _secureStorage;
  io.Socket? _socket;
  final _controller = StreamController<RealtimeEvent>.broadcast();
  DateTime _lastSyncAt = DateTime.fromMillisecondsSinceEpoch(0);
  DateTime get lastSyncAt => _lastSyncAt;
  bool _connecting = false;

  Stream<RealtimeEvent> get events => _controller.stream;
  bool get connected => _socket?.connected == true;

  Future<void> connect() async {
    if (_connecting || connected) return;
    final token = await _secureStorage.accessToken;
    if (token == null || token.isEmpty) return;
    _connecting = true;
    try {
      final origin = Uri.parse(ApiConfig.baseUrl).origin;
      _socket?.dispose();
      _socket = io.io(
        origin,
        io.OptionBuilder()
            .setPath('/api/v1/realtime')
            .setTransports(['websocket'])
            .setAuth({'token': token})
            .enableAutoConnect()
            .enableReconnection()
            .build(),
      );
      _bind(_socket!);
    } finally {
      _connecting = false;
    }
  }

  void _bind(io.Socket socket) {
    socket.onConnect((_) {
      _controller.add(const RealtimeEvent(name: 'connected'));
      socket.emit('presence:ping', {'status': 'online'});
    });
    socket.onDisconnect((_) {
      _controller.add(const RealtimeEvent(name: 'disconnected'));
    });

    for (final name in const [
      'message:new',
      'message:edited',
      'message:deleted',
      'message:read',
      'message:delivered',
      'message:ack',
      'chat:inbox',
      'typing:start',
      'typing:stop',
      'call:incoming',
      'call:outgoing',
      'call:status',
      'call:signal',
      'presence:self',
      'notification:new',
      'notification:read',
      'notification:unread_count',
      'notification:updated',
      'favorite:created',
      'favorite:removed',
      'collection:updated',
      'compare:updated',
      'subscription:updated',
      'payment:updated',
      'ai:job',
      'ticket:updated',
    ]) {
      socket.on(name, (data) {
        _lastSyncAt = DateTime.now();
        _controller.add(RealtimeEvent(name: name, data: data));
      });
    }
  }

  void joinConversation(String uuid) {
    _socket?.emit('join:conversation', uuid);
  }

  void leaveConversation(String uuid) {
    _socket?.emit('leave:conversation', uuid);
  }

  void typingStart(String uuid) =>
      _socket?.emit('typing:start', {'conversationUuid': uuid});

  void typingStop(String uuid) =>
      _socket?.emit('typing:stop', {'conversationUuid': uuid});

  void pingPresence({String status = 'online'}) =>
      _socket?.emit('presence:ping', {'status': status});

  void signalCall(String callUuid, String type, [Object? payload]) {
    _socket?.emit('call:signal', {
      'callUuid': callUuid,
      'type': type,
      'payload': payload,
    });
  }

  Future<void> disconnect() async {
    _socket?.dispose();
    _socket = null;
  }
}

class RealtimeEvent {
  const RealtimeEvent({required this.name, this.data});
  final String name;
  final dynamic data;

  Map<String, dynamic>? get map =>
      data is Map ? Map<String, dynamic>.from(data as Map) : null;
}

ChatMessage? messageFromEvent(dynamic data) {
  if (data is Map) {
    return ChatMessage.fromJson(Map<String, dynamic>.from(data));
  }
  return null;
}

CallSession? callFromEvent(dynamic data) {
  if (data is Map) {
    return CallSession.fromJson(Map<String, dynamic>.from(data));
  }
  return null;
}
