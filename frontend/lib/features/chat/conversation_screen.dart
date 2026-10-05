import 'dart:async';

import 'package:audioplayers/audioplayers.dart';
import 'package:cached_network_image/cached_network_image.dart';
import 'package:file_selector/file_selector.dart';
import 'package:flutter/foundation.dart';
import 'package:flutter/material.dart';
import 'package:go_router/go_router.dart';
import 'package:image_picker/image_picker.dart';
import 'package:path_provider/path_provider.dart';
import 'package:signals_flutter/signals_flutter.dart'
    hide AsyncState, AsyncLoading, AsyncData, AsyncError;
import 'package:timeago/timeago.dart' as timeago;
import 'package:uuid/uuid.dart';
import 'package:video_player/video_player.dart';
import 'package:record/record.dart';

import '../../app/localization/app_localizations_wrapper.dart';
import '../../app/app_routes.dart';
import '../../app/theme/app_colors.dart';
import '../../core/di/service_locator.dart';
import '../../core/result/async_state.dart';
import '../../data/models/chat_models.dart';
import '../../shared/extensions/context_extensions.dart';
import '../../shared/widgets/app_scaffold.dart';
import 'call_screen.dart';
import 'chat_store.dart';
import 'communication_permissions.dart';

class ConversationScreen extends StatefulWidget {
  const ConversationScreen({super.key, required this.conversationUuid});

  final String conversationUuid;

  @override
  State<ConversationScreen> createState() => _ConversationScreenState();
}

class _ConversationScreenState extends State<ConversationScreen> {
  late final ConversationStore _store;
  final _text = TextEditingController();
  final _scroll = ScrollController();
  final _recorder = AudioRecorder();
  final _picker = ImagePicker();
  bool _recording = false;
  DateTime? _recordStarted;

  @override
  void initState() {
    super.initState();
    final sl = ServiceLocator.instance;
    _store = ConversationStore(
      sl.chatRepository,
      widget.conversationUuid,
      sl.realtimeClient,
    );
    _store.load();
  }

  @override
  void dispose() {
    _store.dispose();
    _text.dispose();
    _scroll.dispose();
    _recorder.dispose();
    super.dispose();
  }

  int? get _myId =>
      ServiceLocator.instance.authRepository.currentUser?.intId;

  Future<void> _sendText() async {
    final ok = await _store.sendText(_text.text);
    if (ok) {
      _text.clear();
      _scrollToEnd();
    }
  }

  void _scrollToEnd() {
    WidgetsBinding.instance.addPostFrameCallback((_) {
      if (!_scroll.hasClients) return;
      _scroll.animateTo(
        _scroll.position.maxScrollExtent + 80,
        duration: const Duration(milliseconds: 250),
        curve: Curves.easeOut,
      );
    });
  }

  Future<Uint8List> _readXFile(XFile file) => file.readAsBytes();

