import 'listing_model.dart';

class AiMeta {
  const AiMeta({
    required this.jobUuid,
    required this.task,
    required this.provider,
    required this.model,
    required this.confidence,
    required this.band,
    required this.cacheHit,
    this.latencyMs,
    this.explanation,
  });

  factory AiMeta.fromJson(Map<String, dynamic>? json) {
    if (json == null) {
      return const AiMeta(
        jobUuid: '',
        task: '',
        provider: '',
        model: '',
        confidence: 0,
        band: 'low',
        cacheHit: false,
      );
    }
    return AiMeta(
      jobUuid: (json['jobUuid'] ?? '').toString(),
      task: (json['task'] ?? '').toString(),
      provider: (json['provider'] ?? '').toString(),
      model: (json['model'] ?? '').toString(),
      confidence: (json['confidence'] as num?)?.toDouble() ?? 0,
      band: (json['band'] ?? 'low').toString(),
      cacheHit: json['cacheHit'] == true,
      latencyMs: (json['latencyMs'] as num?)?.toInt(),
      explanation: json['explanation']?.toString(),
    );
  }

  final String jobUuid;
  final String task;
  final String provider;
  final String model;
  final double confidence;
  final String band;
  final bool cacheHit;
  final int? latencyMs;
  final String? explanation;

  bool get isLow => band == 'low';
}

class AiDescription {
  const AiDescription({
    required this.description,
    this.title,
    this.highlights = const [],
    this.disclaimer,
    this.meta,
  });

  factory AiDescription.fromJson(Map<String, dynamic> json) {
    return AiDescription(
      description: (json['description'] ?? '').toString(),
      title: json['title']?.toString(),
      highlights: (json['highlights'] as List? ?? []).map((e) => e.toString()).toList(),
      disclaimer: json['disclaimer']?.toString(),
      meta: json['meta'] is Map
          ? AiMeta.fromJson(Map<String, dynamic>.from(json['meta'] as Map))
          : null,
    );
  }

  final String description;
  final String? title;
  final List<String> highlights;
  final String? disclaimer;
  final AiMeta? meta;
}

class AiJob {
  const AiJob({
    required this.uuid,
    required this.task,
    required this.status,
    this.result,
    this.error,
    this.meta,
    this.confidence,
  });

  factory AiJob.fromJson(Map<String, dynamic> json) {
    return AiJob(
      uuid: (json['uuid'] ?? json['jobUuid'] ?? '').toString(),
      task: (json['task'] ?? '').toString(),
      status: (json['status'] ?? '').toString(),
      result: json['result'],
      error: json['error']?.toString(),
      confidence: (json['confidence'] as num?)?.toDouble(),
      meta: json['meta'] is Map
          ? AiMeta.fromJson(Map<String, dynamic>.from(json['meta'] as Map))
          : null,
    );
  }

  final String uuid;
  final String task;
  final String status;
  final Object? result;
  final String? error;
  final AiMeta? meta;
  final double? confidence;

  bool get isQueued => status == 'queued' || status == 'running' || status == 'processing';
  bool get isDone => status == 'succeeded';
  bool get isFailed => status == 'failed' || status == 'cancelled';
}

class AiSupportTurn {
  const AiSupportTurn({
    required this.sessionUuid,
    required this.reply,
    this.citations = const [],
    this.shouldEscalate = false,
    this.ticketUuid,
    this.meta,
  });

  factory AiSupportTurn.fromJson(Map<String, dynamic> json) {
    return AiSupportTurn(
      sessionUuid: (json['sessionUuid'] ?? '').toString(),
      reply: (json['reply'] ?? '').toString(),
      citations: (json['citations'] as List? ?? []).map((e) => e.toString()).toList(),
      shouldEscalate: json['shouldEscalate'] == true,
      ticketUuid: json['ticketUuid']?.toString(),
      meta: json['meta'] is Map
          ? AiMeta.fromJson(Map<String, dynamic>.from(json['meta'] as Map))
          : null,
    );
  }

  final String sessionUuid;
  final String reply;
  final List<String> citations;
  final bool shouldEscalate;
  final String? ticketUuid;
  final AiMeta? meta;
}

class AiRecommendations {
  const AiRecommendations({
    required this.listingIds,
    required this.strategy,
    this.explanation,
    this.cards = const [],
  });

  factory AiRecommendations.fromJson(Map<String, dynamic> json) {
    final cardsRaw = json['cards'];
    return AiRecommendations(
      listingIds: (json['listingIds'] as List? ?? [])
          .map((e) => (e as num).toInt())
          .toList(),
      strategy: (json['strategy'] ?? 'trending').toString(),
      explanation: json['explanation']?.toString(),
      cards: cardsRaw is List
          ? cardsRaw
              .whereType<Map>()
              .map((e) => ListingModel.fromJson(Map<String, dynamic>.from(e)))
              .toList()
          : const [],
    );
  }

  final List<int> listingIds;
  final String strategy;
  final String? explanation;
  final List<ListingModel> cards;
}

class AiQueuedJob {
  const AiQueuedJob({required this.jobUuid, required this.status});

  factory AiQueuedJob.fromJson(Map<String, dynamic> json) {
    return AiQueuedJob(
      jobUuid: (json['jobUuid'] ?? json['uuid'] ?? '').toString(),
      status: (json['status'] ?? 'queued').toString(),
    );
  }

  final String jobUuid;
  final String status;
}
