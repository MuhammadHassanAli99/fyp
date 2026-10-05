import { execute, insertAndGetId, queryCount, queryOne, queryRows, type Row } from '../../db/query';
import { remember } from '../../config/cache';
import { notFound } from '../../core/errors';
import { encodeCursor } from '../../core/http/pagination';
import { parseTags } from './support.types';

const PUBLIC_VISIBILITY = `visibility IN ('public','logged_in')`;

function marketplaceFilter(code?: string) {
  if (!code) return { sql: '', params: [] as unknown[] };
  return {
    sql: ` AND (a.marketplace_id IS NULL OR a.marketplace_id = (SELECT id FROM marketplaces WHERE code = ? LIMIT 1))`,
    params: [code],
  };
}

export async function listKbCategories(marketplaceCode?: string) {
  return remember(`support:kb:categories:${marketplaceCode ?? 'all'}`, 120, async () => {
    const mp = marketplaceFilter(marketplaceCode);
    const rows = await queryRows<Row>(
      `SELECT c.id, c.code, c.name, c.description, c.parent_id, c.marketplace_id, c.icon, c.article_count, c.sort_order
         FROM kb_categories c
        WHERE c.is_active = 1
          ${marketplaceCode ? 'AND (c.marketplace_id IS NULL OR c.marketplace_id = (SELECT id FROM marketplaces WHERE code = ? LIMIT 1))' : ''}
        ORDER BY c.sort_order, c.id`,
      marketplaceCode ? [marketplaceCode] : [],
    );
    void mp;
    return rows.map((row) => ({
      id: Number(row.id),
      code: String(row.code),
      name: String(row.name),
      description: (row.description as string | null) ?? null,
      parentId: row.parent_id === null ? null : Number(row.parent_id),
      marketplaceId: row.marketplace_id === null ? null : Number(row.marketplace_id),
      articleCount: Number(row.article_count ?? 0),
    }));
  });
}

export async function searchKnowledge(params: {
  q?: string;
  categoryCode?: string;
  marketplaceCode?: string;
  language?: string;
  page?: number;
  perPage?: number;
  staff?: boolean;
}) {
  const perPage = Math.min(params.perPage ?? 20, 50);
  const page = params.page ?? 1;
  const visibility = params.staff ? `visibility IN ('public','logged_in','staff')` : PUBLIC_VISIBILITY;
  const filters = [`a.status = 'published'`, visibility];
  const values: unknown[] = [];
  if (params.categoryCode) {
    filters.push('c.code = ?');
    values.push(params.categoryCode);
  }
  if (params.marketplaceCode) {
    filters.push('(a.marketplace_id IS NULL OR a.marketplace_id = (SELECT id FROM marketplaces WHERE code = ? LIMIT 1))');
    values.push(params.marketplaceCode);
  }
  if (params.language) {
    filters.push('(a.language IS NULL OR a.language = ? OR a.language = LEFT(?, 2))');
    values.push(params.language, params.language);
  }

  let order = 'a.published_at DESC, a.id DESC';
  if (params.q?.trim()) {
    const q = params.q.trim().slice(0, 200);
    filters.push('(a.title LIKE ? OR a.excerpt LIKE ? OR a.search_keywords LIKE ? OR a.body LIKE ?)');
    values.push(`%${q}%`, `%${q}%`, `%${q}%`, `%${q}%`);
    order = 'a.helpful_count DESC, a.view_count DESC, a.id DESC';
  }

  const where = `WHERE ${filters.join(' AND ')}`;
  const total = await queryCount(
    `SELECT COUNT(*) FROM kb_articles a LEFT JOIN kb_categories c ON c.id = a.category_id ${where}`,
    values,
  );
  const rows = await queryRows<Row>(
    `SELECT a.id, a.uuid, a.slug, a.title, a.excerpt, a.language, a.marketplace_id, a.visibility,
            a.view_count, a.helpful_count, a.published_at, c.code AS category_code, c.name AS category_name
       FROM kb_articles a
       LEFT JOIN kb_categories c ON c.id = a.category_id
      ${where}
      ORDER BY ${order}
      LIMIT ? OFFSET ?`,
    [...values, perPage, (page - 1) * perPage],
  );

  const last = rows[rows.length - 1];
  return {
    items: rows.map((row) => ({
      uuid: String(row.uuid),
      slug: String(row.slug),
      title: String(row.title),
      excerpt: (row.excerpt as string | null) ?? null,
      language: (row.language as string | null) ?? 'en',
      categoryCode: (row.category_code as string | null) ?? null,
      categoryName: (row.category_name as string | null) ?? null,
      marketplaceId: row.marketplace_id === null ? null : Number(row.marketplace_id),
      viewCount: Number(row.view_count ?? 0),
      helpfulCount: Number(row.helpful_count ?? 0),
      publishedAt: row.published_at ? (row.published_at as Date).toISOString() : null,
    })),
    total,
    page,
    perPage,
    nextCursor: last ? encodeCursor({ id: Number(last.id) }) : null,
    hasMore: page * perPage < total,
  };
}

