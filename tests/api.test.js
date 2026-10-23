const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');

delete process.env.DATABASE_URL;
delete process.env.PGLITE_DIR;
delete process.env.GEMINI_API_KEY;
const handler = require('../lib/app');
const { reset } = require('../lib/db');

let server, base;
before(async () => {
  server = http.createServer(handler);
  await new Promise(r => server.listen(0, r));
  base = `http://127.0.0.1:${server.address().port}`;
});
after(async () => { server.close(); await reset(); });

// Tiny cookie-jar client
function agent() {
  let cookie = '';
  return async (method, path, body, headers = {}) => {
    const r = await fetch(base + '/api' + path, {
      method, headers: { 'content-type': 'application/json', ...(cookie ? { cookie } : {}), ...headers },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const set = r.headers.get('set-cookie');
    if (set) cookie = set.split(';')[0].endsWith('=') ? '' : set.split(';')[0];
    const ct = r.headers.get('content-type') || '';
    return { status: r.status, headers: r.headers, body: ct.includes('json') ? await r.json() : Buffer.from(await r.arrayBuffer()) };
  };
}
const jpeg = (seed = 1) => 'data:image/jpeg;base64,' + Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.from('plateside-test-' + seed)]).toString('base64');

const ctx = {};
test('health check reports ok', async () => {
  const r = await agent()('GET', '/health');
  assert.equal(r.status, 200);
  assert.equal(r.body.status, 'ok');
  assert.ok(r.headers.get('x-content-type-options'));
});

test('unauthenticated requests are rejected', async () => {
  const r = await agent()('GET', '/me');
  assert.equal(r.status, 401);
  assert.equal(r.body.error.code, 'unauthorized');
});

test('coach registers and gets an invite code', async () => {
  ctx.coach = agent();
  const r = await ctx.coach('POST', '/auth/register', { name: 'Dr Rao', email: 'Coach@Example.com', password: 'correct-horse', role: 'coach' });
  assert.equal(r.status, 200);
  assert.equal(r.body.user.role, 'coach');
  assert.match(r.body.user.inviteCode, /^[A-Z2-9]{8}$/);
  ctx.code = r.body.user.inviteCode;
  assert.equal(r.body.user.passwordHash, undefined);
});

test('validation: weak password, bad email, duplicate email, bad invite', async () => {
  const a = agent();
  assert.equal((await a('POST', '/auth/register', { name: 'X', email: 'x@y.com', password: 'short', role: 'client' })).status, 400);
  assert.equal((await a('POST', '/auth/register', { name: 'X', email: 'nope', password: 'longenough1', role: 'client' })).status, 400);
  assert.equal((await a('POST', '/auth/register', { name: 'Dup', email: 'coach@example.com', password: 'longenough1', role: 'client' })).status, 409);
  const bad = await a('POST', '/auth/register', { name: 'X', email: 'x@y.com', password: 'longenough1', role: 'client', inviteCode: 'ZZZZZZZZ' });
  assert.equal(bad.status, 400);
  assert.equal(bad.body.error.details.field, 'inviteCode');
});

test('client registers with the invite code and is linked to the coach', async () => {
  ctx.asha = agent();
  const r = await ctx.asha('POST', '/auth/register', { name: 'Asha', email: 'asha@example.com', password: 'password123', role: 'client', inviteCode: ctx.code.toLowerCase(), timezone: 'Asia/Kolkata' });
  assert.equal(r.status, 200);
  const me = await ctx.asha('GET', '/me');
  assert.equal(me.body.user.coach.name, 'Dr Rao');
  assert.equal(me.body.user.unreadReplies, 0);
});

test('login: wrong password and unknown email look identical; correct password works', async () => {
  const a = agent();
  const w = await a('POST', '/auth/login', { email: 'asha@example.com', password: 'wrongwrong' });
  const u = await a('POST', '/auth/login', { email: 'nobody@example.com', password: 'wrongwrong' });
  assert.equal(w.status, 401); assert.equal(u.status, 401);
  assert.equal(w.body.error.message, u.body.error.message);
  assert.equal((await a('POST', '/auth/login', { email: 'ASHA@example.com', password: 'password123' })).status, 200);
});

test('login is rate limited per email', async () => {
  const a = agent();
  let last;
  for (let i = 0; i < 12; i++) last = await a('POST', '/auth/login', { email: 'victim@example.com', password: 'guess-' + i });
  assert.equal(last.status, 429);
});

test('client logs a meal; AI estimate is stored with items and totals', async () => {
  const r = await ctx.asha('POST', '/meals', { image: jpeg(1), note: 'no sugar in tea', mealType: 'breakfast' });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  const m = r.body.meal;
  ctx.meal = m;
  assert.ok(m.items.length >= 1);
  assert.equal(m.corrected, false);
  assert.equal(m.mealType, 'breakfast');
  assert.ok(m.totals.kcal > 0);
  assert.ok(m.imageUrl.endsWith('/image'));
});

