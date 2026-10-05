import { z } from 'zod';
import { badRequest } from '../errors';

export const MAX_PER_PAGE = 100;
export const DEFAULT_PER_PAGE = 20;

/**
 * Uniform pagination + sort grammar shared by every list endpoint:
 *   ?page=2&perPage=20&sort=-price&cursor=<opaque>
 *
 * Offset pagination powers page-numbered admin tables; keyset (cursor)
 * pagination powers the infinite-scroll feeds where deep offsets would crawl.
 */
export const paginationSchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  perPage: z.coerce.number().int().min(1).max(MAX_PER_PAGE).default(DEFAULT_PER_PAGE),
  cursor: z.string().max(512).optional(),
  sort: z.string().max(128).optional(),
});

export type PaginationInput = z.infer<typeof paginationSchema>;

export interface SortClause {
  field: string;
  direction: 'ASC' | 'DESC';
}

export interface ResolvedPagination {
  page: number;
  perPage: number;
  offset: number;
  limit: number;
  cursor: Cursor | null;
  sort: SortClause[];
}

export interface Cursor {
  /** Last seen id, breaking ties deterministically. */
  id: number;
  /** Last seen value of a single-column sort. */
  value?: string | number | null;
  /** Default feed sort: featured → search_rank → bump → id. */
  featured?: number;
  rank?: number;
  bump?: string | null;
}

export function encodeCursor(cursor: Cursor): string {
  return Buffer.from(JSON.stringify(cursor), 'utf8').toString('base64url');
}

export function decodeCursor(raw: string): Cursor {
  try {
    const parsed = JSON.parse(Buffer.from(raw, 'base64url').toString('utf8')) as Cursor;
    if (parsed === null || typeof parsed !== 'object' || typeof parsed.id !== 'number' || !Number.isFinite(parsed.id)) {
      throw new Error('malformed');
    }
    return parsed;
  } catch {
    throw badRequest('Invalid pagination cursor');
  }
}

/**
 * `sort=-price,createdAt` → [{price DESC}, {createdAt ASC}].
 * `allowed` maps a public field name to a real SQL expression, which is the
 * only reason this cannot be injected.
 *
 * Explicit `+` / `-` prefixes always win. Otherwise `defaultDirections` is used
 * so marketplace codes like `newest` / `area_desc` sort DESC without requiring
 * a leading dash (module `SortOption.direction`).
 */
export function parseSort(
  raw: string | undefined,
  allowed: Record<string, string>,
  fallback: SortClause[] = [],
  defaultDirections: Record<string, 'ASC' | 'DESC'> = {},
): SortClause[] {
  if (!raw) return fallback;
  const clauses: SortClause[] = [];
  for (const token of raw.split(',')) {
    const trimmed = token.trim();
    if (!trimmed) continue;
    const key = trimmed.replace(/^[-+]/, '');
    const direction: 'ASC' | 'DESC' = trimmed.startsWith('-')
      ? 'DESC'
      : trimmed.startsWith('+')
        ? 'ASC'
        : (defaultDirections[key] ?? 'ASC');
    const column = allowed[key];
    if (!column) {
      throw badRequest(`Cannot sort by "${key}". Allowed: ${Object.keys(allowed).join(', ')}`);
    }
    clauses.push({ field: column, direction });
  }
  return clauses.length > 0 ? clauses : fallback;
}

export function resolvePagination(
  input: PaginationInput,
  allowedSort: Record<string, string>,
  fallbackSort: SortClause[] = [],
  defaultDirections: Record<string, 'ASC' | 'DESC'> = {},
): ResolvedPagination {
  return {
    page: input.page,
    perPage: input.perPage,
    offset: (input.page - 1) * input.perPage,
    limit: input.perPage,
    cursor: input.cursor ? decodeCursor(input.cursor) : null,
    sort: parseSort(input.sort, allowedSort, fallbackSort, defaultDirections),
  };
}

export const buildOrderBy = (sort: SortClause[], fallback = 'id DESC'): string =>
  sort.length > 0 ? sort.map((clause) => `${clause.field} ${clause.direction}`).join(', ') : fallback;

export const DEFAULT_FEED_ORDER =
  'l.is_featured DESC, l.search_rank DESC, COALESCE(l.bump_at, l.published_at, l.created_at) DESC, l.id DESC';

const DEFAULT_BUMP = 'COALESCE(l.bump_at, l.published_at, l.created_at)';

/**
 * Keyset predicate matching `DEFAULT_FEED_ORDER` or a single allowed sort
 * clause. Returns null when the cursor cannot be applied (caller falls back to OFFSET).
 */
export function keysetClause(
  sort: SortClause[],
  cursor: Cursor,
): { sql: string; params: Array<string | number | Date | null> } | null {
  if (sort.length === 0) {
    const featured = cursor.featured ?? 0;
    const rank = cursor.rank ?? 0;
    const bump = cursor.bump ? new Date(cursor.bump) : null;
    if (!bump || Number.isNaN(bump.getTime())) return null;
    return {
      sql: `(l.is_featured < ? OR (l.is_featured = ? AND l.search_rank < ?) OR (l.is_featured = ? AND l.search_rank = ? AND ${DEFAULT_BUMP} < ?) OR (l.is_featured = ? AND l.search_rank = ? AND ${DEFAULT_BUMP} = ? AND l.id < ?))`,
      params: [featured, featured, rank, featured, rank, bump, featured, rank, bump, cursor.id],
    };
  }
  if (sort.length !== 1 || cursor.value === undefined || cursor.value === null) return null;
  const expr = sort[0]!.field;
  const descending = sort[0]!.direction === 'DESC';
  const cmp = descending ? '<' : '>';
  const idCmp = descending ? '<' : '>';
  const raw = cursor.value;
  const value =
    typeof raw === 'string' && /^\d{4}-\d{2}-\d{2}/.test(raw) ? new Date(raw) : raw;
  if (value instanceof Date && Number.isNaN(value.getTime())) return null;
  return {
    sql: `((${expr}) ${cmp} ? OR ((${expr}) = ? AND l.id ${idCmp} ?))`,
    params: [value as string | number | Date, value as string | number | Date, cursor.id],
  };
}

export function cursorFromFeedRow(
  row: Record<string, unknown>,
  sort: SortClause[],
): Cursor {
  const id = Number(row.id);
  if (sort.length === 1) {
    const raw = row.cursor_sort_value;
    const value =
      raw instanceof Date
        ? raw.toISOString()
        : typeof raw === 'number' || typeof raw === 'string'
          ? raw
          : raw == null
            ? null
            : String(raw);
    return { id, value };
  }
  const bumpRaw = row.bump_at ?? row.published_at ?? row.created_at;
  const bump =
    bumpRaw instanceof Date ? bumpRaw.toISOString() : bumpRaw == null ? null : String(bumpRaw);
  return {
    id,
    featured: Number(row.is_featured ?? 0),
    rank: Number(row.search_rank ?? 0),
    bump,
  };
}
