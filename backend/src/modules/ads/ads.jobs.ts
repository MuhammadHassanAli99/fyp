import { execute, queryRows, type Row } from '../../db/query';
import { toNumber } from '../../db/sql';

export async function activateScheduledCampaigns(): Promise<number> {
  const result = await execute(
    `UPDATE ad_campaigns
        SET status = 'active'
      WHERE status IN ('scheduled','approved')
        AND (starts_at IS NULL OR starts_at <= CURRENT_TIMESTAMP)
        AND (ends_at IS NULL OR ends_at >= CURRENT_TIMESTAMP)`,
  );
  return Number(result.affectedRows ?? 0);
}

export async function completeExpiredCampaigns(): Promise<number> {
  const result = await execute(
    `UPDATE ad_campaigns
        SET status = 'completed'
      WHERE status IN ('active','paused','scheduled')
        AND ends_at IS NOT NULL AND ends_at < CURRENT_TIMESTAMP`,
  );
  return Number(result.affectedRows ?? 0);
}

export async function exhaustBudgets(): Promise<number> {
  const result = await execute(
    `UPDATE ad_campaigns
        SET status = 'exhausted'
      WHERE status = 'active'
        AND total_budget IS NOT NULL AND spent_amount >= total_budget`,
  );
  return Number(result.affectedRows ?? 0);
}

export async function rollupDailyStats(day = new Date()): Promise<number> {
  const date = day.toISOString().slice(0, 10);
  const rows = await queryRows<Row>(
    `SELECT campaign_id, creative_id, placement_id,
            COUNT(*) AS impressions,
            SUM(is_viewable = 1 AND is_invalid = 0) AS viewable_impressions,
            SUM(cost) AS spend
       FROM ad_impressions
      WHERE DATE(created_at) = ?
      GROUP BY campaign_id, creative_id, placement_id`,
    [date],
  );
  const clicks = await queryRows<Row>(
    `SELECT campaign_id, creative_id, placement_id, COUNT(*) AS clicks, SUM(cost) AS spend
       FROM ad_clicks
      WHERE DATE(created_at) = ? AND is_invalid = 0
      GROUP BY campaign_id, creative_id, placement_id`,
    [date],
  );
  const conversions = await queryRows<Row>(
    `SELECT campaign_id, creative_id, COUNT(*) AS conversions
       FROM ad_conversions
      WHERE DATE(created_at) = ?
      GROUP BY campaign_id, creative_id`,
    [date],
  );

  const clickMap = new Map<string, Row>();
  for (const row of clicks) {
    clickMap.set(`${row.campaign_id}:${row.creative_id}:${row.placement_id}`, row);
  }
  const convMap = new Map<string, number>();
  for (const row of conversions) {
    convMap.set(`${row.campaign_id}:${row.creative_id}`, Number(row.conversions));
  }

  let written = 0;
  for (const row of rows) {
    const key = `${row.campaign_id}:${row.creative_id}:${row.placement_id}`;
    const click = clickMap.get(key);
    const clickCount = Number(click?.clicks ?? 0);
    const impressions = Number(row.impressions ?? 0);
    const spend = (toNumber(row.spend) ?? 0) + (toNumber(click?.spend) ?? 0);
    const ctr = impressions > 0 ? (clickCount / impressions) * 100 : 0;
    const cpc = clickCount > 0 ? spend / clickCount : null;
    const cpm = impressions > 0 ? (spend / impressions) * 1000 : null;
    await execute(
      `INSERT INTO ad_daily_stats
         (campaign_id, creative_id, placement_id, stat_date, impressions, viewable_impressions, clicks, conversions, spend, currency, ctr, cpc, cpm)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'USD', ?, ?, ?)
       ON DUPLICATE KEY UPDATE
         impressions = VALUES(impressions),
         viewable_impressions = VALUES(viewable_impressions),
         clicks = VALUES(clicks),
         conversions = VALUES(conversions),
         spend = VALUES(spend),
         ctr = VALUES(ctr),
         cpc = VALUES(cpc),
         cpm = VALUES(cpm)`,
      [
        row.campaign_id,
        row.creative_id,
        row.placement_id,
        date,
        impressions,
        Number(row.viewable_impressions ?? 0),
        clickCount,
        convMap.get(`${row.campaign_id}:${row.creative_id}`) ?? 0,
        spend,
        ctr.toFixed(4),
        cpc,
        cpm,
      ],
    );
    written += 1;
  }
  return written;
}

export async function runAdJobs(): Promise<{ scheduled: number; completed: number; exhausted: number; rollup: number }> {
  const scheduled = await activateScheduledCampaigns();
  const completed = await completeExpiredCampaigns();
  const exhausted = await exhaustBudgets();
  const rollup = await rollupDailyStats();
  return { scheduled, completed, exhausted, rollup };
}