test('uploads are validated (type, magic bytes)', async () => {
  assert.equal((await ctx.asha('POST', '/meals', { image: 'data:text/html;base64,PGgxPg==' })).status, 400);
  const fake = 'data:image/jpeg;base64,' + Buffer.from('<script>alert(1)</script>').toString('base64');
  assert.equal((await ctx.asha('POST', '/meals', { image: fake })).status, 400);
});

test('listing meals for today returns the meal with totals and goal', async () => {
  const r = await ctx.asha('GET', '/meals');
  assert.equal(r.status, 200);
  assert.equal(r.body.meals.length, 1);
  assert.equal(r.body.goalKcal, 2000);
  assert.equal(r.body.totals.kcal, ctx.meal.totals.kcal);
  assert.equal((await ctx.asha('GET', '/meals?date=2000-01-01')).body.meals.length, 0);
  assert.equal((await ctx.asha('GET', '/meals?date=garbage')).status, 400);
});

test('meal photos are private: owner and their coach only', async () => {
  const url = ctx.meal.imageUrl.replace('/api', '');
  const own = await ctx.asha('GET', url);
  assert.equal(own.status, 200);
  assert.equal(own.headers.get('content-type'), 'image/jpeg');
  assert.equal((await ctx.coach('GET', url)).status, 200);
  const stranger = agent();
  await stranger('POST', '/auth/register', { name: 'Eve', email: 'eve@example.com', password: 'password123', role: 'client' });
  assert.equal((await stranger('GET', url)).status, 404);
  assert.equal((await agent()('GET', url)).status, 401);
  ctx.eve = stranger;
});

test('client can correct a meal; others cannot touch it', async () => {
  const items = [{ name: 'Poha', portion_g: 150, kcal: 250, protein: 5, carbs: 45, fat: 6 }];
  const r = await ctx.asha('PATCH', `/meals/${ctx.meal.id}`, { items });
  assert.equal(r.status, 200);
  assert.equal(r.body.meal.corrected, true);
  assert.equal(r.body.meal.totals.kcal, 250);
  assert.equal((await ctx.eve('PATCH', `/meals/${ctx.meal.id}`, { items })).status, 404);
  assert.equal((await ctx.coach('PATCH', `/meals/${ctx.meal.id}`, { items })).status, 403);
  assert.equal((await ctx.asha('PATCH', `/meals/${ctx.meal.id}`, { items: [{ name: 'x', portion_g: -5, kcal: 1, protein: 1, carbs: 1, fat: 1 }] })).status, 400);
});

test('coach sees the client on the overview; clients cannot use coach endpoints', async () => {
  const r = await ctx.coach('GET', '/coach/overview');
  assert.equal(r.status, 200);
  assert.equal(r.body.clients.length, 1);
  const c = r.body.clients[0];
  assert.equal(c.name, 'Asha');
  assert.equal(c.notLogged, false);
  assert.equal(c.streak, 1);
  assert.equal(c.totals.kcal, 250);
  assert.equal(c.needsReply, true);
  ctx.ashaId = c.id;
  assert.equal((await ctx.asha('GET', '/coach/overview')).status, 403);
  assert.equal((await ctx.eve('GET', `/coach/clients/${ctx.ashaId}`)).status, 403);
});

test('a different coach cannot see someone else\'s client', async () => {
  const other = agent();
  await other('POST', '/auth/register', { name: 'Other Coach', email: 'other@example.com', password: 'password123', role: 'coach' });
  assert.equal((await other('GET', `/coach/clients/${ctx.ashaId}`)).status, 404);
  assert.equal((await other('POST', `/meals/${ctx.meal.id}/replies`, { body: 'hi' })).status, 404);
  assert.equal((await other('GET', '/coach/overview')).body.clients.length, 0);
});

test('coach replies; client gets an unread count, then marks read', async () => {
  const r = await ctx.coach('POST', `/meals/${ctx.meal.id}/replies`, { body: 'Great start! Add some curd.' });
  assert.equal(r.status, 200);
  assert.equal(r.body.meal.replies[0].body, 'Great start! Add some curd.');
  assert.equal((await ctx.coach('POST', `/meals/${ctx.meal.id}/replies`, { body: '   ' })).status, 400);
  assert.equal((await ctx.asha('GET', '/me')).body.user.unreadReplies, 1);
  assert.equal((await ctx.asha('POST', '/replies/read', {})).status, 200);
  assert.equal((await ctx.asha('GET', '/me')).body.user.unreadReplies, 0);
  assert.equal((await ctx.asha('POST', `/meals/${ctx.meal.id}/replies`, { body: 'sneaky' })).status, 403);
  assert.equal((await ctx.coach('GET', '/coach/overview')).body.clients[0].needsReply, false);
});

