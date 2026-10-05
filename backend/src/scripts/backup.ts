import { env } from '../config/env';
import { runDevelopmentBackup } from '../modules/security/security.backup';

if (env.isProduction) {
  console.error('Refusing to run the development backup helper in production.');
  process.exit(1);
}

runDevelopmentBackup()
  .then((result) => {
    if (!result) {
      console.error('Backup skipped.');
      process.exit(1);
    }
    console.log(`Encrypted backup written: ${result.file} (${result.bytes} bytes)`);
  })
  .catch((error) => {
    console.error('Backup failed:', error);
    process.exit(1);
  });
