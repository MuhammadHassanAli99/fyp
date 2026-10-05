class ChatAttachment {
  const ChatAttachment({
    required this.id,
    required this.kind,
    this.url,
    this.thumbUrl,
    this.fileName,
    this.mimeType,
    this.sizeBytes,
    this.width,
    this.height,
    this.durationMs,
    this.waveform,
    this.codec,
    this.uploadStatus = 'ready',
  });

  factory ChatAttachment.fromJson(Map<String, dynamic> json) => ChatAttachment(
        id: (json['id'] as num?)?.toInt() ?? 0,
        kind: json['kind'] as String? ?? 'other',
        url: json['url'] as String?,
        thumbUrl: json['thumbUrl'] as String?,
        fileName: json['fileName'] as String?,
        mimeType: json['mimeType'] as String?,
        sizeBytes: (json['sizeBytes'] as num?)?.toInt(),
        width: (json['width'] as num?)?.toInt(),
        height: (json['height'] as num?)?.toInt(),
        durationMs: (json['durationMs'] as num?)?.toInt(),
        waveform: (json['waveform'] as List?)
            ?.map((e) => (e as num).toDouble())
            .toList(),
        codec: json['codec'] as String?,
        uploadStatus: json['uploadStatus'] as String? ?? 'ready',
      );

  final int id;
  final String kind;
  final String? url;
  final String? thumbUrl;
  final String? fileName;
  final String? mimeType;
  final int? sizeBytes;
  final int? width;
  final int? height;
  final int? durationMs;
  final List<double>? waveform;
  final String? codec;
  final String uploadStatus;

  Map<String, dynamic> toAttachmentPayload() => {
        'kind': kind,
        if (url != null) 'url': url,
        if (thumbUrl != null) 'thumbUrl': thumbUrl,
        if (fileName != null) 'fileName': fileName,
        if (mimeType != null) 'mimeType': mimeType,
        if (sizeBytes != null) 'sizeBytes': sizeBytes,
        if (width != null) 'width': width,
        if (height != null) 'height': height,
        if (durationMs != null) 'durationMs': durationMs,
        if (waveform != null) 'waveform': waveform,
        if (codec != null) 'codec': codec,
      };
}

class ChatLocation {
  const ChatLocation({
    required this.latitude,
    required this.longitude,
    this.accuracy,
    this.timestamp,
    this.label,
    this.source,
  });

  factory ChatLocation.fromJson(Map<String, dynamic>? json) {
    if (json == null) return const ChatLocation(latitude: 0, longitude: 0);
    return ChatLocation(
      latitude: (json['latitude'] as num?)?.toDouble() ?? 0,
      longitude: (json['longitude'] as num?)?.toDouble() ?? 0,
      accuracy: (json['accuracy'] as num?)?.toDouble(),
      timestamp: json['timestamp'] as String?,
      label: json['label'] as String?,
      source: json['source'] as String?,
    );
  }

  final double latitude;
  final double longitude;
  final double? accuracy;
  final String? timestamp;
  final String? label;
  final String? source;

  Map<String, dynamic> toJson() => {
        'latitude': latitude,
        'longitude': longitude,
        if (accuracy != null) 'accuracy': accuracy,
        if (timestamp != null) 'timestamp': timestamp,
        if (label != null) 'label': label,
        if (source != null) 'source': source,
      };
}

class ChatReplyPreview {
  const ChatReplyPreview({
    required this.id,
    required this.uuid,
    this.body,
    this.senderId,
  });

  factory ChatReplyPreview.fromJson(Map<String, dynamic>? json) {
    if (json == null) {
      return const ChatReplyPreview(id: 0, uuid: '');
    }
    return ChatReplyPreview(
      id: (json['id'] as num?)?.toInt() ?? 0,
      uuid: json['uuid'] as String? ?? '',
      body: json['body'] as String?,
      senderId: (json['senderId'] as num?)?.toInt(),
    );
  }

  final int id;
  final String uuid;
  final String? body;
  final int? senderId;
}

