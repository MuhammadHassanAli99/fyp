import 'dart:async';

import 'package:signals/signals.dart';

import '../models/chat_models.dart';
import 'realtime_client.dart';

/// App-wide incoming-call + connection state. Screens watch [incomingCall].
class CommunicationHub {
  CommunicationHub(this.realtime);

  final RealtimeClient realtime;
  StreamSubscription<RealtimeEvent>? _sub;

  final incomingCall = signal<CallSession?>(null);
  final connected = signal(false);

  void start() {
    _sub?.cancel();
    _sub = realtime.events.listen((event) {
      switch (event.name) {
        case 'connected':
          connected.value = true;
        case 'disconnected':
          connected.value = false;
        case 'call:incoming':
          final call = callFromEvent(event.data);
          if (call != null && !call.isTerminal) incomingCall.value = call;
        case 'call:status':
          final call = callFromEvent(event.data);
          if (call == null) return;
          if (incomingCall.value?.uuid == call.uuid && call.isTerminal) {
            incomingCall.value = null;
          }
      }
    });
  }

  void clearIncoming() => incomingCall.value = null;

  Future<void> dispose() async {
    await _sub?.cancel();
  }
}
