import { execute, insertAndGetId, queryCount, queryOne, queryRows, type Row } from '../../db/query';
import { badRequest, forbidden, notFound } from '../../core/errors';
import { uuid } from '../../core/security/crypto';
import { encodeCursor } from '../../core/http/pagination';
import { submitReport } from '../moderation/moderation.service';

function slugify(title: string): string {
  return `${title.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 160)}-${randomSuffix()}`;
}

function randomSuffix(): string {
  return uuid().slice(0, 8);
}

export async function listForumCategories(marketplaceCode?: string) {
  const rows = await queryRows<Row>(
    `SELECT id, code, name, description, marketplace_id, topic_count, post_count, is_moderated, min_trust_band, sort_order
       FROM forum_categories
      WHERE is_active = 1
        AND (? IS NULL OR marketplace_id IS NULL OR marketplace_id = (SELECT id FROM marketplaces WHERE code = ? LIMIT 1))
      ORDER BY sort_order, id`,
    [marketplaceCode ?? null, marketplaceCode ?? null],
  );
  return rows.map((row) => ({
    id: Number(row.id),
    code: String(row.code),
    name: String(row.name),
    description: (row.description as string | null) ?? null,
    marketplaceId: row.marketplace_id === null ? null : Number(row.marketplace_id),
    topicCount: Number(row.topic_count ?? 0),
    postCount: Number(row.post_count ?? 0),
    moderated: Boolean(row.is_moderated),
    minTrustBand: String(row.min_trust_band ?? 'new'),
  }));
}

export async function listTopics(params: {
  categoryCode?: string;
  marketplaceCode?: string;
  q?: string;
  page?: number;
  perPage?: number;
}) {
  const perPage = Math.min(params.perPage ?? 20, 50);
  const page = params.page ?? 1;
  const filters = [`t.status IN ('open','answered','closed')`];
  const values: unknown[] = [];
  if (params.categoryCode) {
    filters.push('c.code = ?');
    values.push(params.categoryCode);
  }
  if (params.marketplaceCode) {
    filters.push('(c.marketplace_id IS NULL OR c.marketplace_id = (SELECT id FROM marketplaces WHERE code = ? LIMIT 1))');
    values.push(params.marketplaceCode);
  }
  if (params.q) {
    filters.push('(t.title LIKE ? OR t.body LIKE ?)');
    const like = `%${params.q.replace(/[\\%_]/g, '').slice(0, 80)}%`;
    values.push(like, like);
  }
  const where = `WHERE ${filters.join(' AND ')}`;
  const total = await queryCount(
    `SELECT COUNT(*) FROM forum_topics t JOIN forum_categories c ON c.id = t.category_id ${where}`,
    values,
  );
  const rows = await queryRows<Row>(
    `SELECT t.id, t.uuid, t.slug, t.title, t.kind, t.status, t.is_pinned, t.is_locked, t.view_count,
            t.reply_count, t.vote_count, t.last_post_at, t.created_at, c.code AS category_code, c.name AS category_name,
            COALESCE(p.display_name, u.username) AS author_name
       FROM forum_topics t
       JOIN forum_categories c ON c.id = t.category_id
       LEFT JOIN users u ON u.id = t.author_id
       LEFT JOIN user_profiles p ON p.user_id = t.author_id
      ${where}
      ORDER BY t.is_pinned DESC, t.last_post_at DESC, t.id DESC
      LIMIT ? OFFSET ?`,
    [...values, perPage, (page - 1) * perPage],
  );
  const last = rows[rows.length - 1];
  return {
    items: rows.map((row) => ({
      uuid: String(row.uuid),
      slug: String(row.slug),
      title: String(row.title),
      kind: String(row.kind),
      status: String(row.status),
      pinned: Boolean(row.is_pinned),
      locked: Boolean(row.is_locked),
      viewCount: Number(row.view_count ?? 0),
      replyCount: Number(row.reply_count ?? 0),
      voteCount: Number(row.vote_count ?? 0),
      lastPostAt: row.last_post_at ? (row.last_post_at as Date).toISOString() : null,
      createdAt: (row.created_at as Date).toISOString(),
      categoryCode: String(row.category_code),
      categoryName: String(row.category_name),
      authorName: (row.author_name as string | null) ?? 'Member',
    })),
    total,
    page,
    perPage,
    nextCursor: last ? encodeCursor({ id: Number(last.id) }) : null,
    hasMore: page * perPage < total,
  };
}

