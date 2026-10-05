import { closePool } from '../db/pool';
import { runPlatformAnalyticsRollup } from '../modules/analytics/analytics.rollup';

const days = Number(process.argv[2] ?? '7');
const count = Number.isFinite(days) && days > 0 ? Math.min(days, 30) : 7;

async function main(): Promise<void> {
  for (let offset = 0; offset < count; offset += 1) {
    const date = new Date();
    date.setUTCDate(date.getUTCDate() - offset);
    const day = date.toISOString().slice(0, 10);
    const result = await runPlatformAnalyticsRollup(day);
    console.log(JSON.stringify(result));
  }
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => closePool());
