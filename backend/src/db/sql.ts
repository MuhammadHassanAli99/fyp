/**
 * A deliberately small SQL builder.
 *
 * The rule it enforces: **column names come from code, values come from
 * placeholders.** Filters arrive from user query strings, so every value goes
 * through `?` and every identifier must be supplied by the caller from a
 * whitelist. There is no string interpolation of user input anywhere.
 */

export type SqlValue = string | number | boolean | null | Date | Buffer;

export class WhereBuilder {
  private readonly clauses: string[] = [];
  private readonly params: SqlValue[] = [];

  /** Raw condition with its own placeholders. `column` must be code-controlled. */
  raw(condition: string, ...values: SqlValue[]): this {
    this.clauses.push(condition);
    this.params.push(...values);
    return this;
  }

  eq(column: string, value: SqlValue | undefined | null): this {
    if (value === undefined || value === null) return this;
    return this.raw(`${column} = ?`, value);
  }

  not(column: string, value: SqlValue | undefined | null): this {
    if (value === undefined || value === null) return this;
    return this.raw(`${column} <> ?`, value);
  }

  gte(column: string, value: SqlValue | undefined | null): this {
    if (value === undefined || value === null) return this;
    return this.raw(`${column} >= ?`, value);
  }

  lte(column: string, value: SqlValue | undefined | null): this {
    if (value === undefined || value === null) return this;
    return this.raw(`${column} <= ?`, value);
  }

  between(column: string, min: SqlValue | undefined | null, max: SqlValue | undefined | null): this {
    this.gte(column, min);
    this.lte(column, max);
    return this;
  }

  in(column: string, values: readonly SqlValue[] | undefined | null): this {
    if (!values || values.length === 0) return this;
    const placeholders = values.map(() => '?').join(', ');
    return this.raw(`${column} IN (${placeholders})`, ...values);
  }

  notIn(column: string, values: readonly SqlValue[] | undefined | null): this {
    if (!values || values.length === 0) return this;
    const placeholders = values.map(() => '?').join(', ');
    return this.raw(`${column} NOT IN (${placeholders})`, ...values);
  }

  /** Prefix match only — leading wildcards cannot use an index. */
  startsWith(column: string, value: string | undefined | null): this {
    if (!value) return this;
    return this.raw(`${column} LIKE ?`, `${escapeLike(value)}%`);
  }

  contains(column: string, value: string | undefined | null): this {
    if (!value) return this;
    return this.raw(`${column} LIKE ?`, `%${escapeLike(value)}%`);
  }

  bool(column: string, value: boolean | undefined | null): this {
    if (value === undefined || value === null) return this;
    return this.raw(`${column} = ?`, value ? 1 : 0);
  }

  isNull(column: string): this {
    return this.raw(`${column} IS NULL`);
  }

  isNotNull(column: string): this {
    return this.raw(`${column} IS NOT NULL`);
  }

  /** Only apply the nested group when it produced conditions. */
  group(build: (builder: WhereBuilder) => void, joiner: 'AND' | 'OR' = 'OR'): this {
    const nested = new WhereBuilder();
    build(nested);
    if (nested.clauses.length === 0) return this;
    this.clauses.push(`(${nested.clauses.join(` ${joiner} `)})`);
    this.params.push(...nested.params);
    return this;
  }

  /** MySQL FULLTEXT search in boolean mode (§9). */
  fullText(columns: readonly string[], term: string | undefined | null): this {
    if (!term || term.trim().length === 0) return this;
    return this.raw(`MATCH(${columns.join(', ')}) AGAINST (? IN BOOLEAN MODE)`, toBooleanModeQuery(term));
  }

  /**
   * Bounding-box prefilter for radius search (§11). Cheap, index-friendly, and
   * then refined by an exact haversine expression in the SELECT/HAVING.
   */
  withinBoundingBox(latColumn: string, lngColumn: string, lat: number, lng: number, radiusKm: number): this {
    const latDelta = radiusKm / 111.32;
    const lngDelta = radiusKm / (111.32 * Math.max(Math.cos((lat * Math.PI) / 180), 0.01));
    return this.raw(
      `${latColumn} BETWEEN ? AND ? AND ${lngColumn} BETWEEN ? AND ?`,
      lat - latDelta,
      lat + latDelta,
      lng - lngDelta,
      lng + lngDelta,
    );
  }

  get isEmpty(): boolean {
    return this.clauses.length === 0;
  }

  /** `WHERE a = ? AND b > ?` — or an empty string when there are no clauses. */
  build(joiner: 'AND' | 'OR' = 'AND'): { sql: string; params: SqlValue[] } {
    if (this.clauses.length === 0) return { sql: '', params: [] };
    return { sql: `WHERE ${this.clauses.join(` ${joiner} `)}`, params: [...this.params] };
  }

