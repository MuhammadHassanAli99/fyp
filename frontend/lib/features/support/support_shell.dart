import 'package:flutter/material.dart';
import 'package:go_router/go_router.dart';
import 'package:signals_flutter/signals_flutter.dart'
    hide AsyncState, AsyncLoading, AsyncData, AsyncError;

import '../../app/app_routes.dart';
import '../../app/theme/app_colors.dart';
import '../../core/di/service_locator.dart';
import '../../shared/extensions/context_extensions.dart';
import '../../shared/widgets/app_scaffold.dart';
import '../ai/ai_support_screen.dart';
import 'data/support_models.dart';
import 'support_store.dart';

export 'data/support_models.dart';

class SupportShell extends StatefulWidget {
  const SupportShell({super.key, this.contextData, this.initialTab});

  final SupportContext? contextData;
  final int? initialTab;

  @override
  State<SupportShell> createState() => _SupportShellState();
}

class _SupportShellState extends State<SupportShell> with SingleTickerProviderStateMixin {
  late final SupportStore _store;
  late final TabController _tabs;
  final _subject = TextEditingController();
  final _body = TextEditingController();

  bool get _agent => ServiceLocator.instance.authRepository.currentUser?.hasSupportAccess == true;

  @override
  void initState() {
    super.initState();
    _store = ServiceLocator.instance.supportStore;
    _tabs = TabController(length: _agent ? 6 : 5, vsync: this, initialIndex: widget.initialTab ?? 0);
    _subject.text = widget.contextData?.subjectHint ?? '';
    WidgetsBinding.instance.addPostFrameCallback((_) {
      _store.listen();
      _store.bootstrap(marketplace: widget.contextData?.marketplace);
      if (_agent) _store.loadQueue();
    });
  }

  @override
  void dispose() {
    _tabs.dispose();
    _subject.dispose();
    _body.dispose();
    super.dispose();
  }

  Future<void> _submitTicket() async {
    final ctx = widget.contextData;
    final uuid = await _store.createTicket({
      'subject': _subject.text.trim().isEmpty ? 'Help request' : _subject.text.trim(),
      'description': _body.text.trim(),
      ...?ctx?.toJson(),
    });
    if (!mounted) return;
    if (uuid != null) {
      _body.clear();
      context.push(AppRoutes.supportTicketPath(uuid));
    } else {
      ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(_store.error.value ?? 'Could not open a ticket')));
    }
  }

  Future<void> _liveChat() async {
    final opened = await _store.openLiveChat({
      'subject': _subject.text.trim().isEmpty ? 'Live chat' : _subject.text.trim(),
      'message': _body.text.trim(),
      ...?widget.contextData?.toJson(),
    });
    if (!mounted || opened == null) return;
    final conversation = opened['conversationUuid']?.toString();
    if (conversation != null) context.push('/chat/$conversation');
  }

  @override
  Widget build(BuildContext context) {
    final compact = context.isCompact;
    return AppScaffold(
      title: 'Help & Support',
      body: Column(
          children: [
            if (widget.contextData != null)
              Material(
                color: AppColors.charcoalSurface,
                child: ListTile(
                  leading: const Icon(Icons.link_outlined),
                  title: Text('This request includes ${widget.contextData!.entityType ?? widget.contextData!.marketplace ?? 'session'} context'),
                  subtitle: const Text('Agents will see the related listing, payment or conversation.'),
                ),
              ),
            TabBar(
              controller: _tabs,
              isScrollable: compact || _agent,
              tabs: [
                const Tab(text: 'Home'),
                const Tab(text: 'Knowledge'),
                const Tab(text: 'Tickets'),
                const Tab(text: 'Forum'),
                const Tab(text: 'AI'),
                if (_agent) const Tab(text: 'Queue'),
              ],
            ),
            Expanded(
              child: TabBarView(
                controller: _tabs,
                children: [
                  _HomeTab(store: _store, subject: _subject, body: _body, onSubmit: _submitTicket, onChat: _liveChat),
                  _KbTab(store: _store),
                  _TicketsTab(store: _store),
                  _ForumTab(store: _store),
                  const AiSupportScreen(embedded: true),
                  if (_agent) _QueueTab(store: _store),
                ],
              ),
            ),
          ],
        ),
    );
  }
}

class _HomeTab extends StatelessWidget {
  const _HomeTab({
    required this.store,
    required this.subject,
    required this.body,
    required this.onSubmit,
    required this.onChat,
  });

  final SupportStore store;
  final TextEditingController subject;
  final TextEditingController body;
  final VoidCallback onSubmit;
  final VoidCallback onChat;

