import 'package:desktop_drop/desktop_drop.dart';
import 'package:file_selector/file_selector.dart';
import 'package:flutter/foundation.dart';
import 'package:flutter/material.dart';
import 'package:mime/mime.dart';

import '../../app/theme/app_colors.dart';
import '../../core/platform/platform_capabilities.dart';

enum DropMediaKind { image, video, document, any }

class QueuedDropFile {
  QueuedDropFile({
    required this.name,
    required this.bytes,
    required this.mimeType,
    required this.kind,
    this.path,
  });

  final String name;
  final Uint8List bytes;
  final String mimeType;
  final DropMediaKind kind;
  final String? path;
}

/// Drop → validate → preview → queue. Invalid files never enter the upload path.
class MediaDropZone extends StatefulWidget {
  const MediaDropZone({
    super.key,
    required this.onQueued,
    this.allowed = const {DropMediaKind.image, DropMediaKind.video, DropMediaKind.document},
    this.maxBytes = 25 * 1024 * 1024,
    this.title = 'Drop images, videos or documents',
    this.subtitle = 'Or browse. Invalid files are rejected before upload.',
    this.compact = false,
  });

  final ValueChanged<List<QueuedDropFile>> onQueued;
  final Set<DropMediaKind> allowed;
  final int maxBytes;
  final String title;
  final String subtitle;
  final bool compact;

  @override
  State<MediaDropZone> createState() => _MediaDropZoneState();
}

class _MediaDropZoneState extends State<MediaDropZone> {
  bool _hovering = false;
  String? _error;

  DropMediaKind? _classify(String name, String mime) {
    if (mime.startsWith('image/')) return DropMediaKind.image;
    if (mime.startsWith('video/')) return DropMediaKind.video;
    if (mime.contains('pdf') ||
        mime.contains('msword') ||
        mime.contains('officedocument') ||
        name.endsWith('.pdf') ||
        name.endsWith('.doc') ||
        name.endsWith('.docx')) {
      return DropMediaKind.document;
    }
    return DropMediaKind.document;
  }

  bool _accepts(DropMediaKind kind) =>
      widget.allowed.contains(DropMediaKind.any) || widget.allowed.contains(kind);

  Future<void> _ingest({
    required String name,
    required Uint8List bytes,
    String? mimeType,
    String? path,
  }) async {
    final mime = mimeType ?? lookupMimeType(name) ?? 'application/octet-stream';
    final kind = _classify(name.toLowerCase(), mime) ?? DropMediaKind.document;
    if (!_accepts(kind)) {
      setState(() => _error = '$name is not an allowed file type');
      return;
    }
    if (bytes.length > widget.maxBytes) {
      setState(() => _error = '$name exceeds the size limit');
      return;
    }
    setState(() => _error = null);
    widget.onQueued([
      QueuedDropFile(name: name, bytes: bytes, mimeType: mime, kind: kind, path: path),
    ]);
  }

  Future<void> _browse() async {
    final caps = PlatformCapabilities.instance;
    final group = XTypeGroup(
      label: 'Media',
      extensions: [
        if (_accepts(DropMediaKind.image)) ...['jpg', 'jpeg', 'png', 'webp', 'heic'],
        if (_accepts(DropMediaKind.video)) ...['mp4', 'mov', 'webm'],
        if (_accepts(DropMediaKind.document)) ...['pdf', 'doc', 'docx'],
      ],
    );
    if (caps.hasFilePicker) {
      final files = await openFiles(acceptedTypeGroups: [group]);
      for (final file in files) {
        await _ingest(
          name: file.name,
          bytes: await file.readAsBytes(),
          mimeType: file.mimeType,
          path: file.path,
        );
      }
    }
  }

  @override
  Widget build(BuildContext context) {
    final zone = AnimatedContainer(
      duration: const Duration(milliseconds: 150),
      padding: EdgeInsets.all(widget.compact ? 12 : 20),
      decoration: BoxDecoration(
        borderRadius: BorderRadius.circular(12),
        border: Border.all(
          color: _hovering ? AppColors.gold : AppColors.gold.withValues(alpha: 0.35),
          width: _hovering ? 2 : 1,
        ),
        color: _hovering
            ? AppColors.gold.withValues(alpha: 0.08)
            : AppColors.charcoalSurface.withValues(alpha: 0.4),
      ),
      child: Column(
        children: [
          Icon(Icons.unarchive_outlined, color: AppColors.gold),
          const SizedBox(height: 8),
          Text(widget.title, textAlign: TextAlign.center),
          const SizedBox(height: 4),
          Text(
            widget.subtitle,
            textAlign: TextAlign.center,
            style: Theme.of(context).textTheme.bodySmall,
          ),
          const SizedBox(height: 12),
          OutlinedButton.icon(
            onPressed: _browse,
            icon: const Icon(Icons.folder_open),
            label: const Text('Browse files'),
          ),
          if (_error != null) ...[
            const SizedBox(height: 8),
            Text(_error!, style: TextStyle(color: Theme.of(context).colorScheme.error)),
          ],
        ],
      ),
    );

    if (!(kIsWeb ||
        defaultTargetPlatform == TargetPlatform.windows ||
        defaultTargetPlatform == TargetPlatform.macOS ||
        defaultTargetPlatform == TargetPlatform.linux)) {
      return zone;
    }

    return DropTarget(
      onDragEntered: (_) => setState(() => _hovering = true),
      onDragExited: (_) => setState(() => _hovering = false),
      onDragDone: (detail) async {
        setState(() => _hovering = false);
        for (final file in detail.files) {
          await _ingest(
            name: file.name,
            bytes: await file.readAsBytes(),
            mimeType: lookupMimeType(file.name),
            path: file.path,
          );
        }
      },
      child: zone,
    );
  }
}
