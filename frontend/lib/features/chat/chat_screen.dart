import 'package:flutter/material.dart';
import 'package:go_router/go_router.dart';
import 'package:signals_flutter/signals_flutter.dart'
    hide AsyncState, AsyncLoading, AsyncData, AsyncError;
import 'package:timeago/timeago.dart' as timeago;

import '../../app/localization/app_localizations_wrapper.dart';
import '../../app/router.dart';
import '../../app/theme/app_colors.dart';
import '../../core/auth/guest_feature.dart';
import '../../core/di/service_locator.dart';
import '../../core/result/async_state.dart';
import '../../shared/extensions/context_extensions.dart';
import '../../shared/widgets/app_scaffold.dart';
import 'chat_store.dart';

class ChatScreen extends StatefulWidget {
  const ChatScreen({super.key});

  @override
  State<ChatScreen> createState() => _ChatScreenState();
}

class _ChatScreenState extends State<ChatScreen> {
  late final ChatInboxStore _store;

  @override
  void initState() {
    super.initState();
    final sl = ServiceLocator.instance;
    _store = ChatInboxStore(sl.chatRepository, sl.realtimeClient);
    _store.listen();
    _store.load();
  }

  @override
  void dispose() {
    _store.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final l10n = context.l10n;

    return AppScaffold(
      title: l10n.chat,
      actions: [
        IconButton(
          tooltip: 'Call history',
          onPressed: () => context.push('/calls/history'),
          icon: const Icon(Icons.history),
        ),
      ],
      body: GuestGate(
        feature: GuestFeature.sendMessage,
        message: l10n.guestRestrictionMessage,
        child: SignalBuilder(builder: (context) {
          final state = _store.conversations.value;
          if (state.isLoading && state.dataOrNull == null) {
            return const LoadingView(message: 'Loading conversations…');
          }
          if (state case AsyncError(:final message)) {
            return EmptyState(
              title: 'Could not load chats',
              subtitle: message,
              action: FilledButton(
                onPressed: _store.load,
                child: Text(l10n.retry),
              ),
            );
          }
          final items = state.dataOrNull ?? [];
          if (items.isEmpty) {
            return EmptyState(
              title: 'No conversations yet',
              subtitle:
                  'Open a listing and tap Contact seller to start chatting.',
              action: FilledButton(
                onPressed: () => context.go(AppRoutes.home),
                child: const Text('Browse listings'),
              ),
            );
          }
          return RefreshIndicator(
            onRefresh: _store.load,
            child: ListView.separated(
              padding: EdgeInsets.symmetric(
                horizontal: context.isCompact ? 12 : 16,
                vertical: 8,
              ),
              itemCount: items.length,
              separatorBuilder: (_, _) => const Divider(height: 1),
              itemBuilder: (_, i) {
                final c = items[i];
                return ListTile(
                  contentPadding: const EdgeInsets.symmetric(vertical: 6),
                  leading: CircleAvatar(
                    backgroundColor: AppColors.charcoalSurface,
                    child: Text(
                      (c.peerName ?? c.title).isNotEmpty
                          ? (c.peerName ?? c.title)[0].toUpperCase()
                          : '?',
                      style: const TextStyle(color: AppColors.gold),
                    ),
                  ),
                  title: Text(
                    c.title,
                    maxLines: 1,
                    overflow: TextOverflow.ellipsis,
                  ),
                  subtitle: Text(
                    [
                      if (c.listingTitle != null && c.listingTitle != c.peerName)
                        c.listingTitle!,
                      c.lastMessagePreview ?? 'No messages yet',
                    ].join(' · '),
                    maxLines: 2,
                    overflow: TextOverflow.ellipsis,
                  ),
                  trailing: Column(
                    mainAxisAlignment: MainAxisAlignment.center,
                    crossAxisAlignment: CrossAxisAlignment.end,
                    children: [
                      if (c.lastMessageAt != null)
                        Text(
                          timeago.format(c.lastMessageAt!),
                          style: Theme.of(context).textTheme.bodySmall,
                        ),
                      if (c.unreadCount > 0) ...[
                        const SizedBox(height: 4),
                        CircleAvatar(
                          radius: 10,
                          backgroundColor: AppColors.gold,
                          child: Text(
                            '${c.unreadCount}',
                            style: const TextStyle(
                              fontSize: 10,
                              color: AppColors.charcoal,
                            ),
                          ),
                        ),
                      ],
                    ],
                  ),
                  onTap: () => context.push('/chat/${c.uuid}'),
                );
              },
            ),
          );
        }),
      ),
    );
  }
}
