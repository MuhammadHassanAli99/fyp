import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { describe, it } from 'node:test';
import { isInsert, productionSkipReason, targetTableOf } from './seed-filter';

describe('production seed filter', () => {
  it('allows reference and system data', () => {
    const allowed = [
      "INSERT INTO countries (code, name) VALUES ('PK', 'Pakistan')",
      "INSERT INTO currencies (code, symbol) VALUES ('USD', '$')",
      "INSERT INTO roles (id, code, name) VALUES (1, 'admin', 'Administrator')",
      "INSERT INTO permissions (id, code) VALUES (400, 'admin.view')",
      'INSERT IGNORE INTO role_permissions (role_id, permission_id) SELECT 1, id FROM permissions',
      "INSERT INTO subscription_plans (code, name) VALUES ('free', 'Free')",
      "INSERT INTO notification_templates (code, body) VALUES ('otp', 'Your code')",
      "INSERT INTO categories (code, name) VALUES ('gold-rings', 'Rings')",
    ];
    for (const statement of allowed) {
      assert.equal(productionSkipReason(statement), null, statement);
    }
  });

  it('blocks demo accounts and their supporting rows', () => {
    const blocked = [
      "INSERT INTO users (id, email) VALUES (9301, 'super.admin@aurelia.test')",
      "INSERT INTO user_profiles (user_id, display_name) VALUES (9301, 'Super Admin')",
      'INSERT INTO user_roles (user_id, role_id) VALUES (9301, 1)',
      "INSERT INTO business_profiles (id, name) VALUES (9500, 'Demo Motors')",
      'INSERT INTO listings (id, title) VALUES (9001, 22)',
      'INSERT INTO favorites (user_id, listing_id) VALUES (9001, 9002)',
      'INSERT INTO sales_leads (business_id, salesman_id) VALUES (9500, 9308)',
    ];
    for (const statement of blocked) {
      assert.notEqual(productionSkipReason(statement), null, statement);
    }
  });

  it('blocks a demo credential even in an unlisted table', () => {
    const reason = productionSkipReason(
      "INSERT INTO some_future_table (email, hash) VALUES ('demo.seller@aurelia.test', 'scrypt$32768$8$1$abc')",
    );
    assert.match(String(reason), /demo credential/);
  });

  it('parses the target table regardless of quoting or INSERT IGNORE', () => {
    assert.equal(targetTableOf('INSERT INTO `users` (id) VALUES (1)'), 'users');
    assert.equal(targetTableOf('INSERT IGNORE INTO users (id) VALUES (1)'), 'users');
    assert.equal(targetTableOf('  insert into Users (id) values (1)'), 'users');
    assert.equal(targetTableOf('UPDATE users SET id = 1'), null);
  });

  /**
   * The seed splitter breaks on `;` and keeps the preceding comment block, so
   * statements routinely arrive with a comment header. Anchoring the match at
   * the start of the raw string let commented demo INSERTs bypass the denylist.
   */
  it('sees through comment headers to the real statement', () => {
    const commented = [
      '-- ----------------------------\n-- 3. Demo staff accounts (9301+)\n-- ----------------------------\nINSERT INTO users (id) VALUES (9301)',
      '# demo company\nINSERT INTO business_profiles (id) VALUES (9500)',
      '/* block comment */\nINSERT INTO user_roles (user_id) VALUES (9301)',
      '\n\n-- a\n-- b\nINSERT IGNORE INTO favorites (user_id) VALUES (9001)',
    ];
    for (const statement of commented) {
      assert.ok(isInsert(statement), `should be recognised as an INSERT: ${statement.slice(0, 40)}`);
      assert.notEqual(productionSkipReason(statement), null, statement.slice(0, 60));
    }
  });

  it('still allows commented reference data', () => {
    assert.equal(
      productionSkipReason("-- 1. Countries\nINSERT INTO countries (code) VALUES ('PK')"),
      null,
    );
  });

  /**
   * The end-to-end guarantee that matters: run the filter over the real seed
   * files and assert nothing carrying a demo credential survives. This fails if
   * someone adds a demo row to a table that is not on the denylist.
   */
  it('leaves no demo credential in any real seed file', () => {
    const seedsDir = path.resolve(__dirname, '..', '..', '..', 'database', 'seeds');
    if (!fs.existsSync(seedsDir)) return;

    const offenders: string[] = [];
    for (const file of fs.readdirSync(seedsDir).filter((name) => name.endsWith('.sql'))) {
      const sql = fs.readFileSync(path.join(seedsDir, file), 'utf8');
      for (const statement of sql.split(';')) {
        if (!isInsert(statement)) continue;
        if (productionSkipReason(statement) !== null) continue;
        if (/aurelia\.test|Password123|scrypt\$/i.test(statement)) {
          offenders.push(`${file}: ${statement.trim().slice(0, 100)}`);
        }
      }
    }

    assert.deepEqual(offenders, [], `demo data would reach production:\n${offenders.join('\n')}`);
  });

  it('keeps enough of each seed file to be useful in production', () => {
    const seedsDir = path.resolve(__dirname, '..', '..', '..', 'database', 'seeds');
    if (!fs.existsSync(seedsDir)) return;

    // 06_demo_listings and 14_favorites are demo-only by design; everything
    // else must still contribute reference data after filtering.
    const demoOnly = new Set(['06_demo_listings.sql', '14_favorites_platform.sql']);

    for (const file of fs.readdirSync(seedsDir).filter((name) => name.endsWith('.sql'))) {
      if (demoOnly.has(file)) continue;
      const sql = fs.readFileSync(path.join(seedsDir, file), 'utf8');
      const inserts = sql.split(';').filter(isInsert);
      const surviving = inserts.filter((statement) => productionSkipReason(statement) === null);
      assert.ok(
        surviving.length > 0,
        `${file} would contribute nothing to production (${inserts.length} INSERTs, all filtered)`,
      );
    }
  });
});
