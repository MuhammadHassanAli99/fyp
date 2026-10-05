import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  cursorFromFeedRow,
  decodeCursor,
  encodeCursor,
  keysetClause,
} from './pagination';

describe('pagination cursors', () => {
  it('round-trips keyset fields', () => {
    const encoded = encodeCursor({
      id: 42,
      featured: 1,
      rank: 12.5,
      bump: '2026-08-19T12:00:00.000Z',
    });
    const decoded = decodeCursor(encoded);
    assert.equal(decoded.id, 42);
    assert.equal(decoded.featured, 1);
    assert.equal(decoded.rank, 12.5);
    assert.equal(decoded.bump, '2026-08-19T12:00:00.000Z');
  });

  it('rejects malformed cursors', () => {
    assert.throws(() => decodeCursor('not-base64'));
  });

  it('builds the default feed keyset predicate', () => {
    const clause = keysetClause([], {
      id: 9,
      featured: 1,
      rank: 10,
      bump: '2026-08-19T12:00:00.000Z',
    });
    assert.ok(clause);
    assert.match(clause.sql, /l\.is_featured/);
    assert.equal(clause.params.at(-1), 9);
  });

  it('builds a single-column DESC keyset', () => {
    const clause = keysetClause([{ field: 'l.price_base', direction: 'DESC' }], {
      id: 3,
      value: 1500,
    });
    assert.ok(clause);
    assert.match(clause.sql, /l\.price_base/);
    assert.deepEqual(clause.params, [1500, 1500, 3]);
  });

  it('encodes a feed row for newest sort', () => {
    const cursor = cursorFromFeedRow(
      { id: 8, cursor_sort_value: new Date('2026-01-02T00:00:00.000Z') },
      [{ field: 'COALESCE(l.bump_at, l.published_at, l.created_at)', direction: 'DESC' }],
    );
    assert.equal(cursor.id, 8);
    assert.equal(cursor.value, '2026-01-02T00:00:00.000Z');
  });
});
