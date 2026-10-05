import 'dart:async';

import 'package:flutter/material.dart';
import 'package:signals_flutter/signals_flutter.dart';

import '../../app/theme/app_colors.dart';
import '../../core/di/service_locator.dart';
import '../../data/models/chat_models.dart';
import '../../shared/widgets/app_scaffold.dart';

class IncomingCallHost extends StatelessWidget {
  const IncomingCallHost({super.key, required this.child});

  final Widget child;

  @override
  Widget build(BuildContext context) {
    return SignalBuilder(
      builder: (context) {
        final call =
            ServiceLocator.instance.communicationHub.incomingCall.value;
        return Stack(
          fit: StackFit.expand,
          children: [
            child,
            if (call != null && !call.isTerminal)
              Positioned.fill(
                child: CallScreen(
                  call: call,
                  outgoing: false,
                  peerName: 'Incoming call',
                  onClosed: () =>
                      ServiceLocator.instance.communicationHub.clearIncoming(),
                ),
              ),
          ],
        );
      },
    );
  }
}

class CallScreen extends StatefulWidget {
  const CallScreen({
    super.key,
    required this.call,
    required this.peerName,
    this.outgoing = false,
    this.onClosed,
  });

  final CallSession call;
  final String peerName;
  final bool outgoing;
  final VoidCallback? onClosed;

  @override
  State<CallScreen> createState() => _CallScreenState();
}

class _CallScreenState extends State<CallScreen> {
  late CallSession _call;
  late Timer _timer;
  int _seconds = 0;
  bool _muted = false;
  bool _speaker = false;
  bool _cameraOn = true;
  bool _reconnecting = false;
  String _status = 'ringing';

  StreamSubscription<dynamic>? _sub;

  @override
  void initState() {
    super.initState();
    _call = widget.call;
    _status = widget.call.status;
    _timer = Timer.periodic(const Duration(seconds: 1), (_) {
      if (_status == 'connected' || _status == 'accepted' || _status == 'connecting') {
        setState(() => _seconds++);
      }
    });
    _sub = ServiceLocator.instance.realtimeClient.events.listen((event) {
      if (event.name == 'call:status') {
        final next = CallSession.fromJson(event.map ?? {});
        if (next.uuid != _call.uuid) return;
        setState(() {
          _call = next;
          _status = next.status;
          _reconnecting = next.status == 'connecting';
        });
        if (next.isTerminal && mounted) _close();
      }
      if (event.name == 'disconnected') {
        setState(() => _reconnecting = true);
      }
      if (event.name == 'connected') {
        setState(() => _reconnecting = false);
      }
    });
    if (widget.outgoing) {
      ServiceLocator.instance.realtimeClient.signalCall(_call.uuid, 'offer', {
        'sdp': 'local-offer-pending-webrtc',
      });
    }
  }

  @override
  void dispose() {
    _timer.cancel();
    _sub?.cancel();
    super.dispose();
  }

  void _close() {
    widget.onClosed?.call();
    if (widget.onClosed == null && mounted) {
      Navigator.of(context).maybePop();
    }
  }

  Future<void> _setStatus(String status) async {
    await ServiceLocator.instance.chatRepository
        .updateCallStatus(_call.uuid, status);
  }

  Future<void> _accept() async {
    await _setStatus('accepted');
    await _setStatus('connecting');
    ServiceLocator.instance.realtimeClient.signalCall(_call.uuid, 'answer', {
      'sdp': 'local-answer-pending-webrtc',
    });
    await _setStatus('connected');
  }

  Future<void> _end() async {
    final next = _status == 'ringing'
        ? (widget.outgoing ? 'cancelled' : 'rejected')
        : 'ended';
    ServiceLocator.instance.realtimeClient.signalCall(_call.uuid, 'hangup');
    await _setStatus(next);
    if (mounted) _close();
  }

  String get _clock {
    final m = (_seconds ~/ 60).toString().padLeft(2, '0');
    final s = (_seconds % 60).toString().padLeft(2, '0');
    return '$m:$s';
  }

  String get _label {
    if (_reconnecting) return 'Reconnecting…';
    return switch (_status) {
      'ringing' => widget.outgoing ? 'Calling…' : 'Incoming call',
      'accepted' => 'Connecting…',
      'connecting' => 'Connecting…',
      'connected' => _call.isVideo ? 'Video call' : 'Voice call',
      'failed' => 'Call failed',
      'busy' => 'Busy',
      'timeout' || 'missed' => 'No answer',
      _ => _status,
    };
  }