export async function retrieveForAi(params: {
  question: string;
  language?: string;
  marketplaceCode?: string;
  limit?: number;
}): Promise<Array<{ id: number; uuid: string; title: string; excerpt: string; slug: string; visibility: string }>> {
  const q = params.question.trim().slice(0, 400);
  if (!q) return [];
  const rows = await queryRows<Row>(
    `SELECT a.id, a.uuid, a.slug, a.title, a.excerpt, a.visibility, a.body
       FROM kb_articles a
      WHERE a.status = 'published' AND a.visibility IN ('public','logged_in')
        AND (? IS NULL OR a.language IS NULL OR a.language = ?)
        AND (? IS NULL OR a.marketplace_id IS NULL OR a.marketplace_id = (SELECT id FROM marketplaces WHERE code = ? LIMIT 1))
        AND (MATCH(a.title, a.excerpt, a.body) AGAINST (? IN NATURAL LANGUAGE MODE)
             OR a.title LIKE ? OR a.search_keywords LIKE ? OR a.excerpt LIKE ?)
      ORDER BY MATCH(a.title, a.excerpt, a.body) AGAINST (? IN NATURAL LANGUAGE MODE) DESC
      LIMIT ?`,
    [
      params.language ?? null,
      params.language ?? 'en',
      params.marketplaceCode ?? null,
      params.marketplaceCode ?? null,
      q,
      `%${q.slice(0, 80)}%`,
      `%${q.slice(0, 80)}%`,
      `%${q.slice(0, 80)}%`,
      q,
      params.limit ?? 8,
    ],
  ).catch(async () =>
    queryRows<Row>(
      `SELECT a.id, a.uuid, a.slug, a.title, a.excerpt, a.visibility
         FROM kb_articles a
        WHERE a.status = 'published' AND a.visibility IN ('public','logged_in')
        ORDER BY a.view_count DESC
        LIMIT ?`,
      [params.limit ?? 8],
    ),
  );

  return rows
    .filter((row) => String(row.visibility) !== 'staff')
    .map((row) => ({
      id: Number(row.id),
      uuid: String(row.uuid),
      title: String(row.title),
      excerpt: String(row.excerpt ?? '').slice(0, 600),
      slug: String(row.slug),
      visibility: String(row.visibility),
    }));
}

