// Shared queries. All "dates" are YYYY-MM-DD strings in the *user's* timezone.
const { notFound, forbidden } = require('./errors');

const R1 = (n) => Math.round((+n || 0) * 10) / 10;
function addDays(d, n) { const t = new Date(d + 'T00:00:00Z'); t.setUTCDate(t.getUTCDate() + n); return t.toISOString().slice(0, 10); }

async function todayIn(db, tz) {
  const { rows } = await db.query("select to_char(now() at time zone $1, 'YYYY-MM-DD') as d", [tz]);
  return rows[0].d;
}

function publicUser(u, extra = {}) {
  return { id: u.id, name: u.name, email: u.email, role: u.role, goalKcal: u.goal_kcal, timezone: u.timezone, coachId: u.coach_id || null, inviteCode: u.role === 'coach' ? u.invite_code : undefined, createdAt: u.created_at, ...extra };
}

const sumItems = (items) => items.reduce((a, i) => ({ kcal: a.kcal + i.kcal, protein: a.protein + i.protein, carbs: a.carbs + i.carbs, fat: a.fat + i.fat }), { kcal: 0, protein: 0, carbs: 0, fat: 0 });
const roundTotals = (t) => ({ kcal: Math.round(t.kcal), protein: R1(t.protein), carbs: R1(t.carbs), fat: R1(t.fat) });

// Load meals (never the image bytes) with their items and replies attached.
async function loadMeals(db, where, params) {
  const { rows } = await db.query(
    `select m.id, m.user_id, m.name, m.meal_type, m.note, m.ai_confidence, m.ai_note, m.corrected, m.logged_at,
            to_char(m.logged_at at time zone u.timezone, 'YYYY-MM-DD') as local_date, (m.image is not null) as has_image
       from meals m join users u on u.id = m.user_id where ${where} order by m.logged_at asc`, params);
  if (!rows.length) return [];
  const ids = rows.map(r => r.id);
  const [items, replies] = await Promise.all([
    db.query('select meal_id, name, portion_g, portion_text, kcal, protein, carbs, fat from meal_items where meal_id = any($1::uuid[]) order by position, id', [ids]),
    db.query('select r.id, r.meal_id, r.body, r.created_at, r.read_at, u.name as coach_name from replies r join users u on u.id = r.coach_id where r.meal_id = any($1::uuid[]) order by r.created_at', [ids]),
  ]);
  const by = (list) => list.reduce((m, r) => ((m[r.meal_id] = m[r.meal_id] || []).push(r), m), {});
  const it = by(items.rows), rp = by(replies.rows);
  return rows.map(m => {
    const its = (it[m.id] || []).map(i => ({ name: i.name, portionG: i.portion_g, portionText: i.portion_text, kcal: i.kcal, protein: i.protein, carbs: i.carbs, fat: i.fat }));
    return {
      id: m.id, userId: m.user_id, name: m.name, mealType: m.meal_type, note: m.note, confidence: m.ai_confidence, aiNote: m.ai_note,
      corrected: m.corrected, loggedAt: m.logged_at, localDate: m.local_date, imageUrl: m.has_image ? `/api/meals/${m.id}/image` : null,
      items: its, totals: roundTotals(sumItems(its)),
      replies: (rp[m.id] || []).map(r => ({ id: r.id, body: r.body, createdAt: r.created_at, read: !!r.read_at, coachName: r.coach_name })),
    };
  });
}

// Per-day totals for the last `days` days (oldest first, gaps filled), plus streak info.
async function dailyStats(db, user, days = 7) {
  const today = await todayIn(db, user.timezone);
  const span = Math.max(days, 60);
  const from = addDays(today, -(span - 1));
  const { rows } = await db.query(
    `select to_char(m.logged_at at time zone $2, 'YYYY-MM-DD') as d, count(distinct m.id)::int as meals,
            coalesce(sum(i.kcal),0)::float8 as kcal, coalesce(sum(i.protein),0)::float8 as protein,
            coalesce(sum(i.carbs),0)::float8 as carbs, coalesce(sum(i.fat),0)::float8 as fat
       from meals m left join meal_items i on i.meal_id = m.id
      where m.user_id = $1 and m.logged_at >= ($3::date - 1)::timestamptz and (m.logged_at at time zone $2)::date >= $3::date
      group by 1`, [user.id, user.timezone, from]);
  const map = Object.fromEntries(rows.map(r => [r.d, r]));
  const all = [];
  for (let k = 0; k < span; k++) {
    const d = addDays(from, k), r = map[d];
    all.push({ date: d, meals: r ? r.meals : 0, kcal: r ? Math.round(r.kcal) : 0, protein: r ? R1(r.protein) : 0, carbs: r ? R1(r.carbs) : 0, fat: r ? R1(r.fat) : 0 });
  }
  const streak = streakOf(all);
  const window = all.slice(-days);
  const logged = window.filter(d => d.meals);
  return {
    today, days: window, streak, loggedDays: logged.length,
    avgKcal: logged.length ? Math.round(logged.reduce((s, d) => s + d.kcal, 0) / logged.length) : 0,
    avgProtein: logged.length ? R1(logged.reduce((s, d) => s + d.protein, 0) / logged.length) : 0,
  };
}
function streakOf(allDays) {
  let i = allDays.length - 1, n = 0;
  if (!allDays[i].meals) i--;           // today not logged yet: the streak is still alive
  while (i >= 0 && allDays[i].meals) { n++; i--; }
  return n;
}

// Authorisation: the owner, or the owner's coach.
async function mealAccess(db, user, mealId) {
  const { rows } = await db.query('select m.id, m.user_id, u.coach_id from meals m join users u on u.id = m.user_id where m.id = $1', [mealId]);
  if (!rows.length) throw notFound('Meal not found.');
  const m = rows[0];
  const owner = m.user_id === user.id, coach = user.role === 'coach' && m.coach_id === user.id;
  if (!owner && !coach) throw notFound('Meal not found.'); // 404, not 403: do not reveal that it exists
  return { ...m, owner, coach };
}
async function coachClient(db, coach, clientId) {
  const { rows } = await db.query('select * from users where id = $1 and coach_id = $2 and role = $3', [clientId, coach.id, 'client']);
  if (!rows.length) throw notFound('Client not found.');
  return rows[0];
}
module.exports = { addDays, todayIn, publicUser, loadMeals, dailyStats, streakOf, sumItems, roundTotals, mealAccess, coachClient, R1 };