class ChatMessage {
  const ChatMessage({
    required this.id,
    required this.uuid,
    required this.kind,
    required this.status,
    required this.createdAt,
    this.conversationId,
    this.senderId,
    this.body,
    this.isEdited = false,
    this.editedAt,
    this.deleted = false,
    this.deletionType = 'none',
    this.attachments = const [],
    this.location,
    this.replyTo,
    this.clientMessageId,
    this.localStatus,
    this.translatedBody,
    this.showTranslation = false,
  });

  factory ChatMessage.fromJson(Map<String, dynamic> json) => ChatMessage(
        id: (json['id'] as num?)?.toInt() ?? 0,
        uuid: json['uuid'] as String? ?? '',
        conversationId: (json['conversationId'] as num?)?.toInt(),
        senderId: (json['senderId'] as num?)?.toInt(),
        kind: json['kind'] as String? ?? 'text',
        body: json['body'] as String?,
        isEdited: json['isEdited'] as bool? ?? false,
        editedAt: json['editedAt'] != null
            ? DateTime.tryParse(json['editedAt'] as String)
            : null,
        deleted: json['deleted'] as bool? ?? false,
        deletionType: json['deletionType'] as String? ?? 'none',
        status: json['status'] as String? ?? 'sent',
        createdAt: DateTime.tryParse(json['createdAt'] as String? ?? '') ??
            DateTime.now(),
        attachments: (json['attachments'] as List? ?? [])
            .whereType<Map>()
            .map((e) => ChatAttachment.fromJson(Map<String, dynamic>.from(e)))
            .toList(),
        location: json['location'] is Map
            ? ChatLocation.fromJson(Map<String, dynamic>.from(json['location'] as Map))
            : null,
        replyTo: json['replyTo'] is Map
            ? ChatReplyPreview.fromJson(Map<String, dynamic>.from(json['replyTo'] as Map))
            : null,
        clientMessageId: json['clientMessageId'] as String?,
      );

  final int id;
  final String uuid;
  final int? conversationId;
  final int? senderId;
  final String kind;
  final String? body;
  final bool isEdited;
  final DateTime? editedAt;
  final bool deleted;
  final String deletionType;
  final String status;
  final DateTime createdAt;
  final List<ChatAttachment> attachments;
  final ChatLocation? location;
  final ChatReplyPreview? replyTo;
  final String? clientMessageId;
  final String? localStatus;
  final String? translatedBody;
  final bool showTranslation;

  ChatMessage copyWith({
    String? body,
    bool? isEdited,
    bool? deleted,
    String? status,
    String? translatedBody,
    bool? showTranslation,
    String? localStatus,
  }) =>
      ChatMessage(
        id: id,
        uuid: uuid,
        conversationId: conversationId,
        senderId: senderId,
        kind: kind,
        body: body ?? this.body,
        isEdited: isEdited ?? this.isEdited,
        editedAt: editedAt,
        deleted: deleted ?? this.deleted,
        deletionType: deletionType,
        status: status ?? this.status,
        createdAt: createdAt,
        attachments: attachments,
        location: location,
        replyTo: replyTo,
        clientMessageId: clientMessageId,
        localStatus: localStatus ?? this.localStatus,
        translatedBody: translatedBody ?? this.translatedBody,
        showTranslation: showTranslation ?? this.showTranslation,
      );
}

class PresenceSnapshot {
  const PresenceSnapshot({
    required this.status,
    this.lastSeenAt,
    this.visible = true,
  });

  factory PresenceSnapshot.fromJson(Map<String, dynamic>? json) {
    if (json == null) {
      return const PresenceSnapshot(status: 'offline');
    }
    return PresenceSnapshot(
      status: json['status'] as String? ?? 'offline',
      lastSeenAt: json['lastSeenAt'] != null
          ? DateTime.tryParse(json['lastSeenAt'] as String)
          : null,
      visible: json['visible'] as bool? ?? true,
    );
  }

  final String status;
  final DateTime? lastSeenAt;
  final bool visible;

