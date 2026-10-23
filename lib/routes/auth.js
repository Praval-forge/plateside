const { schemas, parse } = require('../validate');
const { hashPassword, verifyPassword, dummyHash, sha256, newToken, newInviteCode, rateLimit } = require('../security');
const { SESSION_DAYS } = require('../http');
const { bad, conflict, unauthorized, forbidden } = require('../errors');
const { publicUser } = require('../services');

async function startSession(ctx, userId) {
  const token = newToken();
  await ctx.db.query('insert into sessions(user_id, token_hash, user_agent, expires_at) values ($1,$2,$3, now() + make_interval(days => $4::int))',
    [userId, sha256(token), String(ctx.req.headers['user-agent'] || '').slice(0, 200), SESSION_DAYS]);
  ctx.setSession(token);
}

async function register(ctx) {
  await rateLimit(ctx.db, `reg:${ctx.ip}`, 10, 3600);
  const b = parse(schemas.register, await ctx.body());
  let coachId = null;
  if (b.inviteCode) {
    if (b.role !== 'client') throw bad('Only clients use invite codes.');
    const c = await ctx.db.query("select id from users where invite_code = $1 and role = 'coach'", [b.inviteCode]);
    if (!c.rows.length) throw bad('We could not find that invite code. Check it with your coach.', { field: 'inviteCode' });
    coachId = c.rows[0].id;
  }
  const hash = await hashPassword(b.password);
  let user;
  try {
    const r = await ctx.db.query(
      `insert into users(email, name, password_hash, role, coach_id, invite_code, timezone) values ($1,$2,$3,$4,$5,$6,$7) returning *`,
      [b.email, b.name, hash, b.role, coachId, b.role === 'coach' ? newInviteCode() : null, b.timezone || 'Asia/Kolkata']);
    user = r.rows[0];
  } catch (e) {
    if (/users_email_lower|duplicate key/.test(e.message)) throw conflict('An account with that email already exists. Try signing in.');
    throw e;
  }
  await startSession(ctx, user.id);
  return { user: publicUser(user) };
}

async function login(ctx) {
  const b = parse(schemas.login, await ctx.body());
  await rateLimit(ctx.db, `login-ip:${ctx.ip}`, 40, 900);
  await rateLimit(ctx.db, `login-email:${b.email}`, 10, 900);
  const { rows } = await ctx.db.query('select * from users where lower(email) = $1', [b.email]);
  const u = rows[0];
  const ok = u ? await verifyPassword(b.password, u.password_hash) : (await verifyPassword(b.password, await dummyHash()), false);
  if (!ok) throw unauthorized('Incorrect email or password.');
  await ctx.db.query('update users set last_login_at = now() where id = $1', [u.id]);
  await startSession(ctx, u.id);
  return { user: publicUser(u) };
}

async function logout(ctx) {
  await ctx.db.query('delete from sessions where token_hash = $1', [sha256(ctx.sessionToken)]);
  ctx.clearSession();
}

module.exports = [
  ['POST', '/auth/register', register, { auth: false }],
  ['POST', '/auth/login', login, { auth: false }],
  ['POST', '/auth/logout', logout],
];
module.exports.startSession = startSession;
