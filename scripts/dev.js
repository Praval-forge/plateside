// Local dev server: static files from public/ plus the real API, backed by an embedded Postgres (PGlite).
// Usage: npm run dev   (set DATABASE_URL to develop against a real Postgres, GEMINI_API_KEY for the real AI)
const http = require('http');
const fs = require('fs');
const path = require('path');

process.env.PGLITE_DIR = process.env.PGLITE_DIR || path.join(__dirname, '..', '.data', 'pglite');
const handler = require('../lib/app');
const { SECURITY_HEADERS } = require('../lib/http');
const { getDb } = require('../lib/db');

const PUBLIC = path.join(__dirname, '..', 'public');
const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png', '.json': 'application/json', '.webmanifest': 'application/manifest+json' };
const PORT = +process.env.PORT || 4173;

http.createServer((req, res) => {
  const p = decodeURIComponent(req.url.split('?')[0]);
  if (p === '/api' || p.startsWith('/api/')) return handler(req, res);
  let file = path.join(PUBLIC, p === '/' ? 'index.html' : p);
  if (!file.startsWith(PUBLIC)) { res.writeHead(403); return res.end(); }
  fs.readFile(file, (e, d) => {
    if (e) { file = path.join(PUBLIC, 'index.html'); d = fs.existsSync(file) ? fs.readFileSync(file) : null; if (!d) { res.writeHead(404); return res.end('not found'); } }
    for (const [k, v] of Object.entries(SECURITY_HEADERS)) res.setHeader(k, v);
    res.setHeader('Content-Type', TYPES[path.extname(file)] || 'application/octet-stream');
    res.setHeader('Cache-Control', 'no-store');
    res.end(d);
  });
}).listen(PORT, async () => {
  await getDb();
  console.log(`Plateside dev server: http://localhost:${PORT}  (db: ${process.env.DATABASE_URL ? 'postgres' : 'embedded PGlite in .data/'})`);
});