  bool get isOnline => status == 'online';
  bool get isAway => status == 'away';
}

class ConversationModel {
  const ConversationModel({
    required this.id,
    required this.uuid,
    required this.kind,
    required this.status,
    this.conversationType = 'buyer_seller',
    this.subject,
    this.marketplaceCode,
    this.listingId,
    this.listingUuid,
    this.listingTitle,
    this.listingLocation,
    this.lastMessageAt,
    this.lastMessagePreview,
    this.messageCount = 0,
    this.unreadCount = 0,
    this.lastReadMessageId,
    this.isPinned = false,
    this.isMuted = false,
    this.isArchived = false,
    this.peerId,
    this.peerName,
    this.peerAvatar,
    this.peerPresence,
  });

  factory ConversationModel.fromJson(Map<String, dynamic> json) =>
      ConversationModel(
        id: (json['id'] as num?)?.toInt() ?? 0,
        uuid: json['uuid'] as String? ?? '',
        kind: json['kind'] as String? ?? 'listing',
        conversationType: json['conversationType'] as String? ?? 'buyer_seller',
        subject: json['subject'] as String?,
        marketplaceCode: json['marketplaceCode'] as String?,
        listingId: (json['listingId'] as num?)?.toInt(),
        listingUuid: json['listingUuid'] as String?,
        listingTitle: json['listingTitle'] as String?,
        listingLocation: json['listingLocation'] is Map
            ? ChatLocation.fromJson(
                Map<String, dynamic>.from(json['listingLocation'] as Map),
              )
            : null,
        lastMessageAt: json['lastMessageAt'] != null
            ? DateTime.tryParse(json['lastMessageAt'] as String)
            : null,
        lastMessagePreview: json['lastMessagePreview'] as String?,
        messageCount: (json['messageCount'] as num?)?.toInt() ?? 0,
        status: json['status'] as String? ?? 'active',
        unreadCount: (json['unreadCount'] as num?)?.toInt() ?? 0,
        lastReadMessageId: (json['lastReadMessageId'] as num?)?.toInt(),
        isPinned: json['isPinned'] as bool? ?? false,
        isMuted: json['isMuted'] as bool? ?? false,
        isArchived: json['isArchived'] as bool? ?? false,
        peerId: (json['peerId'] as num?)?.toInt(),
        peerName: json['peerName'] as String?,
        peerAvatar: json['peerAvatar'] as String?,
        peerPresence: PresenceSnapshot.fromJson(
          json['peerPresence'] is Map
              ? Map<String, dynamic>.from(json['peerPresence'] as Map)
              : null,
        ),
      );

  final int id;
  final String uuid;
  final String kind;
  final String conversationType;
  final String? subject;
  final String? marketplaceCode;
  final int? listingId;
  final String? listingUuid;
  final String? listingTitle;
  final ChatLocation? listingLocation;
  final DateTime? lastMessageAt;
  final String? lastMessagePreview;
  final int messageCount;
  final String status;
  final int unreadCount;
  final int? lastReadMessageId;
  final bool isPinned;
  final bool isMuted;
  final bool isArchived;
  final int? peerId;
  final String? peerName;
  final String? peerAvatar;
  final PresenceSnapshot? peerPresence;

  String get title =>
      peerName?.isNotEmpty == true
          ? peerName!
          : (listingTitle?.isNotEmpty == true ? listingTitle! : 'Conversation');
}

class IceServer {
  const IceServer({required this.urls, this.username, this.credential});

  factory IceServer.fromJson(Map<String, dynamic> json) => IceServer(
        urls: (json['urls'] as List? ?? const [])
            .map((e) => e.toString())
            .toList(),
        username: json['username'] as String?,
        credential: json['credential'] as String?,
      );

  final List<String> urls;
  final String? username;
  final String? credential;
}

class CallSession {
  const CallSession({
    required this.uuid,
    required this.callerId,
    required this.calleeId,
    required this.kind,
    required this.status,
    this.conversationId,
    this.listingId,
    this.historyStatus,
    this.startedAt,
    this.answeredAt,
    this.endedAt,
    this.durationSecs = 0,
    this.iceServers = const [],
  });

