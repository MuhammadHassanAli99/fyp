export const MESSAGE_KINDS = [
  'text',
  'image',
  'video',
  'voice',
  'audio',
  'document',
  'location',
  'system',
  'call_log',
] as const;

export type MessageKind = (typeof MESSAGE_KINDS)[number];

export const CLIENT_MESSAGE_KINDS = [
  'text',
  'image',
  'video',
  'voice',
  'audio',
  'document',
  'location',
] as const;

export type ClientMessageKind = (typeof CLIENT_MESSAGE_KINDS)[number];

export const CONVERSATION_TYPES = [
  'buyer_seller',
  'buyer_dealer',
  'buyer_agent',
  'rental',
  'auction',
  'support',
  'system',
] as const;

export type ConversationType = (typeof CONVERSATION_TYPES)[number];

export const PRESENCE_STATUSES = ['online', 'away', 'offline'] as const;
export type PresenceStatus = (typeof PRESENCE_STATUSES)[number];

export type DeletionType = 'none' | 'for_me' | 'for_everyone';

export type AttachmentKind = 'image' | 'video' | 'audio' | 'document' | 'other';

export interface AttachmentInput {
  kind: AttachmentKind;
  url?: string | null;
  storageKey?: string | null;
  thumbUrl?: string | null;
  thumbnailKey?: string | null;
  fileName?: string | null;
  mimeType?: string | null;
  sizeBytes?: number | null;
  width?: number | null;
  height?: number | null;
  durationMs?: number | null;
  waveform?: number[] | null;
  codec?: string | null;
}

export interface LocationContent {
  latitude: number;
  longitude: number;
  accuracy?: number | null;
  timestamp?: string | null;
  label?: string | null;
  source?: 'current' | 'selected' | 'listing';
}

export interface PublicAttachment {
  id: number;
  kind: string;
  url: string | null;
  thumbUrl: string | null;
  fileName: string | null;
  mimeType: string | null;
  sizeBytes: number | null;
  width: number | null;
  height: number | null;
  durationMs: number | null;
  waveform: number[] | null;
  codec: string | null;
  uploadStatus: string;
}

export interface PublicMessage {
  id: number;
  uuid: string;
  conversationId: number;
  senderId: number | null;
  kind: string;
  body: string | null;
  replyTo: { id: number; uuid: string; body: string | null; senderId: number | null } | null;
  attachments: PublicAttachment[];
  location: LocationContent | null;
  isEdited: boolean;
  editedAt: string | null;
  deleted: boolean;
  deletionType: DeletionType;
  status: string;
  createdAt: string;
  updatedAt: string | null;
  metadata: Record<string, unknown> | null;
}

export interface PublicConversation {
  id: number;
  uuid: string;
  kind: string;
  conversationType: ConversationType;
  subject: string | null;
  marketplaceId: number | null;
  marketplaceCode: string | null;
  listingId: number | null;
  listingUuid: string | null;
  listingTitle: string | null;
  listingLocation: { latitude: number; longitude: number } | null;
  businessId: number | null;
  lastMessageAt: string | null;
  lastMessagePreview: string | null;
  lastMessageId: number | null;
  messageCount: number;
  status: string;
  unreadCount: number;
  lastReadMessageId: number | null;
  lastReadAt: string | null;
  isPinned: boolean;
  isArchived: boolean;
  isMuted: boolean;
  peerId: number | null;
  peerName: string | null;
  peerAvatar: string | null;
  peerPresence: { status: PresenceStatus; lastSeenAt: string | null } | null;
}

export function conversationTypeFromListing(params: {
  operation: string | null;
  businessKind: string | null;
}): ConversationType {
  if (params.operation === 'auction') return 'auction';
  if (params.operation === 'rent') return 'rental';
  if (params.businessKind === 'dealer' || params.businessKind === 'showroom') return 'buyer_dealer';
  if (params.businessKind === 'agency' || params.businessKind === 'broker' || params.businessKind === 'builder') {
    return 'buyer_agent';
  }
  return 'buyer_seller';
}

export function previewFor(kind: MessageKind, body?: string | null): string {
  if (body?.trim()) return body.trim().slice(0, 255);
  switch (kind) {
    case 'image':
      return 'Photo';
    case 'video':
      return 'Video';
    case 'voice':
      return 'Voice message';
    case 'audio':
      return 'Audio';
    case 'document':
      return 'Document';
    case 'location':
      return 'Location';
    case 'call_log':
      return 'Call';
    case 'system':
      return 'System';
    default:
      return 'New message';
  }
}

export function attachmentKindForMessage(kind: MessageKind): AttachmentKind {
  if (kind === 'image') return 'image';
  if (kind === 'video') return 'video';
  if (kind === 'voice' || kind === 'audio') return 'audio';
  if (kind === 'document') return 'document';
  return 'other';
}
