// One tiny interface over two Postgres drivers:
//   - DATABASE_URL set  -> node-postgres (production, Neon/Supabase/RDS/...)
//   - otherwise         -> PGlite, an embedded real Postgres (local dev + tests)
const fs = require('fs');
const path = require('path');
let ready;

function open() {
  if (process.env.DATABASE_URL) {
    const { Pool } = require('pg');
    const pool = new Pool({ connectionString: process.env.DATABASE_URL, max: +process.env.PG_POOL_MAX || 3, idleTimeoutMillis: 10000, connectionTimeoutMillis: 8000 });
    pool.on('error', e => console.error(JSON.stringify({ level: 'error', msg: 'pg pool error', err: e.message })));
    const wrap = (c) => ({ query: (t, p) => c.query(t, p), exec: (t) => c.query(t) });
    return Promise.resolve({
      kind: 'pg', ...wrap(pool),
      async tx(fn) {
        const c = await pool.connect();
        try { await c.query('begin'); const r = await fn(wrap(c)); await c.query('commit'); return r; }
        catch (e) { await c.query('rollback').catch(() => {}); throw e; }
        finally { c.release(); }
      },
      close: () => pool.end(),
    });
  }
  return (async () => {
    const { PGlite } = require('@electric-sql/pglite');
    const dir = process.env.PGLITE_DIR;
    if (dir) fs.mkdirSync(dir, { recursive: true });
    const db = new PGlite(dir || undefined);
    await db.waitReady;
    const wrap = (c) => ({ query: (t, p) => c.query(t, p), exec: (t) => c.exec(t) });
    return { kind: 'pglite', ...wrap(db), tx: (fn) => db.transaction((t) => fn(wrap(t))), close: () => db.close() };
  })();
}

async function migrate(db) {
  const dir = path.join(__dirname, '..', 'migrations');
  await db.exec('create table if not exists schema_migrations (name text primary key, applied_at timestamptz not null default now())');
  const files = fs.readdirSync(dir).filter(f => f.endsWith('.sql')).sort();
  for (const f of files) {
    await db.tx(async t => {
      await t.query('select pg_advisory_xact_lock(7357)');
      const done = await t.query('select 1 from schema_migrations where name=$1', [f]);
      if (done.rows.length) return;
      await t.exec(fs.readFileSync(path.join(dir, f), 'utf8'));
      await t.query('insert into schema_migrations(name) values ($1)', [f]);
      console.log(JSON.stringify({ level: 'info', msg: 'migration applied', name: f }));
    });
  }
}

// Lazily connect + migrate once per process (idempotent, guarded by an advisory lock).
function getDb() {
  if (!ready) ready = open().then(async db => { await migrate(db); return db; }).catch(e => { ready = null; throw e; });
  return ready;
}
async function reset() { if (ready) { const d = await ready; await d.close(); ready = null; } }
module.exports = { getDb, migrate, open, reset };