  Future<void> _sendBytes({
    required Uint8List bytes,
    required String kind,
    required String attachKind,
    required String mimeType,
    required String filename,
    int? durationMs,
  }) async {
    try {
      _store.uploadProgress.value = 0.1;
      final uploaded =
          await ServiceLocator.instance.mediaUploadService.uploadBytes(
        bytes: bytes,
        purpose: 'chat_attachment',
        mimeType: mimeType,
        filename: filename,
      );
      _store.uploadProgress.value = 0.8;
      final ok = await _store.sendMedia(
        kind: kind,
        durationMs: durationMs,
        attachments: [
          {
            'kind': attachKind,
            'url': uploaded.fileUrl,
            'storageKey': uploaded.storagePath,
            'fileName': filename,
            'mimeType': uploaded.mimeType,
            'sizeBytes': bytes.length,
            'durationMs': ?durationMs,
          },
        ],
      );
      if (ok) _scrollToEnd();
    } catch (e) {
      if (!mounted) return;
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(content: Text('Could not send media: $e')),
      );
    } finally {
      _store.uploadProgress.value = null;
    }
  }

  Future<void> _pickMedia({required bool video}) async {
    final file = video
        ? await _picker.pickVideo(
            source: ImageSource.gallery,
            maxDuration: const Duration(minutes: 2),
          )
        : await _picker.pickImage(
            source: ImageSource.gallery,
            imageQuality: 85,
            maxWidth: 1920,
          );
    if (file == null) return;
    final bytes = await _readXFile(file);
    await _sendBytes(
      bytes: bytes,
      kind: video ? 'video' : 'image',
      attachKind: video ? 'video' : 'image',
      mimeType: video ? 'video/mp4' : (file.mimeType ?? 'image/jpeg'),
      filename: file.name,
    );
  }

  Future<void> _pickDocument() async {
    final file = await openFile(
      acceptedTypeGroups: [
        const XTypeGroup(
          label: 'documents',
          extensions: ['pdf', 'docx', 'xlsx', 'txt'],
        ),
      ],
    );
    if (file == null) return;
    final bytes = await file.readAsBytes();
    final mime = file.mimeType ?? 'application/pdf';
    await _sendBytes(
      bytes: bytes,
      kind: 'document',
      attachKind: 'document',
      mimeType: mime,
      filename: file.name,
    );
  }

  Future<void> _sendLocation({required bool listing}) async {
    final conv = _store.conversation.value.dataOrNull;
    if (listing && conv?.listingLocation != null) {
      await _store.sendLocation(
        ChatLocation(
          latitude: conv!.listingLocation!.latitude,
          longitude: conv.listingLocation!.longitude,
          label: conv.listingTitle,
          source: 'listing',
        ),
      );
      _scrollToEnd();
      return;
    }
    final allowed = await ensureLocationPermission();
    if (!allowed) {
      if (!mounted) return;
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(content: Text('Location permission is required')),
      );
      return;
    }
    final gps = await ServiceLocator.instance.locationService.currentGps();
    if (gps == null) {
      if (!mounted) return;
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(content: Text('Could not read current location')),
      );
      return;
    }
    await _store.sendLocation(
      ChatLocation(
        latitude: gps.lat,
        longitude: gps.lng,
        timestamp: DateTime.now().toUtc().toIso8601String(),
        source: 'current',
      ),
    );
    _scrollToEnd();
  }

  Future<void> _toggleRecord() async {
    try {
      if (_recording) {
        final path = await _recorder.stop();
        setState(() => _recording = false);
        final started = _recordStarted;
        _recordStarted = null;
        if (path == null || path.isEmpty) return;
        final durationMs = started == null
            ? null
            : DateTime.now().difference(started).inMilliseconds;
        final file = XFile(path);
        final bytes = await file.readAsBytes();
        await _sendBytes(
          bytes: bytes,
          kind: 'voice',
          attachKind: 'audio',
          mimeType: 'audio/m4a',
          filename: 'voice.m4a',
          durationMs: durationMs,
        );
      } else {
        if (!kIsWeb) {
          final mic = await ensureMicrophonePermission();
          if (!mic) {
            if (!mounted) return;
            ScaffoldMessenger.of(context).showSnackBar(
              const SnackBar(content: Text('Microphone permission is required')),
            );
            return;
          }
        }
        final hasPerm = await _recorder.hasPermission();
        if (!hasPerm) return;
        final dir = kIsWeb ? null : await getTemporaryDirectory();
        final path = dir == null
            ? 'voice_${const Uuid().v4()}.m4a'
            : '${dir.path}/voice_${const Uuid().v4()}.m4a';
        await _recorder.start(
          const RecordConfig(encoder: AudioEncoder.aacLc),
          path: path,
        );
        setState(() {
          _recording = true;
          _recordStarted = DateTime.now();
        });
      }
    } catch (e) {
      setState(() => _recording = false);
      if (!mounted) return;
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(content: Text('Voice notes unavailable: $e')),
      );
    }
  }

  Future<void> _startCall({required bool video}) async {
    if (video) {
      final ok = await ensureCameraAndMicrophone();
      if (!ok) {
        if (!mounted) return;
        ScaffoldMessenger.of(context).showSnackBar(
          const SnackBar(content: Text('Camera and microphone are required')),
        );
        return;
      }
    } else {
      final ok = await ensureMicrophonePermission();
      if (!ok) {
        if (!mounted) return;
        ScaffoldMessenger.of(context).showSnackBar(
          const SnackBar(content: Text('Microphone permission is required')),
        );
        return;
      }
    }
    final call = await _store.startCall(kind: video ? 'video' : 'voice');
    if (call == null || !mounted) return;
    await Navigator.of(context).push(
      MaterialPageRoute<void>(
        builder: (_) => CallScreen(
          call: call,
          outgoing: true,
          peerName: _store.conversation.value.dataOrNull?.peerName ?? 'Peer',
        ),
      ),
    );
  }

  Future<void> _onMessageAction(ChatMessage msg) async {
    final mine = msg.senderId != null && msg.senderId == _myId;
    final action = await showModalBottomSheet<String>(
      context: context,
      builder: (ctx) => SafeArea(
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            ListTile(
              leading: const Icon(Icons.reply),
              title: const Text('Reply'),
              onTap: () => Navigator.pop(ctx, 'reply'),
            ),
            if (mine && msg.kind == 'text')
              ListTile(
                leading: const Icon(Icons.edit),
                title: const Text('Edit'),
                onTap: () => Navigator.pop(ctx, 'edit'),
              ),
            ListTile(
              leading: const Icon(Icons.delete_outline),
              title: const Text('Delete for me'),
              onTap: () => Navigator.pop(ctx, 'del_me'),
            ),
            if (mine)
              ListTile(
                leading: const Icon(Icons.delete_forever),
                title: const Text('Delete for everyone'),
                onTap: () => Navigator.pop(ctx, 'del_all'),
              ),
            ListTile(
              leading: const Icon(Icons.translate),
              title: const Text('Translate'),
              onTap: () => Navigator.pop(ctx, 'translate'),
            ),
            ListTile(
              leading: const Icon(Icons.flag_outlined),
              title: const Text('Report'),
              onTap: () => Navigator.pop(ctx, 'report'),
            ),
          ],
        ),
      ),
    );
    if (action == null) return;
    switch (action) {
      case 'reply':
        _store.replyTo.value = msg;
      case 'edit':
        _store.editing.value = msg;
        _text.text = msg.body ?? '';
      case 'del_me':
        await _store.deleteMessage(msg, forEveryone: false);
      case 'del_all':
        await _store.deleteMessage(msg, forEveryone: true);
      case 'translate':
        final lang = ServiceLocator.instance.settingsStore.languageCode.value;
        await _store.translate(msg, lang);
      case 'report':
        await _store.report(
          entityType: 'message',
          entityId: msg.id,
          reason: 'harassment',
        );
        if (mounted) {
          ScaffoldMessenger.of(context).showSnackBar(
            const SnackBar(content: Text('Report submitted for review')),
          );
        }
    }
  }

  @override
  Widget build(BuildContext context) {
    final l10n = context.l10n;
    return AppScaffold(
      title: 'Chat',
      showSellFab: false,
      actions: [
        IconButton(
          tooltip: 'Voice call',
          icon: const Icon(Icons.call_outlined),
          onPressed: () => _startCall(video: false),
        ),
        IconButton(
          tooltip: 'Video call',
          icon: const Icon(Icons.videocam_outlined),
          onPressed: () => _startCall(video: true),
        ),
        PopupMenuButton<String>(
          onSelected: (v) async {
            if (v == 'block') await _store.blockPeer();
            if (v == 'mute') {
              final conv = _store.conversation.value.dataOrNull;
              if (conv != null) {
                await ServiceLocator.instance.chatRepository
                    .mute(conv.uuid, !conv.isMuted);
                await _store.load();
              }
            }
            if (v == 'report') {
              final conv = _store.conversation.value.dataOrNull;
              if (conv != null) {
                await _store.report(
                  entityType: 'conversation',
                  entityId: conv.id,
                  reason: 'spam',
                );
              }
            }
            if (v == 'history') {
              if (!context.mounted) return;
              context.push('/calls/history');
            }
            if (v == 'support') {
              final conv = _store.conversation.value.dataOrNull;
              if (!context.mounted) return;
              context.push(
                AppRoutes.supportWith(
                  SupportContextQuery(
                    entityType: 'conversation',
                    conversationUuid: conv?.uuid,
                  ),
                ),
              );
            }
          },
          itemBuilder: (_) => const [
            PopupMenuItem(value: 'mute', child: Text('Mute / unmute')),
            PopupMenuItem(value: 'block', child: Text('Block user')),
            PopupMenuItem(value: 'report', child: Text('Report conversation')),
            PopupMenuItem(value: 'support', child: Text('Get support')),
            PopupMenuItem(value: 'history', child: Text('Call history')),
          ],
        ),
      ],
      body: SignalBuilder(builder: (context) {
        final convState = _store.conversation.value;
        final msgState = _store.messages.value;

        if (convState.isLoading || msgState.isLoading) {
          return const LoadingView();
        }
        if (convState case AsyncError(:final message)) {
          return EmptyState(
            title: message,
            action: FilledButton(onPressed: _store.load, child: Text(l10n.retry)),
          );
        }

        final conv = convState.dataOrNull;
        final items = msgState.dataOrNull ?? [];
        final presence = conv?.peerPresence;

        return Column(
          children: [
            if (conv != null)
              Material(
                color: AppColors.charcoalSurface,
                child: ListTile(
                  dense: true,
                  title: Text(conv.title),
                  subtitle: Text([
                    if (presence != null)
                      presence.isOnline
                          ? 'Online'
                          : presence.isAway
                              ? 'Away'
                              : presence.lastSeenAt != null
                                  ? 'Last seen ${timeago.format(presence.lastSeenAt!)}'
                                  : 'Offline',
                    if (conv.listingTitle != null) conv.listingTitle!,
                    if (_store.typingPeer.value) 'typing…',
                    if (_store.offline.value) 'Waiting for network…',
                  ].join(' · ')),
                  trailing: conv.listingUuid != null
                      ? TextButton(
                          onPressed: () =>
                              context.push('/listing/${conv.listingUuid}'),
                          child: const Text('Ad'),
                        )
                      : null,
                ),
              ),
            if (_store.uploadProgress.value != null)
              LinearProgressIndicator(value: _store.uploadProgress.value),
            Expanded(
              child: items.isEmpty
                  ? const Center(child: Text('Say hello — send the first message'))
                  : ListView.builder(
                      controller: _scroll,
                      padding: const EdgeInsets.fromLTRB(12, 12, 12, 8),
                      itemCount: items.length,
                      itemBuilder: (_, i) {
                        final msg = items[i];
                        final mine =
                            msg.senderId != null && msg.senderId == _myId;
                        return GestureDetector(
                          onLongPress: () => _onMessageAction(msg),
                          child: _MessageBubble(message: msg, mine: mine),
                        );
                      },
                    ),
            ),
            if (_store.replyTo.value != null || _store.editing.value != null)
              Material(
                color: AppColors.charcoalSurface,
                child: ListTile(
                  dense: true,
                  title: Text(
                    _store.editing.value != null ? 'Editing' : 'Replying',
                  ),
                  subtitle: Text(
                    _store.editing.value?.body ??
                        _store.replyTo.value?.body ??
                        '',
                    maxLines: 1,
                  ),
                  trailing: IconButton(
                    icon: const Icon(Icons.close),
                    onPressed: () {
                      _store.replyTo.value = null;
                      _store.editing.value = null;
                    },
                  ),
                ),
              ),
            if (_store.error.value != null)
              Padding(
                padding: const EdgeInsets.symmetric(horizontal: 12),
                child: Text(
                  _store.error.value!,
                  style: TextStyle(color: Theme.of(context).colorScheme.error),
                ),
              ),
            SafeArea(
              top: false,
              child: Padding(
                padding: const EdgeInsets.fromLTRB(8, 4, 8, 8),
                child: Row(
                  crossAxisAlignment: CrossAxisAlignment.end,
                  children: [
                    PopupMenuButton<String>(
                      tooltip: 'Attach',
                      icon: const Icon(Icons.add_circle_outline, color: AppColors.gold),
                      onSelected: (v) {
                        if (v == 'image') _pickMedia(video: false);
                        if (v == 'video') _pickMedia(video: true);
                        if (v == 'doc') _pickDocument();
                        if (v == 'loc') _sendLocation(listing: false);
                        if (v == 'listing') _sendLocation(listing: true);
                      },
                      itemBuilder: (_) => const [
                        PopupMenuItem(value: 'image', child: Text('Photo')),
                        PopupMenuItem(value: 'video', child: Text('Video')),
                        PopupMenuItem(value: 'doc', child: Text('Document')),
                        PopupMenuItem(value: 'loc', child: Text('Current location')),
                        PopupMenuItem(value: 'listing', child: Text('Listing location')),
                      ],
                    ),
                    IconButton(
                      tooltip: _recording ? 'Stop & send' : 'Voice message',
                      onPressed: _toggleRecord,
                      icon: Icon(
                        _recording ? Icons.stop_circle : Icons.mic_none,
                        color: _recording ? Colors.redAccent : AppColors.gold,
                      ),
                    ),
                    Expanded(
                      child: TextField(
                        controller: _text,
                        minLines: 1,
                        maxLines: 5,
                        textInputAction: TextInputAction.send,
                        onChanged: (_) => _store.onComposerChanged(),
                        onSubmitted: (_) => _sendText(),
                        decoration: const InputDecoration(
                          hintText: 'Message…',
                          isDense: true,
                        ),
                      ),
                    ),
                    SignalBuilder(builder: (context) {
                      final busy = _store.sending.value;
                      return IconButton.filled(
                        onPressed: busy ? null : _sendText,
                        style: IconButton.styleFrom(
                          backgroundColor: AppColors.gold,
                          foregroundColor: AppColors.charcoal,
                        ),
                        icon: busy
                            ? const SizedBox(
                                width: 18,
                                height: 18,
                                child: CircularProgressIndicator(strokeWidth: 2),
                              )
                            : const Icon(Icons.send),
                      );
                    }),
                  ],
                ),
              ),
            ),
          ],
        );
      }),
    );
  }
}

