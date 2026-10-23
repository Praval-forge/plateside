const crypto = require('crypto');
const { AppError, bad, unauthorized, forbidden } = require('./errors');
const { getDb } = require('./db');
const { sha256 } = require('./security');

const COOKIE = 'pl_session';
const SESSION_DAYS = 30;
const MAX_BODY = 3_500_000;

const SECURITY_HEADERS = {
  'Content-Security-Policy': "default-src 'self'; img-src 'self' data: blob:; style-src 'self' 'unsafe-inline'; script-src 'self'; connect-src 'self'; manifest-src 'self'; frame-ancestors 'none'; base-uri 'self'; form-action 'self'",
  'X-Content-Type-Options': 'nosniff',
  'X-Frame-Options': 'DENY',
  'Referrer-Policy': 'strict-origin-when-cross-origin',
  'Permissions-Policy': 'camera=(self), microphone=(), geolocation=()',
};

function parseCookies(h) {
  const out = {};
  for (const part of String(h || '').split(';')) {
    const i = part.indexOf('=');
    if (i > 0) out[part.slice(0, i).trim()] = decodeURIComponent(part.slice(i + 1).trim());
  }
  return out;
}

async function readBody(req) {
  if (req.method === 'GET' || req.method === 'HEAD') return {};
  if (req.body !== undefined && req.body !== null) {
    const b = Buffer.isBuffer(req.body) ? req.body.toString('utf8') : req.body;
    if (typeof b === 'string') { try { return b ? JSON.parse(b) : {}; } catch { throw bad('Request body must be valid JSON.'); } }
    return b;
  }
  let size = 0; const chunks = [];
  for await (const c of req) { size += c.length; if (size > MAX_BODY) throw new AppError(413, 'too_large', 'That upload is too large. Try a smaller photo.'); chunks.push(c); }
  const s = Buffer.concat(chunks).toString('utf8');
  try { return s ? JSON.parse(s) : {}; } catch { throw bad('Request body must be valid JSON.'); }
}

function clientIp(req) {
  const xf = String(req.headers['x-forwarded-for'] || '').split(',')[0].trim();
  return req.headers['x-real-ip'] || xf || (req.socket && req.socket.remoteAddress) || 'unknown';
}

// Reject cross-site state-changing requests (defence in depth on top of SameSite=Lax cookies).
function checkOrigin(req) {
  if (['GET', 'HEAD', 'OPTIONS'].includes(req.method)) return;
  const site = req.headers['sec-fetch-site'];
  if (site && !['same-origin', 'none'].includes(site)) throw forbidden('Cross-site requests are not allowed.');
  const origin = req.headers.origin;
  if (origin) {
    let host; try { host = new URL(origin).host; } catch { throw forbidden('Bad origin.'); }
    const mine = req.headers['x-forwarded-host'] || req.headers.host;
    if (host !== mine) throw forbidden('Cross-site requests are not allowed.');
  }
}

function createApp(routes) {
  const table = routes.map(([method, pattern, handler, opts = {}]) => {
    const keys = [];
    const re = new RegExp('^' + pattern.replace(/:([a-z]+)/gi, (_, k) => { keys.push(k); return '([^/]+)'; }) + '/?$');
    return { method, re, keys, handler, opts };
  });

  return async function handle(req, res) {
    const started = Date.now();
    const id = crypto.randomUUID().slice(0, 8);
    const url = new URL(req.url, 'http://x');
    let path = url.pathname;
    const rewritten = url.searchParams.get('__p');
    if (rewritten !== null) path = '/api/' + rewritten.replace(/^\/+/, '');
    path = path.replace(/^\/api(?=\/|$)/, '') || '/';
    const secure = (req.headers['x-forwarded-proto'] || 'http').split(',')[0] === 'https';
    let status = 500, userId = null;

    const send = (code, payload, headers = {}) => {
      status = code;
      for (const [k, v] of Object.entries({ ...SECURITY_HEADERS, 'Cache-Control': 'no-store', 'X-Request-Id': id, ...headers })) res.setHeader(k, v);
      if (Buffer.isBuffer(payload)) { res.statusCode = code; return res.end(payload); }
      res.statusCode = code;
      res.setHeader('Content-Type', 'application/json; charset=utf-8');
      res.end(JSON.stringify(payload));
    };

    try {
      checkOrigin(req);
      const route = table.find(r => r.method === req.method && r.re.test(path));
      if (!route) {
        if (table.some(r => r.re.test(path))) throw new AppError(405, 'method_not_allowed', 'Method not allowed.');
        throw new AppError(404, 'not_found', 'Unknown endpoint.');
      }
      const m = route.re.exec(path);
      const params = Object.fromEntries(route.keys.map((k, i) => [k, decodeURIComponent(m[i + 1])]));
      const db = await getDb();
      const cookies = parseCookies(req.headers.cookie);

      const ctx = {
        req, res, db, params, id, ip: clientIp(req), query: Object.fromEntries(url.searchParams), user: null, secure,
        body: () => readBody(req),
        setSession(token) {
          res.setHeader('Set-Cookie', `${COOKIE}=${token}; HttpOnly; SameSite=Lax; Path=/; Max-Age=${SESSION_DAYS * 86400}${secure ? '; Secure' : ''}`);
        },
        clearSession() {
          res.setHeader('Set-Cookie', `${COOKIE}=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0${secure ? '; Secure' : ''}`);
        },
        sessionToken: cookies[COOKIE],
      };

      if (route.opts.auth !== false) {
        if (!ctx.sessionToken) throw unauthorized();
        const { rows } = await db.query(
          `select u.*, s.id as session_id from sessions s join users u on u.id = s.user_id
           where s.token_hash = $1 and s.expires_at > now()`, [sha256(ctx.sessionToken)]);
        if (!rows.length) { ctx.clearSession(); throw unauthorized('Your session has expired. Please sign in again.'); }
        ctx.user = rows[0];
        userId = ctx.user.id;
        const need = route.opts.auth;
        if ((need === 'coach' || need === 'client') && ctx.user.role !== need) throw forbidden(`This is only available to ${need}s.`);
      }

      const out = await route.handler(ctx);
      if (out && out.raw) return send(out.status || 200, out.body, out.headers);
      return send(200, out === undefined ? { ok: true } : out);
    } catch (e) {
      if (e instanceof AppError) {
        send(e.status, { error: { code: e.code, message: e.message, ...(e.details ? { details: e.details } : {}) } });
      } else {
        console.error(JSON.stringify({ level: 'error', id, msg: 'unhandled', err: e.message, stack: String(e.stack).split('\n').slice(0, 4) }));
        const noDb = /DATABASE|ECONNREFUSED|ENOTFOUND|connect/i.test(e.message);
        send(noDb ? 503 : 500, { error: { code: noDb ? 'unavailable' : 'internal', message: noDb ? 'The service is temporarily unavailable. Please try again shortly.' : 'Something went wrong on our side. Please try again.' } });
      }
    } finally {
      console.log(JSON.stringify({ level: 'info', id, method: req.method, path, status, ms: Date.now() - started, user: userId }));
    }
  };
}
module.exports = { createApp, SECURITY_HEADERS, COOKIE, SESSION_DAYS };