test('coach client detail includes 14 days of stats', async () => {
  const r = await ctx.coach('GET', `/coach/clients/${ctx.ashaId}`);
  assert.equal(r.status, 200);
  assert.equal(r.body.stats.days.length, 14);
  assert.equal(r.body.meals.length, 1);
  const ins = await ctx.coach('GET', `/coach/clients/${ctx.ashaId}/insights`);
  assert.equal(ins.status, 200);
  assert.ok(ins.body.summary.length > 5);
});

test('stats, streak and insights for the client', async () => {
  const s = await ctx.asha('GET', '/stats?days=7');
  assert.equal(s.body.days.length, 7);
  assert.equal(s.body.streak, 1);
  assert.equal(s.body.loggedDays, 1);
  assert.ok((await ctx.asha('GET', '/insights')).body.summary.length > 5);
});

test('profile update validates the calorie goal', async () => {
  assert.equal((await ctx.asha('PATCH', '/me', { goalKcal: 50 })).status, 400);
  const r = await ctx.asha('PATCH', '/me', { goalKcal: 1800, name: 'Asha K' });
  assert.equal(r.body.user.goalKcal, 1800);
  assert.equal((await ctx.asha('PATCH', '/me', { role: 'coach' })).status, 400); // cannot escalate role
});

test('cross-site state-changing requests are blocked', async () => {
  const r = await ctx.asha('POST', '/me/password', { current: 'password123', next: 'newpassword1' }, { origin: 'https://evil.example', 'sec-fetch-site': 'cross-site' });
  assert.equal(r.status, 403);
});

test('password change signs out other devices; old password stops working', async () => {
  const phone = agent();
  await phone('POST', '/auth/login', { email: 'asha@example.com', password: 'password123' });
  assert.equal((await phone('GET', '/me')).status, 200);
  assert.equal((await ctx.asha('POST', '/me/password', { current: 'wrong-one', next: 'newpassword1' })).status, 401);
  assert.equal((await ctx.asha('POST', '/me/password', { current: 'password123', next: 'newpassword1' })).status, 200);
  assert.equal((await phone('GET', '/me')).status, 401);
  assert.equal((await ctx.asha('GET', '/me')).status, 200);
  assert.equal((await agent()('POST', '/auth/login', { email: 'asha@example.com', password: 'password123' })).status, 401);
});

test('logout invalidates the session', async () => {
  const a = agent();
  await a('POST', '/auth/login', { email: 'asha@example.com', password: 'newpassword1' });
  assert.equal((await a('GET', '/me')).status, 200);
  await a('POST', '/auth/logout', {});
  assert.equal((await a('GET', '/me')).status, 401);
});

test('client can leave and rejoin a coach; coach can remove a client', async () => {
  assert.equal((await ctx.asha('DELETE', '/me/coach')).status, 200);
  assert.equal((await ctx.coach('GET', '/coach/overview')).body.clients.length, 0);
  assert.equal((await ctx.asha('POST', '/me/coach', { inviteCode: 'NOPE1234' })).status, 400);
  assert.equal((await ctx.asha('POST', '/me/coach', { inviteCode: ctx.code })).status, 200);
  assert.equal((await ctx.coach('DELETE', `/coach/clients/${ctx.ashaId}`)).status, 200);
  assert.equal((await ctx.coach('GET', '/coach/overview')).body.clients.length, 0);
});

test('invite codes can be rotated; the old one stops working', async () => {
  const r = await ctx.coach('POST', '/coach/invite/rotate', {});
  assert.notEqual(r.body.inviteCode, ctx.code);
  assert.equal((await ctx.eve('POST', '/me/coach', { inviteCode: ctx.code })).status, 400);
  assert.equal((await ctx.eve('POST', '/me/coach', { inviteCode: r.body.inviteCode })).status, 200);
});

test('data export and account deletion', async () => {
  const ex = await ctx.asha('GET', '/me/export');
  assert.equal(ex.status, 200);
  assert.equal(ex.body.meals.length, 1);
  assert.equal(ex.body.user.email, 'asha@example.com');
  assert.equal((await ctx.asha('DELETE', '/me', { password: 'wrong-wrong' })).status, 401);
  assert.equal((await ctx.asha('DELETE', '/me', { password: 'newpassword1' })).status, 200);
  assert.equal((await ctx.asha('GET', '/me')).status, 401);
  assert.equal((await agent()('POST', '/auth/login', { email: 'asha@example.com', password: 'newpassword1' })).status, 401);
});

test('unknown routes 404 and wrong methods 405', async () => {
  assert.equal((await agent()('GET', '/nope')).status, 404);
  assert.equal((await agent()('PUT', '/health')).status, 405);
});