class _MessageBubble extends StatelessWidget {
  const _MessageBubble({required this.message, required this.mine});
  final ChatMessage message;
  final bool mine;

  @override
  Widget build(BuildContext context) {
    if (message.kind == 'system' || message.kind == 'call_log') {
      return Padding(
        padding: const EdgeInsets.symmetric(vertical: 6),
        child: Center(
          child: Text(
            message.body ?? message.kind,
            style: Theme.of(context).textTheme.bodySmall?.copyWith(
                  color: AppColors.goldMuted,
                ),
          ),
        ),
      );
    }

    if (message.deleted) {
      return Align(
        alignment: mine
            ? AlignmentDirectional.centerEnd
            : AlignmentDirectional.centerStart,
        child: Padding(
          padding: const EdgeInsets.symmetric(vertical: 4),
          child: Text(
            'Message deleted',
            style: Theme.of(context).textTheme.bodySmall?.copyWith(
                  fontStyle: FontStyle.italic,
                  color: AppColors.goldMuted,
                ),
          ),
        ),
      );
    }

    final bg = mine
        ? AppColors.gold.withValues(alpha: 0.22)
        : AppColors.charcoalSurface;

    return Align(
      alignment: mine
          ? AlignmentDirectional.centerEnd
          : AlignmentDirectional.centerStart,
      child: ConstrainedBox(
        constraints: BoxConstraints(
          maxWidth: context.screenSize.width * (context.isCompact ? 0.86 : 0.55),
        ),
        child: Container(
          margin: const EdgeInsets.symmetric(vertical: 4),
          padding: const EdgeInsets.all(10),
          decoration: BoxDecoration(
            color: bg,
            borderRadius: BorderRadiusDirectional.only(
              topStart: const Radius.circular(14),
              topEnd: const Radius.circular(14),
              bottomStart: Radius.circular(mine ? 14 : 4),
              bottomEnd: Radius.circular(mine ? 4 : 14),
            ),
          ),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              if (message.replyTo != null)
                Container(
                  width: double.infinity,
                  padding: const EdgeInsets.all(6),
                  margin: const EdgeInsets.only(bottom: 6),
                  decoration: BoxDecoration(
                    border: Border(
                      left: BorderSide(color: AppColors.gold, width: 2),
                    ),
                  ),
                  child: Text(
                    message.replyTo!.body ?? 'Message',
                    maxLines: 2,
                    style: Theme.of(context).textTheme.bodySmall,
                  ),
                ),
              for (final a in message.attachments) ...[
                if (a.kind == 'image' && (a.url ?? '').isNotEmpty)
                  ClipRRect(
                    borderRadius: BorderRadius.circular(8),
                    child: CachedNetworkImage(
                      imageUrl: a.url!,
                      fit: BoxFit.cover,
                      height: 180,
                      width: double.infinity,
                      errorWidget: (_, _, _) => const Icon(Icons.broken_image),
                    ),
                  )
                else if (a.kind == 'video' && (a.url ?? '').isNotEmpty)
                  _VideoThumb(url: a.url!)
                else if (a.kind == 'audio' && (a.url ?? '').isNotEmpty)
                  _VoicePlayer(url: a.url!, durationMs: a.durationMs)
                else
                  Text(a.fileName ?? a.url ?? 'Attachment'),
                const SizedBox(height: 6),
              ],
              if (message.location != null)
                Text(
                  message.location!.label ??
                      '${message.location!.latitude.toStringAsFixed(5)}, ${message.location!.longitude.toStringAsFixed(5)}',
                ),
              if (message.body != null && message.body!.isNotEmpty)
                Text(message.showTranslation
                    ? (message.translatedBody ?? message.body!)
                    : message.body!),
              if (message.showTranslation)
                Text(
                  'Translated · tap to report issues',
                  style: Theme.of(context).textTheme.bodySmall,
                ),
              const SizedBox(height: 4),
              Row(
                mainAxisSize: MainAxisSize.min,
                children: [
                  Text(
                    timeago.format(message.createdAt),
                    style: Theme.of(context).textTheme.bodySmall?.copyWith(
                          color: AppColors.goldMuted,
                          fontSize: 10,
                        ),
                  ),
                  if (message.isEdited)
                    Text(
                      ' · edited',
                      style: Theme.of(context).textTheme.bodySmall?.copyWith(
                            color: AppColors.goldMuted,
                            fontSize: 10,
                          ),
                    ),
                  if (mine) ...[
                    const SizedBox(width: 6),
                    Icon(
                      message.status == 'read'
                          ? Icons.done_all
                          : message.status == 'delivered'
                              ? Icons.done_all
                              : Icons.done,
                      size: 14,
                      color: message.status == 'read'
                          ? AppColors.gold
                          : AppColors.goldMuted,
                    ),
                  ],
                ],
              ),
            ],
          ),
        ),
      ),
    );
  }
}