  @override
  Widget build(BuildContext context) {
    return SignalBuilder(builder: (context) {
      final cats = store.catalog.value.dataOrNull;
      final departments = ((cats?['departments'] as List?) ?? const []).whereType<Map>();
      return ListView(
        padding: const EdgeInsets.all(16),
        children: [
          Text('One support platform', style: Theme.of(context).textTheme.titleLarge),
          const SizedBox(height: 8),
          const Text('Gold, Property, Vehicles, payments, KYC and accounts share the same tickets, agents and knowledge base.'),
          const SizedBox(height: 16),
          Wrap(
            spacing: 8,
            runSpacing: 8,
            children: [
              for (final row in departments.take(12))
                Chip(label: Text('${row['name']}')),
            ],
          ),
          const SizedBox(height: 16),
          TextField(controller: subject, decoration: const InputDecoration(labelText: 'Subject')),
          const SizedBox(height: 8),
          TextField(controller: body, minLines: 3, maxLines: 6, decoration: const InputDecoration(labelText: 'How can we help?')),
          const SizedBox(height: 12),
          Wrap(
            spacing: 8,
            runSpacing: 8,
            children: [
              FilledButton.icon(onPressed: store.busy.value ? null : onSubmit, icon: const Icon(Icons.confirmation_number_outlined), label: const Text('Open ticket')),
              OutlinedButton.icon(onPressed: onChat, icon: const Icon(Icons.chat_outlined), label: const Text('Live chat')),
              OutlinedButton.icon(onPressed: () => context.push(AppRoutes.aiSupport), icon: const Icon(Icons.smart_toy_outlined), label: const Text('AI assistant')),
            ],
          ),
          const SizedBox(height: 24),
          Text('FAQs', style: Theme.of(context).textTheme.titleMedium),
          for (final faq in store.faqs.value.dataOrNull ?? const [])
            ExpansionTile(title: Text('${faq['question']}'), children: [Padding(padding: const EdgeInsets.all(12), child: Text('${faq['answer']}'))]),
        ],
      );
    });
  }
}

class _KbTab extends StatelessWidget {
  const _KbTab({required this.store});
  final SupportStore store;

  @override
  Widget build(BuildContext context) {
    return SignalBuilder(builder: (context) {
      final state = store.articles.value;
      if (state.isLoading && state.dataOrNull == null) return const Center(child: CircularProgressIndicator());
      final items = state.dataOrNull ?? const [];
      return ListView.builder(
        padding: const EdgeInsets.all(8),
        itemCount: items.length + 1,
        itemBuilder: (context, index) {
          if (index == 0) {
            return Padding(
              padding: const EdgeInsets.all(8),
              child: TextField(
                decoration: const InputDecoration(prefixIcon: Icon(Icons.search), hintText: 'Search help articles'),
                onSubmitted: (q) => store.loadKb(q: q),
              ),
            );
          }
          final article = items[index - 1];
          return ListTile(
            title: Text(article.title),
            subtitle: Text(article.excerpt ?? article.categoryName ?? ''),
            onTap: () => context.push(AppRoutes.supportArticlePath(article.slug)),
          );
        },
      );
    });
  }
}

class _TicketsTab extends StatelessWidget {
  const _TicketsTab({required this.store});
  final SupportStore store;

  @override
  Widget build(BuildContext context) {
    return SignalBuilder(builder: (context) {
      final items = store.tickets.value.dataOrNull ?? const [];
      if (store.tickets.value.isLoading && items.isEmpty) return const Center(child: CircularProgressIndicator());
      if (items.isEmpty) return const Center(child: Text('No tickets yet. Open one from Home.'));
      return ListView.builder(
        itemCount: items.length,
        itemBuilder: (context, index) {
          final ticket = items[index];
          return ListTile(
            title: Text(ticket.subject),
            subtitle: Text('${ticket.ticketNumber} · ${ticket.status} · ${ticket.priority}'),
            onTap: () => context.push(AppRoutes.supportTicketPath(ticket.uuid)),
          );
        },
      );
    });
  }
}

class _ForumTab extends StatelessWidget {
  const _ForumTab({required this.store});
  final SupportStore store;

  @override
  Widget build(BuildContext context) {
    return SignalBuilder(builder: (context) {
      final items = store.forum.value.dataOrNull ?? const [];
      return ListView(
        children: [
          const Padding(
            padding: EdgeInsets.all(16),
            child: Text('Community discussion is not an official support ticket. Moderators review reports.'),
          ),
          for (final topic in items)
            ListTile(
              title: Text(topic.title),
              subtitle: Text('${topic.categoryName ?? ''} · ${topic.replyCount} replies'),
              onTap: () => context.push(AppRoutes.supportForumPath(topic.slug)),
            ),
        ],
      );
    });
  }
}

class _QueueTab extends StatelessWidget {
  const _QueueTab({required this.store});
  final SupportStore store;

  @override
  Widget build(BuildContext context) {
    return SignalBuilder(builder: (context) {
      final items = store.queue.value.dataOrNull ?? const [];
      return ListView(
        children: [
          ListTile(
            title: const Text('Agent queue'),
            subtitle: const Text('SLA-breached tickets sort first. Internal notes stay hidden from customers.'),
            trailing: TextButton(onPressed: store.loadAnalytics, child: const Text('Analytics')),
          ),
          if (store.analytics.value.dataOrNull != null)
            Padding(
              padding: const EdgeInsets.all(16),
              child: Text('${store.analytics.value.dataOrNull}'),
            ),
          for (final ticket in items)
            ListTile(
              title: Text(ticket.subject),
              subtitle: Text('${ticket.ticketNumber} · ${ticket.status} · ${ticket.department ?? ''}'),
              onTap: () => context.push(AppRoutes.supportTicketPath(ticket.uuid)),
            ),
        ],
      );
    });
  }
}

