/**
 * Production seed filtering.
 *
 * The seed files mix two very different kinds of data. Most is *required* for
 * the application to function — roles, permissions, marketplaces, currencies,
 * categories, subscription plans, notification templates. Interleaved with it
 * are demo accounts and fake listings, including staff logins whose password is
 * written in a comment at the top of the file.
 *
 * Rather than maintain a duplicate set of production seed files that would
 * drift from the originals, production mode filters at statement level. Kept in
 * its own module so the rules are unit-testable: a regression here would put
 * known-password administrator accounts into a live database.
 */

/**
 * Tables whose seeded rows are demo fixtures rather than reference data.
 *
 * The rule for adding to this list: does a row represent a person, a company,
 * or a listing? Reference tables (roles, permissions, categories, plans,
 * templates, currencies) are deliberately absent — production needs them.
 */
export const DEMO_TABLES: ReadonlySet<string> = new Set([
  'users',
  'user_profiles',
  'user_roles',
  'user_role_assignments',
  'user_identities',
  'listings',
  'gold_listing_details',
  'property_listing_details',
  'vehicle_listing_details',
  'listing_media',
  'listing_assignments',
  'favorites',
  'favorite_collections',
  'business_profiles',
  'business_departments',
  'business_teams',
  'business_members',
  'business_team_members',
  'sales_leads',
  'sales_targets',
  'support_agents',
]);

/**
 * Credential markers that must never reach a production database.
 *
 * A second line of defence: if a demo row is ever added to a table that is not
 * on the list above, the credential itself still blocks the statement.
 */
export const DEMO_CREDENTIAL_MARKERS: readonly RegExp[] = [
  /aurelia\.test/i,
  /Password123/i,
  /scrypt\$\d+\$/i,
];

/**
 * Removes leading comments and whitespace from a statement.
 *
 * The seed splitter breaks on `;` and keeps everything in between, so a
 * statement routinely arrives as:
 *
 *   -- ---------------------------------
 *   -- 3. Demo staff accounts (ids 9301+)
 *   -- ---------------------------------
 *   INSERT INTO users (...) VALUES (...)
 *
 * Anchoring a match at the start of that string fails, which would have let a
 * commented demo INSERT through the table denylist entirely.
 */
export function stripLeadingComments(statement: string): string {
  let remaining = statement.trimStart();

  for (;;) {
    if (remaining.startsWith('--') || remaining.startsWith('#')) {
      const newline = remaining.indexOf('\n');
      if (newline === -1) return '';
      remaining = remaining.slice(newline + 1).trimStart();
      continue;
    }
    if (remaining.startsWith('/*')) {
      const close = remaining.indexOf('*/');
      if (close === -1) return '';
      remaining = remaining.slice(close + 2).trimStart();
      continue;
    }
    return remaining;
  }
}

/** The table an INSERT targets, or null if the statement is not an INSERT. */
export function targetTableOf(statement: string): string | null {
  const match = /^INSERT\s+(?:IGNORE\s+)?INTO\s+[`"]?(\w+)[`"]?/i.exec(stripLeadingComments(statement));
  return match ? match[1]!.toLowerCase() : null;
}

/** Whether a statement is an INSERT once comments are discounted. */
export function isInsert(statement: string): boolean {
  return /^INSERT\s+/i.test(stripLeadingComments(statement));
}

/**
 * Why a statement must not run against production, or null to allow it.
 */
export function productionSkipReason(statement: string): string | null {
  const table = targetTableOf(statement);
  if (table && DEMO_TABLES.has(table)) return `demo table \`${table}\``;

  for (const marker of DEMO_CREDENTIAL_MARKERS) {
    if (marker.test(statement)) return `demo credential (${marker.source})`;
  }
  return null;
}