  @override
  Widget build(BuildContext context) {
    final failed = _status == 'failed' || _status == 'busy' || _status == 'timeout';
    return Scaffold(
      backgroundColor: AppColors.charcoal,
      body: SafeArea(
        child: Column(
          children: [
            const SizedBox(height: 48),
            CircleAvatar(
              radius: 48,
              backgroundColor: AppColors.charcoalSurface,
              child: Icon(
                _call.isVideo ? Icons.videocam : Icons.call,
                color: AppColors.gold,
                size: 40,
              ),
            ),
            const SizedBox(height: 16),
            Text(widget.peerName, style: Theme.of(context).textTheme.headlineSmall),
            const SizedBox(height: 8),
            Text(_label, style: Theme.of(context).textTheme.bodyLarge),
            const SizedBox(height: 8),
            Text(_clock),
            if (_call.isVideo)
              Expanded(
                child: Container(
                  margin: const EdgeInsets.all(24),
                  decoration: BoxDecoration(
                    color: Colors.black26,
                    borderRadius: BorderRadius.circular(16),
                  ),
                  child: Center(
                    child: Text(
                      _cameraOn
                          ? 'Camera preview waits for WebRTC media'
                          : 'Camera off',
                      textAlign: TextAlign.center,
                    ),
                  ),
                ),
              )
            else
              const Spacer(),
            if (failed)
              Padding(
                padding: const EdgeInsets.all(16),
                child: Text(
                  'The call could not be connected. Check network and try again.',
                  textAlign: TextAlign.center,
                  style: Theme.of(context).textTheme.bodySmall,
                ),
              ),
            Padding(
              padding: const EdgeInsets.fromLTRB(24, 8, 24, 32),
              child: Wrap(
                alignment: WrapAlignment.center,
                spacing: 16,
                runSpacing: 16,
                children: [
                  _Round(
                    icon: _muted ? Icons.mic_off : Icons.mic,
                    label: _muted ? 'Unmute' : 'Mute',
                    onTap: () => setState(() => _muted = !_muted),
                  ),
                  _Round(
                    icon: _speaker ? Icons.volume_up : Icons.volume_down,
                    label: 'Speaker',
                    onTap: () => setState(() => _speaker = !_speaker),
                  ),
                  if (_call.isVideo) ...[
                    _Round(
                      icon: _cameraOn ? Icons.videocam : Icons.videocam_off,
                      label: _cameraOn ? 'Camera' : 'Cam off',
                      onTap: () => setState(() => _cameraOn = !_cameraOn),
                    ),
                    _Round(
                      icon: Icons.cameraswitch,
                      label: 'Switch',
                      onTap: () {},
                    ),
                  ],
                  if (!widget.outgoing && _status == 'ringing')
                    _Round(
                      icon: Icons.call,
                      label: 'Accept',
                      color: Colors.green,
                      onTap: _accept,
                    ),
                  _Round(
                    icon: Icons.call_end,
                    label: 'End',
                    color: Colors.redAccent,
                    onTap: _end,
                  ),
                ],
              ),
            ),
          ],
        ),
      ),
    );
  }
}

class _Round extends StatelessWidget {
  const _Round({
    required this.icon,
    required this.label,
    required this.onTap,
    this.color,
  });

  final IconData icon;
  final String label;
  final VoidCallback onTap;
  final Color? color;

  @override
  Widget build(BuildContext context) {
    return Column(
      children: [
        InkWell(
          onTap: onTap,
          customBorder: const CircleBorder(),
          child: CircleAvatar(
            radius: 28,
            backgroundColor: color ?? AppColors.charcoalSurface,
            child: Icon(icon, color: Colors.white),
          ),
        ),
        const SizedBox(height: 6),
        Text(label, style: Theme.of(context).textTheme.bodySmall),
      ],
    );
  }
}

class CallHistoryScreen extends StatefulWidget {
  const CallHistoryScreen({super.key});

  @override
  State<CallHistoryScreen> createState() => _CallHistoryScreenState();
}

class _CallHistoryScreenState extends State<CallHistoryScreen> {
  List<CallSession> _items = [];
  bool _loading = true;
  String? _error;

  @override
  void initState() {
    super.initState();
    _load();
  }

  Future<void> _load() async {
    final result = await ServiceLocator.instance.chatRepository.callHistory();
    if (!mounted) return;
    result.when(
      success: (items) => setState(() {
        _items = items;
        _loading = false;
      }),
      failure: (m, _) => setState(() {
        _error = m;
        _loading = false;
      }),
    );
  }

  @override
  Widget build(BuildContext context) {
    return AppScaffold(
      title: 'Call history',
      showSellFab: false,
      body: _loading
          ? const LoadingView()
          : _error != null
              ? EmptyState(title: _error!)
              : ListView.separated(
                  itemCount: _items.length,
                  separatorBuilder: (_, _) => const Divider(height: 1),
                  itemBuilder: (_, i) {
                    final c = _items[i];
                    return ListTile(
                      leading: Icon(
                        c.isVideo ? Icons.videocam : Icons.call,
                        color: AppColors.gold,
                      ),
                      title: Text(c.historyStatus ?? c.status),
                      subtitle: Text(
                        '${c.kind} · ${c.durationSecs}s',
                      ),
                      trailing: Text(c.startedAt?.toLocal().toString().substring(0, 16) ?? ''),
                    );
                  },
                ),
    );
  }
}
