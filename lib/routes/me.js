const { schemas, parse } = require('../validate');
const { hashPassword, verifyPassword, sha256, rateLimit } = require('../security');
const { bad, unauthorized } = require('../errors');
const { publicUser, loadMeals } = require('../services');

async function me(ctx) {
  const { db, user } = ctx;
  const extra = {};
  if (user.role === 'client') {
    const unread = await db.query('select count(*)::int as n from replies r join meals m on m.id = r.meal_id where m.user_id = $1 and r.read_at is null', [user.id]);
    extra.unreadReplies = unread.rows[0].n;
    if (user.coach_id) { const c = await db.query('select id, name from users where id = $1', [user.coach_id]); extra.coach = c.rows[0] || null; }
    else extra.coach = null;
  } else {
    const n = await db.query("select count(*)::int as n from users where coach_id = $1 and role = 'client'", [user.id]);
    extra.clientCount = n.rows[0].n;
  }
  return { user: publicUser(user, extra) };
}

async function update(ctx) {
  const b = parse(schemas.profile, await ctx.body());
  const { rows } = await ctx.db.query(
    'update users set name = coalesce($2, name), goal_kcal = coalesce($3, goal_kcal), timezone = coalesce($4, timezone) where id = $1 returning *',
    [ctx.user.id, b.name ?? null, b.goalKcal ?? null, b.timezone ?? null]);
  return { user: publicUser(rows[0]) };
}

async function changePassword(ctx) {
  const b = parse(schemas.password, await ctx.body());
  if (!(await verifyPassword(b.current, ctx.user.password_hash))) throw unauthorized('Your current password is not correct.');
  await ctx.db.query('update users set password_hash = $2 where id = $1', [ctx.user.id, await hashPassword(b.next)]);
  // sign out every other device
  await ctx.db.query('delete from sessions where user_id = $1 and token_hash <> $2', [ctx.user.id, sha256(ctx.sessionToken)]);
}

async function linkCoach(ctx) {
  if (ctx.user.role !== 'client') throw bad('Only clients can join a coach.');
  await rateLimit(ctx.db, `link:${ctx.user.id}`, 10, 3600);
  const b = parse(schemas.linkCoach, await ctx.body());
  const c = await ctx.db.query("select id, name from users where invite_code = $1 and role = 'coach'", [b.inviteCode]);
  if (!c.rows.length) throw bad('We could not find that invite code. Check it with your coach.', { field: 'inviteCode' });
  await ctx.db.query('update users set coach_id = $2 where id = $1', [ctx.user.id, c.rows[0].id]);
  return { coach: c.rows[0] };
}
async function unlinkCoach(ctx) { await ctx.db.query('update users set coach_id = null where id = $1', [ctx.user.id]); }

async function markRead(ctx) {
  await ctx.db.query('update replies set read_at = now() where read_at is null and meal_id in (select id from meals where user_id = $1)', [ctx.user.id]);
}

async function exportData(ctx) {
  const meals = await loadMeals(ctx.db, 'm.user_id = $1', [ctx.user.id]);
  return { exportedAt: new Date().toISOString(), user: publicUser(ctx.user), meals };
}

async function deleteAccount(ctx) {
  const b = parse(schemas.deleteAccount, await ctx.body());
  if (!(await verifyPassword(b.password, ctx.user.password_hash))) throw unauthorized('Password is not correct.');
  await ctx.db.query('delete from users where id = $1', [ctx.user.id]);
  ctx.clearSession();
}

module.exports = [
  ['GET', '/me', me],
  ['PATCH', '/me', update],
  ['POST', '/me/password', changePassword],
  ['POST', '/me/coach', linkCoach],
  ['DELETE', '/me/coach', unlinkCoach],
  ['POST', '/replies/read', markRead, { auth: 'client' }],
  ['GET', '/me/export', exportData],
  ['DELETE', '/me', deleteAccount],
];
