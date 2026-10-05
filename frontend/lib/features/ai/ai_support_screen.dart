import 'package:flutter/material.dart';
import 'package:signals_flutter/signals_flutter.dart'
    hide AsyncState, AsyncLoading, AsyncData, AsyncError;

import '../../app/theme/app_colors.dart';
import '../../core/di/service_locator.dart';
import '../../shared/widgets/app_scaffold.dart';
import 'ai_store.dart';

class AiSupportScreen extends StatefulWidget {
  const AiSupportScreen({super.key, this.embedded = false});

  final bool embedded;

  @override
  State<AiSupportScreen> createState() => _AiSupportScreenState();
}

class _AiSupportScreenState extends State<AiSupportScreen> {
  late final AiSupportStore _store;
  final _controller = TextEditingController();

  @override
  void initState() {
    super.initState();
    final sl = ServiceLocator.instance;
    _store = AiSupportStore(sl.aiRepository, sl.realtimeClient);
    _store.listen();
  }

  @override
  void dispose() {
    _controller.dispose();
    _store.dispose();
    super.dispose();
  }

  bool get _canUseSupport {
    final entitlements =
        ServiceLocator.instance.subscriptionStore.snapshot.value.dataOrNull?.entitlements;
    return entitlements?.has('ai_support') == true || entitlements?.has('ai_tools') == true;
  }

  Future<void> _send() async {
    final text = _controller.text;
    _controller.clear();
    await _store.send(text);
  }

  @override
  Widget build(BuildContext context) {
    final allowed = _canUseSupport;
    final body = Column(
        children: [
          Padding(
            padding: const EdgeInsets.fromLTRB(16, 12, 16, 0),
            child: Text(
              'Answers use approved tools only. Sensitive actions need your confirmation. This is not a live human agent until a ticket is opened.',
              style: Theme.of(context).textTheme.bodySmall,
            ),
          ),
          Expanded(
            child: SignalBuilder(builder: (context) {
              final items = _store.messages.value;
              if (!allowed) {
                return const Center(
                  child: Padding(
                    padding: EdgeInsets.all(24),
                    child: Text('AI support is not on your current plan.'),
                  ),
                );
              }
              if (items.isEmpty) {
                return const Center(
                  child: Text('Ask about an order, listing, or subscription.'),
                );
              }
              return ListView.builder(
                padding: const EdgeInsets.all(16),
                itemCount: items.length,
                itemBuilder: (context, index) {
                  final item = items[index];
                  return Align(
                    alignment: item.mine
                        ? AlignmentDirectional.centerEnd
                        : AlignmentDirectional.centerStart,
                    child: Container(
                      margin: const EdgeInsets.only(bottom: 8),
                      padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 8),
                      constraints: const BoxConstraints(maxWidth: 520),
                      decoration: BoxDecoration(
                        color: item.mine
                            ? AppColors.gold.withValues(alpha: 0.2)
                            : Theme.of(context).colorScheme.surfaceContainerHighest,
                        borderRadius: BorderRadius.circular(12),
                      ),
                      child: Text(item.text),
                    ),
                  );
                },
              );
            }),
          ),
          SignalBuilder(builder: (context) {
            if (_store.error.value == null) return const SizedBox.shrink();
            return Padding(
              padding: const EdgeInsets.symmetric(horizontal: 16),
              child: Text(_store.error.value!, style: TextStyle(color: Theme.of(context).colorScheme.error)),
            );
          }),
          SafeArea(
            child: Padding(
              padding: const EdgeInsets.all(12),
              child: Row(
                children: [
                  Expanded(
                    child: TextField(
                      controller: _controller,
                      enabled: allowed,
                      minLines: 1,
                      maxLines: 4,
                      decoration: const InputDecoration(
                        hintText: 'How can we help?',
                        border: OutlineInputBorder(),
                      ),
                      onSubmitted: allowed ? (_) => _send() : null,
                    ),
                  ),
                  const SizedBox(width: 8),
                  SignalBuilder(builder: (context) {
                    return IconButton.filled(
                      onPressed: !allowed || _store.sending.value ? null : _send,
                      icon: _store.sending.value
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
    if (widget.embedded) return body;
    return AppScaffold(
      title: 'AI support',
      body: body,
    );
  }
}