export async function getTopic(slugOrUuid: string, beforeId?: number) {
  const topic = await queryOne<Row>(
    `SELECT t.*, c.code AS category_code, c.name AS category_name, c.is_moderated,
            COALESCE(p.display_name, u.username) AS author_name
       FROM forum_topics t
       JOIN forum_categories c ON c.id = t.category_id
       LEFT JOIN users u ON u.id = t.author_id
       LEFT JOIN user_profiles p ON p.user_id = t.author_id
      WHERE (t.uuid = ? OR t.slug = ?) AND t.status <> 'deleted'`,
    [slugOrUuid, slugOrUuid],
  );
  if (!topic) throw notFound('Topic');
  await execute('UPDATE forum_topics SET view_count = view_count + 1 WHERE id = ?', [topic.id]).catch(() => undefined);

  const posts = await queryRows<Row>(
    `SELECT fp.id, fp.body, fp.parent_id, fp.vote_count, fp.is_accepted_answer, fp.status, fp.created_at, fp.edited_at,
            fp.author_id, COALESCE(p.display_name, u.username) AS author_name
       FROM forum_posts fp
       LEFT JOIN users u ON u.id = fp.author_id
       LEFT JOIN user_profiles p ON p.user_id = fp.author_id
      WHERE fp.topic_id = ? AND fp.status = 'published' ${beforeId ? 'AND fp.id < ?' : ''}
      ORDER BY fp.id ASC
      LIMIT 50`,
    beforeId ? [topic.id, beforeId] : [topic.id],
  );

  return {
    uuid: String(topic.uuid),
    slug: String(topic.slug),
    title: String(topic.title),
    body: (topic.body as string | null) ?? '',
    kind: String(topic.kind),
    status: String(topic.status),
    pinned: Boolean(topic.is_pinned),
    locked: Boolean(topic.is_locked),
    viewCount: Number(topic.view_count ?? 0) + 1,
    replyCount: Number(topic.reply_count ?? 0),
    voteCount: Number(topic.vote_count ?? 0),
    categoryCode: String(topic.category_code),
    categoryName: String(topic.category_name),
    authorName: (topic.author_name as string | null) ?? 'Member',
    createdAt: (topic.created_at as Date).toISOString(),
    posts: posts.map((row) => ({
      id: Number(row.id),
      body: String(row.body),
      parentId: row.parent_id === null ? null : Number(row.parent_id),
      voteCount: Number(row.vote_count ?? 0),
      accepted: Boolean(row.is_accepted_answer),
      authorName: (row.author_name as string | null) ?? 'Member',
      createdAt: (row.created_at as Date).toISOString(),
      editedAt: row.edited_at ? (row.edited_at as Date).toISOString() : null,
    })),
    hasMore: posts.length === 50,
  };
}

export async function createTopic(userId: number, input: { categoryCode: string; title: string; body: string; kind?: string; language?: string }) {
  const category = await queryOne<Row>('SELECT id, is_moderated, min_trust_band FROM forum_categories WHERE code = ? AND is_active = 1', [
    input.categoryCode,
  ]);
  if (!category) throw notFound('Forum category');
  const trust = await queryOne<Row>('SELECT band FROM trust_scores WHERE user_id = ?', [userId]).catch(() => null);
  const order = ['new', 'bronze', 'silver', 'gold', 'platinum'];
  const needed = String(category.min_trust_band ?? 'new');
  const have = String(trust?.band ?? 'new');
  if (order.indexOf(have) < order.indexOf(needed)) {
    throw forbidden('Your trust level is too new to post in this category');
  }

  const topicUuid = uuid();
  const slug = slugify(input.title);
  const id = await insertAndGetId(
    `INSERT INTO forum_topics (uuid, slug, category_id, author_id, title, body, kind, status, language, last_post_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, 'open', ?, CURRENT_TIMESTAMP)`,
    [topicUuid, slug, category.id, userId, input.title, input.body, input.kind ?? 'discussion', input.language ?? 'en'],
  );
  await execute(`UPDATE forum_categories SET topic_count = topic_count + 1, post_count = post_count + 1 WHERE id = ?`, [category.id]);
  return { uuid: topicUuid, slug, id };
}

