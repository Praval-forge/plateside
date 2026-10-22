const fs = require('fs');
const FILE = '/tmp/plateside-db.json';
const KEY = 'plateside-db.json';
const empty = () => ({ clients: {}, meals: [] });
const useBlob = !!process.env.BLOB_READ_WRITE_TOKEN;

async function load() {
  if (useBlob) {
    const { list } = require('@vercel/blob');
    const r = await list({ prefix: KEY });
    const b = r.blobs.find(x => x.pathname === KEY);
    if (!b) return empty();
    const res = await fetch(b.url + '?t=' + Date.now(), { cache: 'no-store' });
    return res.ok ? res.json() : empty();
  }
  try { return JSON.parse(fs.readFileSync(FILE, 'utf8')); } catch { return empty(); }
}
async function save(db) {
  if (useBlob) {
    const { put } = require('@vercel/blob');
    await put(KEY, JSON.stringify(db), { access: 'public', addRandomSuffix: false, allowOverwrite: true, contentType: 'application/json', cacheControlMaxAge: 0 });
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
