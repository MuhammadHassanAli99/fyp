export const OFFER_STATUSES = [
  'pending',
  'countered',
  'accepted',
  'rejected',
  'expired',
  'cancelled',
  'withdrawn',
] as const;

export type OfferStatus = (typeof OFFER_STATUSES)[number];

const TRANSITIONS: Record<OfferStatus, OfferStatus[]> = {
  pending: ['countered', 'accepted', 'rejected', 'expired', 'cancelled', 'withdrawn'],
  countered: ['countered', 'accepted', 'rejected', 'expired', 'cancelled', 'withdrawn'],
  accepted: [],
  rejected: [],
  expired: [],
  cancelled: [],
  withdrawn: [],
};

export function canTransitionOffer(from: OfferStatus, to: OfferStatus): boolean {
  return TRANSITIONS[from]?.includes(to) ?? false;
}

export function assertOfferTransition(from: OfferStatus, to: OfferStatus): void {
  if (!canTransitionOffer(from, to)) {
    const error = new Error(`Offer cannot move from ${from} to ${to}`);
    (error as Error & { code: string }).code = 'INVALID_STATE_TRANSITION';
    throw error;
  }
}