class _VoicePlayer extends StatefulWidget {
  const _VoicePlayer({required this.url, this.durationMs});
  final String url;
  final int? durationMs;

  @override
  State<_VoicePlayer> createState() => _VoicePlayerState();
}

class _VoicePlayerState extends State<_VoicePlayer> {
  final _player = AudioPlayer();
  bool _playing = false;

  @override
  void dispose() {
    _player.dispose();
    super.dispose();
  }

  Future<void> _toggle() async {
    if (_playing) {
      await _player.stop();
      setState(() => _playing = false);
      return;
    }
    await _player.play(UrlSource(widget.url));
    setState(() => _playing = true);
    _player.onPlayerComplete.listen((_) {
      if (mounted) setState(() => _playing = false);
    });
  }

  @override
  Widget build(BuildContext context) {
    final secs = ((widget.durationMs ?? 0) / 1000).round();
    return Row(
      mainAxisSize: MainAxisSize.min,
      children: [
        IconButton(
          onPressed: _toggle,
          icon: Icon(_playing ? Icons.pause : Icons.play_arrow),
        ),
        Text(secs > 0 ? '${secs}s voice' : 'Voice message'),
      ],
    );
  }
}

class _VideoThumb extends StatefulWidget {
  const _VideoThumb({required this.url});
  final String url;

