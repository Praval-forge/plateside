const { schemas, parse } = require('../validate');
const { rateLimit, newInviteCode } = require('../security');
const { weekSummary } = require('../ai');
const { loadMeals, dailyStats, streakOf, todayIn, addDays, coachClient, publicUser, roundTotals, sumItems } = require('../services');

// One row per client with today's (or a chosen day's) totals, last log time and streak.
async function overview(ctx) {
  const { db, user } = ctx;
  const date = ctx.query.date ? parse(schemas.date, ctx.query.date) : null;
  const { rows: clients } = await db.query(
    "select id, name, email, goal_kcal, timezone, created_at, to_char(now() at time zone timezone, 'YYYY-MM-DD') as today from users where coach_id = $1 and role = 'client' order by lower(name)", [user.id]);
  const ids = clients.map(c => c.id);
  let meals = [], last = [], recent = [];
  if (ids.length) {
    const day = date;
    meals = await loadMeals(db,
      `u.coach_id = $1 and to_char(m.logged_at at time zone u.timezone, 'YYYY-MM-DD') = coalesce($2::text, to_char(now() at time zone u.timezone, 'YYYY-MM-DD')) and m.logged_at > now() - interval '60 days' and m.logged_at > coalesce(($3::date - 1)::timestamptz, now() - interval '2 days')`,
      [user.id, day, day]);
    last = (await db.query('select user_id, max(logged_at) as last from meals where user_id = any($1::uuid[]) group by user_id', [ids])).rows;
    recent = (await db.query(
      `select m.user_id, to_char(m.logged_at at time zone u.timezone, 'YYYY-MM-DD') as d from meals m join users u on u.id = m.user_id
        where m.user_id = any($1::uuid[]) and m.logged_at > now() - interval '40 days' group by 1, 2`, [ids])).rows;
  }
  const lastBy = Object.fromEntries(last.map(r => [r.user_id, r.last]));
  const out = clients.map(c => {
    const ms = meals.filter(m => m.userId === c.id);
    const loggedDays = new Set(recent.filter(r => r.user_id === c.id).map(r => r.d));
    const all = []; for (let k = 39; k >= 0; k--) { const d = addDays(c.today, -k); all.push({ meals: loggedDays.has(d) ? 1 : 0 }); }
    return {
      id: c.id, name: c.name, email: c.email, goalKcal: c.goal_kcal, timezone: c.timezone, joinedAt: c.created_at,
      notLogged: ms.length === 0, meals: ms, totals: roundTotals(sumItems(ms.flatMap(m => m.items))),
      lastLoggedAt: lastBy[c.id] || null, streak: streakOf(all),
      needsReply: ms.some(m => m.replies.length === 0),
    };
  });
  out.sort((a, b) => (b.notLogged - a.notLogged) || a.name.localeCompare(b.name));
  return { date: date || (clients[0] ? clients[0].today : await todayIn(db, user.timezone)), inviteCode: user.invite_code, clients: out };
}

async function client(ctx) {
  const { db, user } = ctx;
  const c = await coachClient(db, user, parse(schemas.uuid, ctx.params.id));
  const date = ctx.query.date ? parse(schemas.date, ctx.query.date) : await todayIn(db, c.timezone);
  const [meals, stats] = await Promise.all([
    loadMeals(db, "m.user_id = $1 and to_char(m.logged_at at time zone u.timezone, 'YYYY-MM-DD') = $2::text and m.logged_at >= ($3::date - 1)::timestamptz and m.logged_at < ($3::date + 2)::timestamptz", [c.id, date, date]),
    dailyStats(db, c, 14),
  ]);
  return { client: publicUser(c), date, meals, totals: roundTotals(sumItems(meals.flatMap(m => m.items))), stats };
}

async function clientInsights(ctx) {
  const { db, user } = ctx;
  const c = await coachClient(db, user, parse(schemas.uuid, ctx.params.id));
  const s = await dailyStats(db, c, 7);
  if (!s.loggedDays) return { summary: 'No meals logged in the last 7 days.' };
  const cached = await db.query("select body from insights where user_id = $1 and day = $2 and audience = 'coach' and created_at > now() - interval '6 hours'", [c.id, s.today]);
  if (cached.rows.length) return { summary: cached.rows[0].body, cached: true };
  await rateLimit(db, `insight-coach:${user.id}`, 60, 86400);
  const summary = await weekSummary(c.name, s.days, 'coach');
  await db.query("insert into insights(user_id, day, audience, body) values ($1,$2,'coach',$3) on conflict (user_id, day, audience) do update set body = excluded.body, created_at = now()", [c.id, s.today, summary]);
  return { summary };
}

async function removeClient(ctx) {
  const c = await coachClient(ctx.db, ctx.user, parse(schemas.uuid, ctx.params.id));
  await ctx.db.query('update users set coach_id = null where id = $1', [c.id]);
}

async function rotateInvite(ctx) {
  const code = newInviteCode();
  await ctx.db.query('update users set invite_code = $2 where id = $1', [ctx.user.id, code]);
  return { inviteCode: code };
}

module.exports = [
  ['GET', '/coach/overview', overview, { auth: 'coach' }],
  ['GET', '/coach/clients/:id', client, { auth: 'coach' }],
  ['GET', '/coach/clients/:id/insights', clientInsights, { auth: 'coach' }],
  ['DELETE', '/coach/clients/:id', removeClient, { auth: 'coach' }],
  ['POST', '/coach/invite/rotate', rotateInvite, { auth: 'coach' }],
];
