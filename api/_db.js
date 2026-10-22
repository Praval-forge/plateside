const fs = require('fs');
const FILE = '/tmp/plateside-db.json';

const empty = () => ({ clients: {}, meals: [] });
const useBlob = !!process.env.BLOB_READ_WRITE_TOKEN;

async function load() {
  if (useBlob) {
    const { list } = require('@vercel/blob');
    const r = await list({ prefix: 'db-' });
    const latest = r.blobs.filter(x => /^db-\d+\.json$/.test(x.pathname)).sort((a, b) => b.pathname.localeCompare(a.pathname))[0];
    if (!latest) {
      const old = (await list({ prefix: 'plateside-db' })).blobs[0];
      if (!old) return empty();
      const o = await fetch(old.url + '?t=' + Date.now(), { cache: 'no-store' });
      return o.ok ? o.json() : empty();
    }
    const res = await fetch(latest.url, { cache: 'no-store' });
    return res.ok ? res.json() : empty();
  }
  try { return JSON.parse(fs.readFileSync(FILE, 'utf8')); } catch { return empty(); }
}
async function save(db) {
  if (useBlob) {
    const { put, list, del } = require('@vercel/blob');
    const name = 'db-' + String(Date.now()).padStart(15, '0') + '.json';
    await put(name, JSON.stringify(db), { access: 'public', addRandomSuffix: false, contentType: 'application/json' });
    const r = await list({ prefix: 'db-' });
    const old = r.blobs.filter(x => x.pathname !== name && x.pathname < name).map(x => x.url);
    if (old.length) await del(old);
    return;
  }
  fs.writeFileSync(FILE, JSON.stringify(db));
}
const IST = 'Asia/Kolkata';
const dayOf = (ts) => new Date(ts).toLocaleDateString('en-CA', { timeZone: IST });
const totals = (meals) => meals.reduce((a, m) => {
  for (const i of m.items) { a.kcal += +i.kcal || 0; a.protein += +i.protein || 0; a.carbs += +i.carbs || 0; a.fat += +i.fat || 0; }
  return a;
}, { kcal: 0, protein: 0, carbs: 0, fat: 0 });
const body = async (req) => {
  if (req.body && typeof req.body === 'object') return req.body;
  let s = ''; for await (const c of req) s += c; try { return JSON.parse(s || '{}'); } catch { return {}; }
};
module.exports = { load, save, dayOf, totals, body };
