import 'package:flutter/material.dart';
import 'package:go_router/go_router.dart';

import '../../app/localization/app_localizations_wrapper.dart';
import '../../core/di/service_locator.dart';
import '../../shared/widgets/app_scaffold.dart';

class LegalDocumentsScreen extends StatefulWidget {
  const LegalDocumentsScreen({super.key, this.kind});

  final String? kind;

  @override
  State<LegalDocumentsScreen> createState() => _LegalDocumentsScreenState();
}

class _LegalDocumentsScreenState extends State<LegalDocumentsScreen> {
  List<Map<String, dynamic>> _docs = const [];
  Map<String, dynamic>? _current;
  bool _loading = true;
  String? _error;
  bool _accepting = false;

  @override
  void initState() {
    super.initState();
    _load();
  }

  Future<void> _load() async {
    setState(() {
      _loading = true;
      _error = null;
    });
    try {
      final api = ServiceLocator.instance.localeApi;
      if (widget.kind != null) {
        _current = await api.legalDocument(widget.kind!);
      } else {
        _docs = await api.legalDocuments();
      }
    } catch (e) {
      _error = e.toString();
    } finally {
      if (mounted) setState(() => _loading = false);
    }
  }

  Future<void> _accept(String kind) async {
    setState(() => _accepting = true);
    try {
      await ServiceLocator.instance.localeApi.acceptLegal(kind);
      if (!mounted) return;
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(content: Text(context.l10n.legalAccepted)),
      );
    } catch (e) {
      if (!mounted) return;
      ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text('$e')));
    } finally {
      if (mounted) setState(() => _accepting = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final l10n = context.l10n;
    return AppScaffold(
      title: _current?['title']?.toString() ?? l10n.legalDocuments,
      body: _loading
          ? const LoadingView()
          : _error != null
              ? EmptyState(
                  title: _error!,
                  action: FilledButton(onPressed: _load, child: Text(l10n.retry)),
                )
              : _current != null
                  ? ListView(
                      padding: const EdgeInsets.all(16),
                      children: [
                        Text(
                          '${_current!['displayName'] ?? ''} · v${_current!['version'] ?? ''}',
                          style: Theme.of(context).textTheme.labelLarge,
                        ),
                        const SizedBox(height: 12),
                        Text(_current!['body']?.toString() ?? ''),
                        const SizedBox(height: 24),
                        FilledButton(
                          onPressed: _accepting
                              ? null
                              : () => _accept(widget.kind ?? 'terms'),
                          child: Text(l10n.acceptLegal),
                        ),
                      ],
                    )
                  : ListView(
                      children: [
                        for (final doc in _docs)
                          ListTile(
                            title: Text((doc['title'] ?? doc['displayName'] ?? '').toString()),
                            subtitle: Text(
                              '${doc['kind']} · v${doc['version'] ?? ''} · ${doc['language'] ?? ''}',
                            ),
                            trailing: const Icon(Icons.chevron_right),
                            onTap: () => context.push('/legal/${doc['kind']}'),
                          ),
                      ],
                    ),
    );
  }
}