export async function getArticle(slugOrUuid: string, viewerId: number | null, staff = false) {
  const row = await queryOne<Row>(
    `SELECT a.*, c.code AS category_code, c.name AS category_name
       FROM kb_articles a
       LEFT JOIN kb_categories c ON c.id = a.category_id
      WHERE (a.slug = ? OR a.uuid = ?) AND a.status = 'published'`,
    [slugOrUuid, slugOrUuid],
  );
  if (!row) throw notFound('Article');
  if (String(row.visibility) === 'staff' && !staff) throw notFound('Article');
  if (String(row.visibility) === 'logged_in' && !viewerId && !staff) throw notFound('Article');

  await execute('UPDATE kb_articles SET view_count = view_count + 1 WHERE id = ?', [row.id]).catch(() => undefined);

  const translation = viewerId
    ? await queryOne<Row>(
        `SELECT language, title, excerpt, body FROM kb_article_translations WHERE article_id = ? LIMIT 8`,
        [row.id],
      ).catch(() => null)
    : null;
  void translation;

  return {
    uuid: String(row.uuid),
    slug: String(row.slug),
    title: String(row.title),
    excerpt: (row.excerpt as string | null) ?? null,
    body: (row.body as string | null) ?? '',
    language: (row.language as string | null) ?? 'en',
    categoryCode: (row.category_code as string | null) ?? null,
    categoryName: (row.category_name as string | null) ?? null,
    marketplaceId: row.marketplace_id === null ? null : Number(row.marketplace_id),
    tags: parseTags(row.tags),
    publishedAt: row.published_at ? (row.published_at as Date).toISOString() : null,
    viewCount: Number(row.view_count ?? 0) + 1,
    helpfulCount: Number(row.helpful_count ?? 0),
    notHelpfulCount: Number(row.not_helpful_count ?? 0),
    related: parseTags({ ids: row.related_article_ids }).ids ?? [],
  };
}

export async function recordArticleFeedback(
  articleUuid: string,
  input: { userId?: number | null; guestUuid?: string | null; helpful: boolean; comment?: string },
) {
  const article = await queryOne<Row>(`SELECT id FROM kb_articles WHERE uuid = ? OR slug = ?`, [articleUuid, articleUuid]);
  if (!article) throw notFound('Article');
  await insertAndGetId(
    `INSERT INTO kb_article_feedback (article_id, user_id, guest_uuid, is_helpful, comment)
     VALUES (?, ?, ?, ?, ?)`,
    [article.id, input.userId ?? null, input.guestUuid ?? null, input.helpful ? 1 : 0, input.comment ?? null],
  );
  await execute(
    input.helpful
      ? `UPDATE kb_articles SET helpful_count = helpful_count + 1 WHERE id = ?`
      : `UPDATE kb_articles SET not_helpful_count = not_helpful_count + 1 WHERE id = ?`,
    [article.id],
  );
  return { recorded: true };
}

export async function listFaqs(params: { marketplaceCode?: string; language?: string; categoryCode?: string }) {
  const rows = await queryRows<Row>(
    `SELECT f.id, f.question, f.answer, f.language, f.sort_order, c.code AS category_code
       FROM faqs f
       LEFT JOIN kb_categories c ON c.id = f.category_id
      WHERE f.is_active = 1
        AND (? IS NULL OR f.language IS NULL OR f.language = ?)
        AND (? IS NULL OR f.marketplace_id IS NULL OR f.marketplace_id = (SELECT id FROM marketplaces WHERE code = ? LIMIT 1))
        AND (? IS NULL OR c.code = ?)
      ORDER BY f.sort_order, f.id
      LIMIT 80`,
    [
      params.language ?? null,
      params.language ?? 'en',
      params.marketplaceCode ?? null,
      params.marketplaceCode ?? null,
      params.categoryCode ?? null,
      params.categoryCode ?? null,
    ],
  );
  return rows.map((row) => ({
    id: Number(row.id),
    question: String(row.question),
    answer: String(row.answer),
    language: (row.language as string | null) ?? 'en',
    categoryCode: (row.category_code as string | null) ?? null,
  }));
}

export function scoreKnowledgeOverlap(question: string, title: string, excerpt: string): number {
  const terms = question
    .toLowerCase()
    .split(/\W+/)
    .filter((term) => term.length > 3);
  if (terms.length === 0) return 0;
  const haystack = `${title} ${excerpt}`.toLowerCase();
  const hits = terms.filter((term) => haystack.includes(term)).length;
  return hits / terms.length;
}
