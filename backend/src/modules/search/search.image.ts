import { insertAndGetId, queryOne, type Row } from '../../db/query';
import { sha256 } from '../../core/security/crypto';
import { env } from '../../config/env';
import { loggerFor } from '../../config/logger';
import { orchestrate } from '../ai/ai.orchestrator';
import { throughGateway } from '../ai/ai.gateway';
import { detectMarketplaces, firstMatchingRule, GOLD_FORMS, PROPERTY_KINDS, VEHICLE_TYPES } from './search.taxonomy';
import { emptySearchQuery, type SearchQuery } from './search.dsl';

const log = loggerFor('search.image');

export interface ImageSearchInput {
  userId: number | null;
  imageUrl: string;
}

export interface ImageSearchResult {
  id: number;
  labels: string[];
  marketplaceCode: string | null;
  disclaimer: string;
  dsl: SearchQuery;
}

const DISCLAIMER =
  'Image search finds visually or semantically similar listings. It does not prove authenticity, ownership, or vehicle identity.';

async function visionLabels(imageUrl: string): Promise<string[]> {
  if (!env.AI_API_KEY) return [];
  try {
    const base = env.AI_BASE_URL || 'https://api.openai.com/v1';
    const response = await fetch(`${base}/chat/completions`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${env.AI_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: env.AI_MODEL || 'gpt-4o-mini',
        max_tokens: 200,
        messages: [
          {
            role: 'user',
            content: [
              {
                type: 'text',
                text: 'Describe this marketplace listing photo as JSON {"labels":[string],"marketplace":"gold"|"property"|"vehicles"|null,"attributes":{}}. No authenticity claims.',
              },
              { type: 'image_url', image_url: { url: imageUrl } },
            ],
          },
        ],
      }),
    });
    if (!response.ok) return [];
    const payload = (await response.json()) as { choices?: Array<{ message?: { content?: string } }> };
    const content = payload.choices?.[0]?.message?.content ?? '';
    const match = content.match(/\{[\s\S]*\}/);
    if (!match) return [];
    const parsed = JSON.parse(match[0]) as { labels?: string[] };
    return (parsed.labels ?? []).map((label) => String(label)).slice(0, 12);
  } catch (error) {
    log.warn({ err: error }, 'vision labels unavailable');
    return [];
  }
}

function dslFromLabels(labels: string[], imageUrl: string): SearchQuery {
  const blob = `${labels.join(' ')} ${imageUrl}`.toLowerCase();
  const detected = detectMarketplaces(blob);
  const query = emptySearchQuery({
    originalQuery: labels.join(' '),
    keywords: labels.join(' '),
    semanticQuery: labels.join(' '),
    marketplace: detected[0] ?? null,
    searchType: 'image',
    intent: 'search',
  });
  const goldForm = firstMatchingRule(blob, GOLD_FORMS);
  if (goldForm) {
    query.marketplace = 'gold';
    query.filters.form = goldForm === 'ring' || goldForm === 'necklace' ? 'jewellery' : goldForm;
    if (goldForm === 'ring' || goldForm === 'necklace' || goldForm === 'bangle' || goldForm === 'earring') {
      query.filters.jewelleryType = goldForm;
    }
  }
  const propertyKind = firstMatchingRule(blob, PROPERTY_KINDS);
  if (propertyKind) {
    query.marketplace = 'property';
    query.filters.propertyKind = propertyKind;
  }
  const vehicleType = firstMatchingRule(blob, VEHICLE_TYPES);
  if (vehicleType) {
    query.marketplace = 'vehicles';
    query.filters.vehicleType = vehicleType;
  }
  return query;
}

export async function ingestImageSearch(input: ImageSearchInput): Promise<ImageSearchResult> {
  const run = async () => {
    const labels = await visionLabels(input.imageUrl);
    return { labels, model: labels.length > 0 ? 'vision' : 'heuristic', confidence: labels.length > 0 ? 60 : 25, latencyMs: 0 };
  };
  let labels: string[] = [];
  try {
    const gated = input.userId
      ? await throughGateway({ userId: input.userId }, { task: 'ocr', input: { imageUrl: input.imageUrl }, run })
      : await orchestrate({ task: 'ocr', skipEntitlement: true, skipQuota: true, input: { imageUrl: input.imageUrl } }, run);
    if (!('accepted' in gated)) labels = gated.result.labels ?? [];
  } catch (error) {
    log.debug({ err: error }, 'image search AI path skipped');
    labels = await visionLabels(input.imageUrl);
  }
  const dsl = dslFromLabels(labels, input.imageUrl);
  const detected = dsl.marketplace;
  const marketplaceRow = detected
    ? await queryOne<Row>('SELECT id FROM marketplaces WHERE code = ?', [detected])
    : null;
  const id = await insertAndGetId(
    `INSERT INTO image_search_requests
       (user_id, image_url, perceptual_hash, detected_labels, detected_marketplace_id, resolved_filters, provider)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
    [
      input.userId,
      input.imageUrl.slice(0, 512),
      sha256(input.imageUrl).slice(0, 64),
      JSON.stringify(labels),
      marketplaceRow ? Number(marketplaceRow.id) : null,
      JSON.stringify(dsl),
      labels.length > 0 ? 'vision' : 'heuristic',
    ],
  );
  return { id, labels, marketplaceCode: dsl.marketplace, disclaimer: DISCLAIMER, dsl };
}
