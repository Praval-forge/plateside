const crypto = require('crypto');
const { promisify } = require('util');
const scrypt = promisify(crypto.scrypt);
const { tooMany } = require('./errors');

const N = 16384, r = 8, p = 1, KEYLEN = 64;
async function hashPassword(pw) {
  const salt = crypto.randomBytes(16);
  const h = await scrypt(pw, salt, KEYLEN, { N, r, p });
  return `scrypt$${N}$${r}$${p}$${salt.toString('base64')}$${h.toString('base64')}`;
}
async function verifyPassword(pw, stored) {
  const [alg, n, rr, pp, salt, hash] = String(stored).split('$');
  if (alg !== 'scrypt') return false;
  const want = Buffer.from(hash, 'base64');
  const got = await scrypt(pw, Buffer.from(salt, 'base64'), want.length, { N: +n, r: +rr, p: +pp });
  return crypto.timingSafeEqual(want, got);
}
// Used so that "unknown email" costs the same time as "wrong password".
let dummy;
const dummyHash = () => (dummy = dummy || hashPassword('not-a-real-password'));

const sha256 = (s) => crypto.createHash('sha256').update(s).digest('hex');
const newToken = () => crypto.randomBytes(32).toString('base64url');
const INVITE_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789'; // no look-alikes (0/O, 1/I/L)
const newInviteCode = () => Array.from(crypto.randomBytes(8), b => INVITE_ALPHABET[b % INVITE_ALPHABET.length]).join('');

// Fixed-window rate limiter backed by the database, so it works across serverless instances.
async function rateLimit(db, key, limit, windowSec) {
  const win = new Date(Math.floor(Date.now() / (windowSec * 1000)) * windowSec * 1000);
  const { rows } = await db.query(
    'insert into rate_limits(key, window_start, count) values ($1,$2,1) on conflict (key, window_start) do update set count = rate_limits.count + 1 returning count',
    [key, win.toISOString()]);
  if (Math.random() < 0.02) db.query("delete from rate_limits where window_start < now() - interval '2 days'").catch(() => {});
  if (rows[0].count > limit) throw tooMany();
}
module.exports = { hashPassword, verifyPassword, dummyHash, sha256, newToken, newInviteCode, rateLimit };
