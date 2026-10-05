import 'dart:async';

import 'package:signals/signals.dart' hide AsyncState, AsyncLoading, AsyncData, AsyncError;

import '../../core/result/async_state.dart';
import '../../data/services/realtime_client.dart';
import 'data/support_api.dart';
import 'data/support_models.dart';

class SupportStore {
  SupportStore(this._api, [this._realtime]);

  final SupportApi _api;
  final RealtimeClient? _realtime;

  final catalog = signal<AsyncState<Map<String, dynamic>>>(const AsyncIdle());
  final articles = signal<AsyncState<List<KbArticleSummary>>>(const AsyncIdle());
  final faqs = signal<AsyncState<List<Map<String, dynamic>>>>(const AsyncIdle());
  final tickets = signal<AsyncState<List<SupportTicketSummary>>>(const AsyncIdle());
  final queue = signal<AsyncState<List<SupportTicketSummary>>>(const AsyncIdle());
  final forum = signal<AsyncState<List<ForumTopicSummary>>>(const AsyncIdle());
  final ticketDetail = signal<AsyncState<Map<String, dynamic>>>(const AsyncIdle());
  final articleDetail = signal<AsyncState<Map<String, dynamic>>>(const AsyncIdle());
  final analytics = signal<AsyncState<Map<String, dynamic>>>(const AsyncIdle());
  final busy = signal(false);
  final error = signal<String?>(null);
  StreamSubscription<RealtimeEvent>? _sub;

  void listen() {
    _sub?.cancel();
    _sub = _realtime?.events.listen((event) {
      if (event.name != 'ticket:updated') return;
      unawaited(loadTickets());
      unawaited(loadQueue());
      final uuid = event.map?['uuid']?.toString();
      if (uuid != null && ticketDetail.value.dataOrNull?['uuid'] == uuid) {
        unawaited(loadTicket(uuid));
      }
    });
  }

  Future<void> bootstrap({String? marketplace}) async {
    await Future.wait([
      loadCatalog(),
      loadKb(marketplace: marketplace),
      loadFaqs(marketplace: marketplace),
      loadTickets(),
      loadForum(),
    ]);
  }

  Future<void> loadCatalog() async {
    catalog.value = AsyncLoading(previous: catalog.value.dataOrNull);
    (await _api.catalog()).when(
      success: (data) => catalog.value = AsyncData(data),
      failure: (m, c) => catalog.value = AsyncError(m, code: c),
    );
  }

  Future<void> loadKb({String? q, String? marketplace}) async {
    articles.value = AsyncLoading(previous: articles.value.dataOrNull);
    (await _api.searchKb(q: q, marketplace: marketplace)).when(
      success: (data) => articles.value = AsyncData(data),
      failure: (m, c) => articles.value = AsyncError(m, code: c),
    );
  }

  Future<void> loadFaqs({String? marketplace}) async {
    faqs.value = AsyncLoading(previous: faqs.value.dataOrNull);
    (await _api.faqs(marketplace: marketplace)).when(
      success: (data) => faqs.value = AsyncData(data),
      failure: (m, c) => faqs.value = AsyncError(m, code: c),
    );
  }

  Future<void> loadTickets() async {
    tickets.value = AsyncLoading(previous: tickets.value.dataOrNull);
    (await _api.tickets()).when(
      success: (data) => tickets.value = AsyncData(data),
      failure: (m, c) => tickets.value = AsyncError(m, code: c),
    );
  }

  Future<void> loadQueue() async {
    queue.value = AsyncLoading(previous: queue.value.dataOrNull);
    (await _api.agentQueue()).when(
      success: (data) => queue.value = AsyncData(data),
      failure: (m, c) => queue.value = AsyncError(m, code: c),
    );
  }

  Future<void> loadForum() async {
    forum.value = AsyncLoading(previous: forum.value.dataOrNull);
    (await _api.forumTopics()).when(
      success: (data) => forum.value = AsyncData(data),
      failure: (m, c) => forum.value = AsyncError(m, code: c),
    );
  }

  Future<void> loadTicket(String uuid) async {
    ticketDetail.value = AsyncLoading(previous: ticketDetail.value.dataOrNull);
    (await _api.ticket(uuid)).when(
      success: (data) => ticketDetail.value = AsyncData(data),
      failure: (m, c) => ticketDetail.value = AsyncError(m, code: c),
    );
  }

  Future<void> loadArticle(String slug) async {
    articleDetail.value = AsyncLoading(previous: articleDetail.value.dataOrNull);
    (await _api.article(slug)).when(
      success: (data) => articleDetail.value = AsyncData(data),
      failure: (m, c) => articleDetail.value = AsyncError(m, code: c),
    );
  }

  Future<void> loadAnalytics() async {
    analytics.value = AsyncLoading(previous: analytics.value.dataOrNull);
    (await _api.analytics()).when(
      success: (data) => analytics.value = AsyncData(data),
      failure: (m, c) => analytics.value = AsyncError(m, code: c),
    );
  }

  Future<String?> createTicket(Map<String, dynamic> body) async {
    busy.value = true;
    error.value = null;
    final result = await _api.createTicket(body);
    busy.value = false;
    return result.when(
      success: (data) {
        unawaited(loadTickets());
        return data['uuid']?.toString();
      },
      failure: (m, _) {
        error.value = m;
        return null;
      },
    );
  }

  Future<bool> reply(String uuid, String text) async {
    busy.value = true;
    final result = await _api.reply(uuid, text);
    busy.value = false;
    return result.when(
      success: (data) {
        ticketDetail.value = AsyncData(data);
        return true;
      },
      failure: (m, _) {
        error.value = m;
        return false;
      },
    );
  }

  Future<Map<String, dynamic>?> openLiveChat(Map<String, dynamic> body) async {
    final result = await _api.openLiveChat(body);
    return result.when(success: (data) => data, failure: (m, _) {
      error.value = m;
      return null;
    });
  }

  Future<void> submitFeedback(String uuid, {int rating = 5, String? comment}) async {
    error.value = null;
    final result = await _api.feedback(uuid, rating: rating, comment: comment);
    result.when(
      success: (_) {},
      failure: (m, _) => error.value = m,
    );
  }

  void dispose() {
    _sub?.cancel();
  }
}