class SupportTicketScreen extends StatefulWidget {
  const SupportTicketScreen({super.key, required this.uuid});
  final String uuid;

  @override
  State<SupportTicketScreen> createState() => _SupportTicketScreenState();
}

class _SupportTicketScreenState extends State<SupportTicketScreen> {
  late final SupportStore _store;
  final _reply = TextEditingController();

  @override
  void initState() {
    super.initState();
    _store = ServiceLocator.instance.supportStore;
    WidgetsBinding.instance.addPostFrameCallback((_) => _store.loadTicket(widget.uuid));
  }

  @override
  void dispose() {
    _reply.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    return AppScaffold(
      title: 'Ticket',
      body: SignalBuilder(builder: (context) {
        final state = _store.ticketDetail.value;
        if (state.isLoading && state.dataOrNull == null) return const Center(child: CircularProgressIndicator());
        if (state.hasError && state.dataOrNull == null) return Center(child: Text(state.errorMessage ?? 'Not found'));
        final data = state.dataOrNull ?? const {};
        final messages = ((data['messages'] as List?) ?? const []).whereType<Map>();
        return Column(
          children: [
            ListTile(
              title: Text('${data['subject'] ?? ''}'),
              subtitle: Text('${data['ticketNumber'] ?? ''} · ${data['status'] ?? ''} · ${data['priority'] ?? ''}'),
            ),
            Expanded(
              child: ListView(
                padding: const EdgeInsets.all(16),
                children: [
                  for (final msg in messages)
                    Align(
                      alignment: msg['authorKind'] == 'customer' ? Alignment.centerRight : Alignment.centerLeft,
                      child: Card(
                        child: Padding(
                          padding: const EdgeInsets.all(12),
                          child: Text('${msg['body']}'),
                        ),
                      ),
                    ),
                  if (data['status'] == 'RESOLVED' || data['status'] == 'CLOSED')
                    FilledButton(
                      onPressed: () => _store.submitFeedback(widget.uuid),
                      child: const Text('Rate this resolution'),
                    ),
                ],
              ),
            ),
            Padding(
              padding: const EdgeInsets.all(8),
              child: Row(
                children: [
                  Expanded(child: TextField(controller: _reply, decoration: const InputDecoration(hintText: 'Reply'))),
                  IconButton(
                    icon: const Icon(Icons.send),
                    onPressed: () async {
                      final text = _reply.text.trim();
                      if (text.isEmpty) return;
                      _reply.clear();
                      await _store.reply(widget.uuid, text);
                    },
                  ),
                ],
              ),
            ),
          ],
        );
      }),
    );
  }
}

class SupportArticleScreen extends StatefulWidget {
  const SupportArticleScreen({super.key, required this.slug});
  final String slug;

  @override
  State<SupportArticleScreen> createState() => _SupportArticleScreenState();
}

class _SupportArticleScreenState extends State<SupportArticleScreen> {
  late final SupportStore _store;

  @override
  void initState() {
    super.initState();
    _store = ServiceLocator.instance.supportStore;
    WidgetsBinding.instance.addPostFrameCallback((_) => _store.loadArticle(widget.slug));
  }

  @override
  Widget build(BuildContext context) {
    return AppScaffold(
      title: 'Help article',
      body: SignalBuilder(builder: (context) {
        final data = _store.articleDetail.value.dataOrNull;
        if (data == null) return const Center(child: CircularProgressIndicator());
        return ListView(
          padding: const EdgeInsets.all(16),
          children: [
            Text('${data['title']}', style: Theme.of(context).textTheme.headlineSmall),
            const SizedBox(height: 12),
            Text('${data['body'] ?? ''}'),
          ],
        );
      }),
    );
  }
}

class SupportForumTopicScreen extends StatefulWidget {
  const SupportForumTopicScreen({super.key, required this.slug});
  final String slug;

  @override
  State<SupportForumTopicScreen> createState() => _SupportForumTopicScreenState();
}

class _SupportForumTopicScreenState extends State<SupportForumTopicScreen> {
  Map<String, dynamic>? _topic;

  @override
  void initState() {
    super.initState();
    WidgetsBinding.instance.addPostFrameCallback((_) async {
      final result = await ServiceLocator.instance.supportApi.forumTopic(widget.slug);
      result.when(
        success: (data) => setState(() => _topic = data),
        failure: (_, _) {},
      );
    });
  }

  @override
  Widget build(BuildContext context) {
    final topic = _topic;
    return AppScaffold(
      title: topic?['title']?.toString() ?? 'Topic',
      body: topic == null
          ? const Center(child: CircularProgressIndicator())
          : ListView(
              padding: const EdgeInsets.all(16),
              children: [
                Text('${topic['body'] ?? ''}'),
                const Divider(),
                for (final post in ((topic['posts'] as List?) ?? const []).whereType<Map>())
                  ListTile(title: Text('${post['authorName']}'), subtitle: Text('${post['body']}')),
              ],
            ),
    );
  }
}
