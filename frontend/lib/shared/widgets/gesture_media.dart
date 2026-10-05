import 'package:cached_network_image/cached_network_image.dart';
import 'package:flutter/material.dart';

import '../../app/theme/app_colors.dart';

/// Horizontal gallery with swipe, pinch-zoom and accessible next/previous.
class GestureMediaGallery extends StatefulWidget {
  const GestureMediaGallery({
    super.key,
    required this.urls,
    this.height,
    this.onIndexChanged,
    this.initialIndex = 0,
  });

  final List<String> urls;
  final double? height;
  final ValueChanged<int>? onIndexChanged;
  final int initialIndex;

  @override
  State<GestureMediaGallery> createState() => _GestureMediaGalleryState();
}

class _GestureMediaGalleryState extends State<GestureMediaGallery> {
  late final PageController _controller;
  late int _index;

  @override
  void initState() {
    super.initState();
    _index = widget.initialIndex;
    _controller = PageController(initialPage: widget.initialIndex);
  }

  @override
  void dispose() {
    _controller.dispose();
    super.dispose();
  }

  void _go(int delta) {
    if (widget.urls.isEmpty) return;
    final next = (_index + delta).clamp(0, widget.urls.length - 1);
    _controller.animateToPage(
      next,
      duration: const Duration(milliseconds: 220),
      curve: Curves.easeOut,
    );
  }

  @override
  Widget build(BuildContext context) {
    if (widget.urls.isEmpty) {
      return Container(
        height: widget.height ?? 220,
        color: AppColors.charcoalSurface,
        child: const Icon(Icons.image_outlined, color: AppColors.goldMuted),
      );
    }

    return Column(
      children: [
        SizedBox(
          height: widget.height ?? 240,
          child: Stack(
            children: [
              PageView.builder(
                controller: _controller,
                itemCount: widget.urls.length,
                onPageChanged: (i) {
                  setState(() => _index = i);
                  widget.onIndexChanged?.call(i);
                },
                itemBuilder: (_, i) {
                  return InteractiveViewer(
                    minScale: 1,
                    maxScale: 4,
                    child: CachedNetworkImage(
                      imageUrl: widget.urls[i],
                      fit: BoxFit.cover,
                      width: double.infinity,
                      placeholder: (_, _) => const Center(
                        child: CircularProgressIndicator(color: AppColors.gold, strokeWidth: 2),
                      ),
                      errorWidget: (_, _, _) => const Icon(Icons.broken_image_outlined),
                    ),
                  );
                },
              ),
              if (widget.urls.length > 1) ...[
                Align(
                  alignment: AlignmentDirectional.centerStart,
                  child: IconButton.filledTonal(
                    tooltip: MaterialLocalizations.of(context).previousPageTooltip,
                    onPressed: _index == 0 ? null : () => _go(-1),
                    icon: const Icon(Icons.chevron_left),
                  ),
                ),
                Align(
                  alignment: AlignmentDirectional.centerEnd,
                  child: IconButton.filledTonal(
                    tooltip: MaterialLocalizations.of(context).nextPageTooltip,
                    onPressed: _index >= widget.urls.length - 1 ? null : () => _go(1),
                    icon: const Icon(Icons.chevron_right),
                  ),
                ),
              ],
            ],
          ),
        ),
        if (widget.urls.length > 1)
          Padding(
            padding: const EdgeInsets.only(top: 8),
            child: Row(
              mainAxisAlignment: MainAxisAlignment.center,
              children: [
                for (var i = 0; i < widget.urls.length; i++)
                  Container(
                    width: 7,
                    height: 7,
                    margin: const EdgeInsets.symmetric(horizontal: 3),
                    decoration: BoxDecoration(
                      shape: BoxShape.circle,
                      color: i == _index ? AppColors.gold : AppColors.goldMuted,
                    ),
                  ),
              ],
            ),
          ),
      ],
    );
  }
}

class SwipeActionTile extends StatelessWidget {
  const SwipeActionTile({
    super.key,
    required this.child,
    this.onDismissed,
    this.confirmDismiss,
    this.background,
    this.secondaryBackground,
    this.dismissible = true,
  });

  final Widget child;
  final DismissDirectionCallback? onDismissed;
  final ConfirmDismissCallback? confirmDismiss;
  final Widget? background;
  final Widget? secondaryBackground;
  final bool dismissible;

  @override
  Widget build(BuildContext context) {
    if (!dismissible || onDismissed == null) return child;
    return Dismissible(
      key: ValueKey(child.hashCode),
      onDismissed: onDismissed,
      confirmDismiss: confirmDismiss,
      background: background ??
          Container(
            color: Colors.red.withValues(alpha: 0.2),
            alignment: AlignmentDirectional.centerStart,
            padding: const EdgeInsets.symmetric(horizontal: 20),
            child: const Icon(Icons.delete_outline),
          ),
      secondaryBackground: secondaryBackground,
      child: child,
    );
  }
}
