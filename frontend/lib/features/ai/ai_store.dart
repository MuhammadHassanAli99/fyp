import 'dart:async';

import 'package:signals/signals.dart' hide AsyncState, AsyncLoading, AsyncData, AsyncError;

import '../../core/result/async_state.dart';
import '../../data/models/ai_models.dart';
import '../../data/repositories/ai_repository.dart';
import '../../data/services/realtime_client.dart';

class AiSupportStore {
  AiSupportStore(this._repo, [this._realtime]);

  final AiRepository _repo;
  final RealtimeClient? _realtime;

  final messages = signal<List<({bool mine, String text})>>([]);
  final sending = signal(false);
  final error = signal<String?>(null);
  final sessionUuid = signal<String?>(null);
  final jobStatus = signal<AsyncState<AiJob>>(const AsyncIdle());
  StreamSubscription<RealtimeEvent>? _sub;

  void listen() {
    _sub?.cancel();
    _sub = _realtime?.events.listen((event) {
      if (event.name != 'ai:job') return;
      final uuid = event.map?['uuid']?.toString();
      final status = event.map?['status']?.toString();
      if (uuid == null || status == null) return;
      jobStatus.value = AsyncData(
        AiJob(uuid: uuid, task: event.map?['task']?.toString() ?? '', status: status),
      );
    });
  }

  Future<void> send(String text, {bool confirmTool = false}) async {
    final trimmed = text.trim();
    if (trimmed.isEmpty || sending.value) return;
    sending.value = true;
    error.value = null;
    messages.value = [...messages.value, (mine: true, text: trimmed)];
    final result = await _repo.support(
      message: trimmed,
      sessionUuid: sessionUuid.value,
      confirmTool: confirmTool,
    );
    sending.value = false;
    result.when(
      success: (turn) {
        sessionUuid.value = turn.sessionUuid;
        messages.value = [...messages.value, (mine: false, text: turn.reply)];
        if (turn.shouldEscalate && turn.ticketUuid != null) {
          messages.value = [
            ...messages.value,
            (mine: false, text: 'A human ticket was opened: ${turn.ticketUuid}'),
          ];
        }
      },
      failure: (message, code) {
        error.value = message;
        if (code == 'FEATURE_NOT_IN_PLAN' || code == 'QUOTA_EXCEEDED') {
          messages.value = [
            ...messages.value,
            (mine: false, text: message),
          ];
        }
      },
    );
  }

  void dispose() {
    _sub?.cancel();
  }
}
