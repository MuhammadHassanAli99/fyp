/**
 * Property type vs transaction type. Categories stay in the database;
 * this is the validation rule Flutter and listings both must honour.
 *
 * Empty allowedOperations must not block listings (JSON parse miss / unset seed).
 */
export function mapTypeOperation(operation: string): string {
  if (operation === 'auction' || operation === 'exchange') return 'sell';
  return operation;
}

export function isTypeOperationAllowed(
  allowedOperations: readonly string[],
  operation: string,
): boolean {
  if (allowedOperations.length === 0) return true;
  return allowedOperations.includes(mapTypeOperation(operation));
}

export function canReviewApplication(status: string): boolean {
  return status === 'submitted' || status === 'under_review';
}

export function canTransitionLease(
  from: string,
  to: 'draft' | 'pending_signature' | 'active' | 'expired' | 'terminated' | 'cancelled',
): boolean {
  const allowed: Record<string, string[]> = {
    draft: ['pending_signature', 'cancelled'],
    pending_signature: ['active', 'cancelled'],
    active: ['expired', 'terminated'],
    expired: [],
    terminated: [],
    cancelled: [],
  };
  return allowed[from]?.includes(to) ?? false;
}

export function riskBand(score: number): 'low' | 'medium' | 'high' {
  if (score >= 70) return 'high';
  if (score >= 40) return 'medium';
  return 'low';
}

/** Fraud scoring never auto-bans from a single pipeline run. */
export const PROPERTY_FRAUD_AUTO_BAN = false as const;
