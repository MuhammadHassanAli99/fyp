import { looksMalicious } from '../users/image-inspect';
import { mediaScan } from '../../providers/media-scan';

export interface DocumentPipelineResult {
  accepted: boolean;
  classifiedAs: string | null;
  reasons: string[];
  aiCertifiedAuthentic: false;
}

/**
 * Upload → validate → scan → classify → extract → review.
 * AI must not automatically certify authenticity.
 */
export async function validateDocumentBuffer(buffer: Buffer, claimedMime: string): Promise<DocumentPipelineResult> {
  const reasons: string[] = [];
  if (looksMalicious(buffer)) reasons.push('file_rejected');
  const scan = await mediaScan.scan({ buffer, claimedMime, purpose: 'document' });
  if (scan.verdict === 'blocked') reasons.push(...scan.reasons);
  const classifiedAs =
    claimedMime === 'application/pdf'
      ? 'document'
      : claimedMime.startsWith('image/')
        ? 'id_image'
        : 'other';
  return {
    accepted: reasons.length === 0 && scan.verdict !== 'blocked',
    classifiedAs,
    reasons,
    aiCertifiedAuthentic: false,
  };
}