  /** `a = ? AND b > ?` without the WHERE keyword, for embedding in HAVING/ON. */
  buildConditions(joiner: 'AND' | 'OR' = 'AND'): { sql: string; params: SqlValue[] } {
    if (this.clauses.length === 0) return { sql: '1 = 1', params: [] };
    return { sql: this.clauses.join(` ${joiner} `), params: [...this.params] };
  }
}

export const where = () => new WhereBuilder();

/** Escapes LIKE metacharacters so a user's `%` is treated literally. */
export const escapeLike = (value: string): string => value.replace(/[\\%_]/g, (match) => `\\${match}`);

/**
 * Turns free text into safe FULLTEXT boolean-mode syntax: strips operators that
 * would let a user craft a query, then requires every remaining word as a prefix.
 */
export function toBooleanModeQuery(term: string): string {
  const words = term
    .replace(/[+\-><()~*"@]/g, ' ')
    .split(/\s+/)
    .map((word) => word.replace(/[^\p{L}\p{N}]/gu, '').trim())
    .filter((word) => word.length > 1)
    .slice(0, 12);
  if (words.length === 0) return term.replace(/[+\-><()~*"@]/g, ' ').trim().slice(0, 64);
  return words.map((word) => `+${word}*`).join(' ');
}

/** Distance in km between a fixed point and a row's coordinates. */
export const haversineExpression = (latColumn: string, lngColumn: string): string =>
  `(6371 * ACOS(LEAST(1, COS(RADIANS(?)) * COS(RADIANS(${latColumn})) * COS(RADIANS(${lngColumn}) - RADIANS(?)) + SIN(RADIANS(?)) * SIN(RADIANS(${latColumn})))))`;

/**
 * Builds `INSERT INTO t (a, b) VALUES (?, ?)` from an object, skipping
 * undefined so partial payloads do not overwrite columns with NULL.
 */
export function buildInsert(table: string, data: Record<string, SqlValue | undefined>): { sql: string; params: SqlValue[] } {
  const entries = Object.entries(data).filter((entry): entry is [string, SqlValue] => entry[1] !== undefined);
  if (entries.length === 0) throw new Error(`buildInsert(${table}) received no defined columns`);
  const columns = entries.map(([column]) => column);
  const placeholders = entries.map(() => '?');
  return {
    sql: `INSERT INTO ${table} (${columns.join(', ')}) VALUES (${placeholders.join(', ')})`,
    params: entries.map(([, value]) => value),
  };
}

export function buildBulkInsert(
  table: string,
  columns: readonly string[],
  rows: ReadonlyArray<ReadonlyArray<SqlValue>>,
): { sql: string; params: SqlValue[] } {
  if (rows.length === 0) throw new Error(`buildBulkInsert(${table}) received no rows`);
  const rowPlaceholder = `(${columns.map(() => '?').join(', ')})`;
  return {
    sql: `INSERT INTO ${table} (${columns.join(', ')}) VALUES ${rows.map(() => rowPlaceholder).join(', ')}`,
    params: rows.flat() as SqlValue[],
  };
}

/** `UPDATE t SET a = ?, b = ?` — returns null when there is nothing to update. */
export function buildUpdate(
  table: string,
  data: Record<string, SqlValue | undefined>,
): { sql: string; params: SqlValue[] } | null {
  const entries = Object.entries(data).filter((entry): entry is [string, SqlValue] => entry[1] !== undefined);
  if (entries.length === 0) return null;
  return {
    sql: `UPDATE ${table} SET ${entries.map(([column]) => `${column} = ?`).join(', ')}`,
    params: entries.map(([, value]) => value),
  };
}

/** Upsert for counters and rollups. */
export function buildUpsert(
  table: string,
  data: Record<string, SqlValue | undefined>,
  updateColumns: readonly string[],
): { sql: string; params: SqlValue[] } {
  const insert = buildInsert(table, data);
  const updates = updateColumns.map((column) => `${column} = VALUES(${column})`).join(', ');
  return { sql: `${insert.sql} ON DUPLICATE KEY UPDATE ${updates}`, params: insert.params };
}

/** MySQL DATETIME literal in UTC. */
export const toSqlDate = (value: Date | string | number | null | undefined): string | null => {
  if (value === null || value === undefined) return null;
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return date.toISOString().slice(0, 19).replace('T', ' ');
};

/** DECIMAL columns arrive as strings; convert only where a number is wanted. */
export const toNumber = (value: unknown): number | null => {
  if (value === null || value === undefined) return null;
  const parsed = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(parsed) ? parsed : null;
};

export const toBoolean = (value: unknown): boolean => value === 1 || value === true || value === '1';

export const toJson = <T>(value: unknown, fallback: T): T => {
  if (value === null || value === undefined) return fallback;
  if (typeof value === 'object') return value as T;
  try {
    return JSON.parse(String(value)) as T;
  } catch {
    return fallback;
  }
};