  @override
  State<_VideoThumb> createState() => _VideoThumbState();
}

class _VideoThumbState extends State<_VideoThumb> {
  VideoPlayerController? _controller;
  bool _ready = false;

  @override
  void initState() {
    super.initState();
    final c = VideoPlayerController.networkUrl(Uri.parse(widget.url));
    _controller = c;
    c.initialize().then((_) {
      if (mounted) setState(() => _ready = true);
    }).catchError((_) {});
  }

  @override
  void dispose() {
    _controller?.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final c = _controller;
    if (!_ready || c == null) {
      return Container(
        height: 160,
        color: AppColors.charcoal,
        child: const Center(child: Icon(Icons.videocam, color: AppColors.gold)),
      );
    }
    return AspectRatio(
      aspectRatio: c.value.aspectRatio == 0 ? 16 / 9 : c.value.aspectRatio,
      child: Stack(
        alignment: Alignment.center,
        children: [
          VideoPlayer(c),
          IconButton(
            onPressed: () {
              if (c.value.isPlaying) {
                c.pause();
              } else {
                c.play();
              }
              setState(() {});
            },
            icon: Icon(
              c.value.isPlaying ? Icons.pause_circle : Icons.play_circle,
              size: 48,
              color: Colors.white,
            ),
          ),
        ],
      ),
    );
  }
}
