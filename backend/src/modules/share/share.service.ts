import { contextOrDefaults } from '../../core/context';
import { forbidden, notFound } from '../../core/errors';
import { getFavorite, getCollection } from '../favorites/favorites.service';
import { getSet } from '../comparison/comparison.service';
import { getListing } from '../listings/listings.service';
import { loadActiveShareToken, publicShareUrl, type ShareTargetType } from './share.tokens';

export { createShareToken, revokeShareTokens, publicShareUrl } from './share.tokens';
export type { ShareTargetType, ShareTokenRecord } from './share.tokens';

export async function resolveShareToken(token: string): Promise<{
  token: string;
  targetType: ShareTargetType;
  targetId: number;
  url: string;
  target: unknown;
}> {
  const row = await loadActiveShareToken(token);
  const targetType = row.target_type as ShareTargetType;
  const targetId = Number(row.target_id);
  const ownerUserId = Number(row.owner_user_id);
  const context = contextOrDefaults();
  let target: unknown;

  switch (targetType) {
    case 'listing': {
      target = await getListing({
        idOrUuid: targetId,
        language: context.language,
        currency: context.currency,
        viewerId: context.userId,
        isStaff: false,
      });
      break;
    }
    case 'favorite': {
      target = await getFavorite(ownerUserId, targetId);
      break;
    }
    case 'collection': {
      target = await getCollection(null, targetId, { shareToken: token });
      break;
    }
    case 'comparison': {
      target = await getSet({
        idOrUuid: targetId,
        owner: { userId: ownerUserId, guestUuid: null },
        viaShareToken: true,
      });
      break;
    }
    default:
      throw forbidden('Unsupported share target');
  }

  if (!target) throw notFound('Shared item');

  return {
    token,
    targetType,
    targetId,
    url: publicShareUrl(token),
    target,
  };
}