  factory CallSession.fromJson(Map<String, dynamic> json) {
    return CallSession(
      uuid: json['uuid'] as String? ?? '',
      conversationId: (json['conversationId'] as num?)?.toInt(),
      listingId: (json['listingId'] as num?)?.toInt(),
      callerId: (json['callerId'] as num?)?.toInt() ?? 0,
      calleeId: (json['calleeId'] as num?)?.toInt() ?? 0,
      kind: json['kind'] as String? ?? 'voice',
      status: json['status'] as String? ?? 'ringing',
      historyStatus: json['historyStatus'] as String?,
      startedAt: json['startedAt'] != null
          ? DateTime.tryParse(json['startedAt'] as String)
          : null,
      answeredAt: json['answeredAt'] != null
          ? DateTime.tryParse(json['answeredAt'] as String)
          : null,
      endedAt: json['endedAt'] != null
          ? DateTime.tryParse(json['endedAt'] as String)
          : null,
      durationSecs: (json['durationSecs'] as num?)?.toInt() ?? 0,
      iceServers: (json['iceServers'] as List? ?? const [])
          .whereType<Map>()
          .map((e) => IceServer.fromJson(Map<String, dynamic>.from(e)))
          .toList(),
    );
  }

  final String uuid;
  final int? conversationId;
  final int? listingId;
  final int callerId;
  final int calleeId;
  final String kind;
  final String status;
  final String? historyStatus;
  final DateTime? startedAt;
  final DateTime? answeredAt;
  final DateTime? endedAt;
  final int durationSecs;
  final List<IceServer> iceServers;

  bool get isVideo => kind == 'video';
  bool get isTerminal => const {
        'rejected',
        'busy',
        'cancelled',
        'failed',
        'ended',
        'missed',
        'timeout',
      }.contains(status);
}

class MaskedCallSession {
  const MaskedCallSession({
    required this.uuid,
    this.listingId,
    required this.status,
    this.expiresAt,
  });

  factory MaskedCallSession.fromJson(Map<String, dynamic> json) =>
      MaskedCallSession(
        uuid: json['uuid'] as String? ?? '',
        listingId: (json['listingId'] as num?)?.toInt(),
        status: json['status'] as String? ?? 'allocated',
        expiresAt: json['expiresAt'] != null
            ? DateTime.tryParse(json['expiresAt'] as String)
            : null,
      );

  final String uuid;
  final int? listingId;
  final String status;
  final DateTime? expiresAt;
}

class TranslationResult {
  const TranslationResult({
    required this.original,
    required this.translated,
    this.sourceLanguage,
    this.targetLanguage,
    this.confidence,
    this.unavailable = false,
  });

  factory TranslationResult.fromJson(Map<String, dynamic> json) =>
      TranslationResult(
        original: json['original'] as String? ?? '',
        translated: json['translated'] as String? ?? '',
        sourceLanguage: json['sourceLanguage'] as String?,
        targetLanguage: json['targetLanguage'] as String?,
        confidence: (json['confidence'] as num?)?.toDouble(),
        unavailable: json['unavailable'] as bool? ?? false,
      );

  final String original;
  final String translated;
  final String? sourceLanguage;
  final String? targetLanguage;
  final double? confidence;
  final bool unavailable;
}

class SignedUpload {
  const SignedUpload({
    required this.uploadUrl,
    required this.fileUrl,
    required this.storagePath,
    required this.mimeType,
  });

  factory SignedUpload.fromJson(Map<String, dynamic> json) => SignedUpload(
        uploadUrl: json['uploadUrl'] as String? ?? '',
        fileUrl: json['fileUrl'] as String? ?? '',
        storagePath: json['storagePath'] as String? ?? '',
        mimeType: json['mimeType'] as String? ?? 'application/octet-stream',
      );

  final String uploadUrl;
  final String fileUrl;
  final String storagePath;
  final String mimeType;
}
