const { schemas, parse } = require('../validate');
const { rateLimit } = require('../security');
const { bad, notFound, forbidden, AppError } = require('../errors');
const { analyzePlate, weekSummary } = require('../ai');
const { loadMeals, dailyStats, todayIn, mealAccess, roundTotals, sumItems } = require('../services');

const MAX_IMAGE_BYTES = 1_500_000;
const MAGIC = { 'image/jpeg': [0xff, 0xd8, 0xff], 'image/png': [0x89, 0x50, 0x4e, 0x47], 'image/webp': null };
function decodeImage(dataUrl) {
  const m = /^data:(image\/(?:jpeg|png|webp));base64,([A-Za-z0-9+/]+=*)$/.exec(dataUrl);
  if (!m) throw bad('Please upload a JPEG, PNG or WebP photo.', { field: 'image' });
  const buf = Buffer.from(m[2], 'base64');
  if (buf.length > MAX_IMAGE_BYTES) throw new AppError(413, 'too_large', 'That photo is too large. Try a smaller one.');
  const magic = MAGIC[m[1]];
  const okMagic = magic ? magic.every((b, i) => buf[i] === b) : (buf.slice(0, 4).toString() === 'RIFF' && buf.slice(8, 12).toString() === 'WEBP');
  if (!okMagic) throw bad('That file does not look like a real photo.', { field: 'image' });
  return { mime: m[1], b64: m[2], buf };
}

async function insertItems(db, mealId, items) {
  for (let i = 0; i < items.length; i++) {
    const it = items[i];
    await db.query('insert into meal_items(meal_id, position, name, portion_g, portion_text, kcal, protein, carbs, fat) values ($1,$2,$3,$4,$5,$6,$7,$8,$9)',
      [mealId, i, it.name, it.portion_g, it.portion_text || '', it.kcal, it.protein, it.carbs, it.fat]);
  }
}

async function list(ctx) {
  const { db, user } = ctx;
  const date = ctx.query.date ? parse(schemas.date, ctx.query.date) : await todayIn(db, user.timezone);
  const meals = await loadMeals(db, "m.user_id = $1 and to_char(m.logged_at at time zone u.timezone, 'YYYY-MM-DD') = $2::text and m.logged_at >= ($3::date - 1)::timestamptz and m.logged_at < ($3::date + 2)::timestamptz", [user.id, date, date]);
  return { date, goalKcal: user.goal_kcal, meals, totals: roundTotals(sumItems(meals.flatMap(m => m.items))) };
}

async function create(ctx) {
  const { db, user } = ctx;
  if (user.role !== 'client') throw forbidden('Only clients log meals.');
  await rateLimit(db, `meal:${user.id}`, 40, 3600);
  const b = parse(schemas.logMeal, await ctx.body());
  const img = decodeImage(b.image);
  const ai = await analyzePlate(img.mime, img.b64, b.note);
  if (!ai.is_food) throw new AppError(422, 'not_food', "That doesn't look like food. Try another photo.");
  const id = await db.tx(async t => {
    const r = await t.query(
      `insert into meals(user_id, name, meal_type, note, ai_confidence, ai_note, ai_items, image, image_type) values ($1,$2,$3,$4,$5,$6,$7,$8,$9) returning id`,
      [user.id, ai.meal_name, b.mealType || null, b.note, ai.confidence, ai.note, JSON.stringify(ai.items), img.buf, img.mime]);
    await insertItems(t, r.rows[0].id, ai.items);
    return r.rows[0].id;
  });
  const [meal] = await loadMeals(db, 'm.id = $1', [id]);
  return { meal };
}

async function edit(ctx) {
  const { db, user } = ctx;
  const id = parse(schemas.uuid, ctx.params.id);
  const acc = await mealAccess(db, user, id);
  if (!acc.owner) throw forbidden('Only the person who logged a meal can edit it.');
  const b = parse(schemas.editMeal, await ctx.body());
  await db.tx(async t => {
    await t.query('update meals set name = coalesce($2, name), meal_type = case when $4 then $3 else meal_type end, corrected = corrected or $5 where id = $1',
      [id, b.name ?? null, b.mealType ?? null, b.mealType !== undefined, !!b.items]);
    if (b.items) { await t.query('delete from meal_items where meal_id = $1', [id]); await insertItems(t, id, b.items); }
  });
  const [meal] = await loadMeals(db, 'm.id = $1', [id]);
  return { meal };
}

async function remove(ctx) {
  const id = parse(schemas.uuid, ctx.params.id);
  const acc = await mealAccess(ctx.db, ctx.user, id);
  if (!acc.owner) throw forbidden('Only the person who logged a meal can delete it.');
  await ctx.db.query('delete from meals where id = $1', [id]);
}

async function image(ctx) {
  const id = parse(schemas.uuid, ctx.params.id);
  await mealAccess(ctx.db, ctx.user, id);
  const { rows } = await ctx.db.query('select image, image_type from meals where id = $1', [id]);
  if (!rows.length || !rows[0].image) throw notFound('No photo.');
  return { raw: true, body: Buffer.from(rows[0].image), headers: { 'Content-Type': rows[0].image_type, 'Cache-Control': 'private, max-age=86400' } };
}

async function stats(ctx) {
  const days = Math.min(60, Math.max(7, parseInt(ctx.query.days, 10) || 7));
  const s = await dailyStats(ctx.db, ctx.user, days);
  return { ...s, goalKcal: ctx.user.goal_kcal };
}

async function insights(ctx) {
  const { db, user } = ctx;
  const s = await dailyStats(db, user, 7);
  if (!s.loggedDays) return { summary: 'Log a few meals first and your weekly insight will appear here.', cached: false };
  const cached = await db.query("select body from insights where user_id = $1 and day = $2 and audience = 'client' and created_at > now() - interval '6 hours'", [user.id, s.today]);
  if (cached.rows.length) return { summary: cached.rows[0].body, cached: true };
  await rateLimit(db, `insight:${user.id}`, 10, 86400);
  const summary = await weekSummary(user.name.split(' ')[0], s.days, 'client');
  await db.query("insert into insights(user_id, day, audience, body) values ($1,$2,'client',$3) on conflict (user_id, day, audience) do update set body = excluded.body, created_at = now()", [user.id, s.today, summary]);
  return { summary, cached: false };
}

const reply = async (ctx) => {
  const { db, user } = ctx;
  if (user.role !== 'coach') throw forbidden('Only coaches can reply to meals.');
  const id = parse(schemas.uuid, ctx.params.id);
  const acc = await mealAccess(db, user, id);
  if (!acc.coach) throw notFound('Meal not found.');
  const b = parse(schemas.reply, await ctx.body());
  await rateLimit(db, `reply:${user.id}`, 200, 3600);
  await db.query('insert into replies(meal_id, coach_id, body) values ($1,$2,$3)', [id, user.id, b.body]);
  const [meal] = await loadMeals(db, 'm.id = $1', [id]);
  return { meal };
};

module.exports = [
  ['GET', '/meals', list, { auth: 'client' }],
  ['POST', '/meals', create, { auth: 'client' }],
  ['PATCH', '/meals/:id', edit],
  ['DELETE', '/meals/:id', remove],
  ['GET', '/meals/:id/image', image],
  ['POST', '/meals/:id/replies', reply, { auth: 'coach' }],
  ['GET', '/stats', stats, { auth: 'client' }],
  ['GET', '/insights', insights, { auth: 'client' }],
];
