// Apply pending SQL migrations. Safe to run repeatedly. Usage: DATABASE_URL=... npm run migrate
const { open, migrate } = require('../lib/db');
if (!process.env.DATABASE_URL) { console.log('DATABASE_URL not set; skipping migrations.'); process.exit(0); }
open().then(async db => { await migrate(db); await db.close(); console.log('Migrations up to date.'); })
  .catch(e => { console.error('Migration failed:', e.message); process.exit(1); });
