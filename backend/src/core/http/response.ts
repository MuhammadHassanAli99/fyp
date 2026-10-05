import type { Response } from 'express';
import { getContext } from '../context';

/**
 * One response envelope for the entire API. The Flutter `ApiClient` unwraps
 * exactly this shape, so no endpoint may invent its own.
 *
 *   { "success": true,  "data": ..., "meta": { ... } }
 *   { "success": false, "error": { "code": "...", "message": "...", "issues": [...] } }
 */
export interface ResponseMeta {
  requestId?: string;
  timestamp?: string;
  durationMs?: number;
  [key: string]: unknown;
}

export interface PageMeta extends ResponseMeta {
  page: number;
  perPage: number;
  total: number;
  totalPages: number;
  hasMore: boolean;
  /** Opaque keyset cursor for infinite scroll (§26). */
  nextCursor?: string | null;
}

const baseMeta = (): ResponseMeta => {
  const context = getContext();
  return {
    requestId: context?.requestId,
    timestamp: new Date().toISOString(),
    ...(context ? { durationMs: Date.now() - context.startedAt } : {}),
  };
};

export function ok<T>(res: Response, data: T, meta: ResponseMeta = {}): Response {
  return res.status(200).json({ success: true, data, meta: { ...baseMeta(), ...meta } });
}

export function created<T>(res: Response, data: T, meta: ResponseMeta = {}): Response {
  return res.status(201).json({ success: true, data, meta: { ...baseMeta(), ...meta } });
}

export function accepted<T>(res: Response, data: T, meta: ResponseMeta = {}): Response {
  return res.status(202).json({ success: true, data, meta: { ...baseMeta(), ...meta } });
}

export function noContent(res: Response): Response {
  return res.status(204).send();
}

export interface Paginated<T> {
  items: T[];
  total: number;
  page: number;
  perPage: number;
  nextCursor?: string | null;
  /** When set, wins over page/totalPages (keyset feeds). */
  hasMore?: boolean;
}

export function page<T>(res: Response, result: Paginated<T>, meta: ResponseMeta = {}): Response {
  const totalPages = result.perPage > 0 ? Math.ceil(result.total / result.perPage) : 0;
  const pageMeta: PageMeta = {
    ...baseMeta(),
    page: result.page,
    perPage: result.perPage,
    total: result.total,
    totalPages,
    hasMore: result.hasMore ?? result.page < totalPages,
    nextCursor: result.nextCursor ?? null,
    ...meta,
  };
  return res.status(200).json({ success: true, data: result.items, meta: pageMeta });
}

/** Cache headers for reference data that changes rarely (§26 Caching). */
export function withCache(res: Response, seconds: number, etag?: string): Response {
  res.setHeader('Cache-Control', `public, max-age=${seconds}, stale-while-revalidate=${seconds * 2}`);
  if (etag) res.setHeader('ETag', etag);
  return res;
}
