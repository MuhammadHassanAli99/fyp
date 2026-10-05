import 'package:signals/signals.dart' hide AsyncState, AsyncLoading, AsyncData, AsyncError;

import '../../../core/result/async_state.dart';
import '../../../core/result/result.dart';
import 'data/admin_api.dart';
import 'data/admin_models.dart';

class AdminStore {
  AdminStore(this._api);

  final AdminApi _api;

  final session = signal<AsyncState<AdminSession>>(const AsyncIdle());
  final summary = signal<AsyncState<Map<String, dynamic>>>(const AsyncIdle());
  final page = signal<AsyncState<AdminPage>>(const AsyncIdle());
  final detail = signal<AsyncState<Map<String, dynamic>>>(const AsyncIdle());
  final query = signal('');
  final module = signal('dashboard');
  final busy = signal(false);
  String? lastError;

  AdminSession? get sessionOrNull => session.value.dataOrNull;

  List<AdminModuleDef> modulesFor({required bool compact}) {
    final allowed = sessionOrNull?.modules ?? const <String>[];
    return adminCatalog.where((item) {
      if (allowed.isNotEmpty && !allowed.contains(item.id) && item.id != 'dashboard') {
        return false;
      }
      if (compact) return item.mobile;
      return true;
    }).toList();
  }

  Future<void> bootstrap() async {
    session.value = AsyncLoading(previous: session.value.dataOrNull);
    final result = await _api.session();
    result.when(
      success: (data) {
        session.value = AsyncData(data);
        if (data.modules.isNotEmpty && !data.modules.contains(module.value)) {
          module.value = data.modules.first;
        }
      },
      failure: (message, code) => session.value = AsyncError(message, code: code),
    );
    await loadModule(module.value);
  }

  Future<void> loadModule(String id) async {
    module.value = id;
    lastError = null;
    switch (id) {
      case 'dashboard':
        await _loadSummary();
        return;
      case 'system_health':
        detail.value = AsyncLoading(previous: detail.value.dataOrNull);
        (await _api.health()).when(
          success: (data) => detail.value = AsyncData(data),
          failure: (m, c) => detail.value = AsyncError(m, code: c),
        );
        return;
      case 'fraud':
        detail.value = AsyncLoading(previous: detail.value.dataOrNull);
        (await _api.fraud()).when(
          success: (data) => detail.value = AsyncData(data),
          failure: (m, c) => detail.value = AsyncError(m, code: c),
        );
        return;
      case 'security':
        detail.value = AsyncLoading(previous: detail.value.dataOrNull);
        (await _api.security()).when(
          success: (data) => detail.value = AsyncData(data),
          failure: (m, c) => detail.value = AsyncError(m, code: c),
        );
        return;
      case 'kyc':
        detail.value = AsyncLoading(previous: detail.value.dataOrNull);
        (await _api.kyc()).when(
          success: (data) => detail.value = AsyncData({'items': data is List ? data : data['items'] ?? data}),
          failure: (m, c) => detail.value = AsyncError(m, code: c),
        );
        return;
      case 'moderation':
        detail.value = AsyncLoading(previous: detail.value.dataOrNull);
        (await _api.moderation()).when(
          success: (data) => detail.value = AsyncData(data),
          failure: (m, c) => detail.value = AsyncError(m, code: c),
        );
        return;
      case 'analytics':
        return;
      case 'approvals':
      case 'roles':
      case 'countries':
      case 'languages':
      case 'currencies':
      case 'categories':
        await _loadList(_pathFor(id));
        return;
      default:
        await _loadList(_pathFor(id));
    }
  }

  String _pathFor(String id) {
    return switch (id) {
      'users' => '/admin/users',
      'companies' => '/admin/companies',
      'employees' => '/admin/employees',
      'listings' => '/admin/listings',
      'subscriptions' => '/admin/subscriptions',
      'payments' => '/admin/payments',
      'refunds' => '/admin/refunds',
      'invoices' => '/admin/invoices',
      'support' => '/admin/support',
      'audit' => '/admin/audit',
      'cms' => '/admin/cms/pages',
      'sales' => '/admin/sales/leads',
      'reports' => '/admin/reports',
      'privacy' => '/admin/privacy',
      'notifications' => '/admin/cms/banners',
      'approvals' => '/admin/approvals',
      'roles' => '/admin/roles',
      'countries' => '/admin/countries',
      'languages' => '/admin/languages',
      'currencies' => '/admin/currencies',
      'categories' => '/admin/categories',
      _ => '/admin/users',
    };
  }

  Future<void> _loadSummary() async {
    summary.value = AsyncLoading(previous: summary.value.dataOrNull);
    (await _api.summary()).when(
      success: (data) => summary.value = AsyncData(data),
      failure: (m, c) => summary.value = AsyncError(m, code: c),
    );
  }

  Future<void> _loadList(String path) async {
    page.value = AsyncLoading(previous: page.value.dataOrNull);
    (await _api.list(path, q: query.value)).when(
      success: (data) => page.value = AsyncData(data),
      failure: (m, c) => page.value = AsyncError(m, code: c),
    );
  }

  Future<Result<Map<String, dynamic>>> act(String path, Map<String, dynamic> body) async {
    busy.value = true;
    final result = await _api.post(path, data: body);
    busy.value = false;
    result.when(
      success: (_) => loadModule(module.value),
      failure: (m, _) => lastError = m,
    );
    return result;
  }
}