export async function createPost(userId: number, topicUuid: string, body: string, parentId?: number) {
  const topic = await queryOne<Row>(
    `SELECT t.id, t.is_locked, t.status, t.category_id FROM forum_topics t WHERE t.uuid = ? OR t.slug = ?`,
    [topicUuid, topicUuid],
  );
  if (!topic) throw notFound('Topic');
  if (topic.is_locked || topic.status === 'closed' || topic.status === 'hidden') {
    throw forbidden('This topic is locked');
  }
  const id = await insertAndGetId(
    `INSERT INTO forum_posts (topic_id, author_id, parent_id, body, status) VALUES (?, ?, ?, ?, 'published')`,
    [topic.id, userId, parentId ?? null, body],
  );
  await execute(
    `UPDATE forum_topics SET reply_count = reply_count + 1, last_post_at = CURRENT_TIMESTAMP, last_post_by = ? WHERE id = ?`,
    [userId, topic.id],
  );
  await execute(`UPDATE forum_categories SET post_count = post_count + 1 WHERE id = ?`, [topic.category_id]);
  return { id };
}

export async function vote(userId: number, kind: 'topic' | 'post', targetId: number, value: 1 | -1 | 0) {
  if (value === 0) {
    await execute(`DELETE FROM forum_votes WHERE target_kind = ? AND target_id = ? AND user_id = ?`, [kind, targetId, userId]);
  } else {
    await execute(
      `INSERT INTO forum_votes (target_kind, target_id, user_id, vote)
       VALUES (?, ?, ?, ?)
       ON DUPLICATE KEY UPDATE vote = VALUES(vote)`,
      [kind, targetId, userId, value],
    );
  }
  const sum = await queryOne<Row>(
    `SELECT COALESCE(SUM(vote), 0) AS total FROM forum_votes WHERE target_kind = ? AND target_id = ?`,
    [kind, targetId],
  );
  if (kind === 'topic') {
    await execute(`UPDATE forum_topics SET vote_count = ? WHERE id = ?`, [Number(sum?.total ?? 0), targetId]);
  } else {
    await execute(`UPDATE forum_posts SET vote_count = ? WHERE id = ?`, [Number(sum?.total ?? 0), targetId]);
  }
  return { voteCount: Number(sum?.total ?? 0) };
}

export async function reportPost(userId: number, postId: number, reasonCode: string, description?: string) {
  const post = await queryOne<Row>('SELECT id FROM forum_posts WHERE id = ?', [postId]);
  if (!post) throw notFound('Post');
  return submitReport({
    reporterId: userId,
    entityType: 'forum_post',
    entityId: postId,
    reasonCode,
    description: description ?? null,
  }).catch(async () => {
    // content_reports accepts forum_post; screening may not. Still record the report.
    const { uuid: makeUuid } = await import('../../core/security/crypto');
    const id = await insertAndGetId(
      `INSERT INTO content_reports (uuid, reporter_id, entity_type, entity_id, reason_code, description, status)
       VALUES (?, ?, 'forum_post', ?, ?, ?, 'pending')`,
      [makeUuid(), userId, postId, reasonCode === 'other' ? 'other' : reasonCode, description ?? null],
    );
    return { reportId: id, queueId: null };
  });
}

export async function searchForum(q: string, limit = 20) {
  if (q.trim().length < 2) throw badRequest('Search query is too short');
  const like = `%${q.replace(/[\\%_]/g, '').slice(0, 80)}%`;
  const rows = await queryRows<Row>(
    `SELECT uuid, slug, title, reply_count, last_post_at
       FROM forum_topics
      WHERE status IN ('open','answered','closed') AND (title LIKE ? OR body LIKE ?)
      ORDER BY last_post_at DESC LIMIT ?`,
    [like, like, limit],
  );
  return rows.map((row) => ({
    uuid: String(row.uuid),
    slug: String(row.slug),
    title: String(row.title),
    replyCount: Number(row.reply_count ?? 0),
    lastPostAt: row.last_post_at ? (row.last_post_at as Date).toISOString() : null,
  }));
}
