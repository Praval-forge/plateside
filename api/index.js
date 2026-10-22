const { load, save, dayOf, totals, body } = require('./_db');
const { analyzePlate, weekSummary } = require('./_ai');
const id = () => Math.random().toString(36).slice(2, 10);
const pub = (m) => m;

module.exports = async (req, res) => {
  const q = req.query || Object.fromEntries(new URL(req.url, 'http://x').searchParams);
  const act = q.a;
  try {
    const db = await load();
    if (req.method === 'GET' && act === 'clients') {
      return res.json({ clients: Object.values(db.clients) });
    }
    if (req.method === 'POST' && act === 'join') {
      const b = await body(req);
      const name = String(b.name || '').trim().slice(0, 40);
      if (!name) return res.status(400).json({ error: 'Name required' });
      const key = name.toLowerCase().replace(/[^a-z0-9]+/g, '-');
      db.clients[key] = db.clients[key] || { id: key, name, joined: Date.now() };
      await save(db);
      return res.json({ client: db.clients[key] });
    }
    if (req.method === 'POST' && act === 'log') {
      const b = await body(req);
      const c = db.clients[b.client];
      if (!c) return res.status(400).json({ error: 'Unknown client' });
      const ai = await analyzePlate(b.image, b.note);
      if (ai.is_food === false) return res.status(422).json({ error: "That doesn't look like food. Try another photo." });
      const meal = { id: id(), client: c.id, ts: Date.now(), image: b.image, name: ai.meal_name || 'Meal', confidence: ai.confidence, aiNote: ai.note || '', note: b.note || '', items: ai.items || [], aiItems: ai.items || [], corrected: false, replies: [] };
      db.meals.push(meal);
      await save(db);
      return res.json({ meal });
    }
    if (req.method === 'POST' && act === 'correct') {
      const b = await body(req);
      const m = db.meals.find(x => x.id === b.id);
      if (!m) return res.status(404).json({ error: 'Not found' });
      m.items = (b.items || []).map(i => ({ name: String(i.name || '').slice(0, 60), portion_g: +i.portion_g || 0, portion_text: i.portion_text || '', kcal: +i.kcal || 0, protein: +i.protein || 0, carbs: +i.carbs || 0, fat: +i.fat || 0 }));
      if (b.name) m.name = String(b.name).slice(0, 60);
      m.corrected = true;
      await save(db);
      return res.json({ meal: m });
    }
    if (req.method === 'POST' && act === 'delete') {
      const b = await body(req);
      db.meals = db.meals.filter(x => x.id !== b.id);
      await save(db);
      return res.json({ ok: true });
    }
    if (req.method === 'GET' && act === 'day') {
      const day = q.date || dayOf(Date.now());
      const meals = db.meals.filter(m => m.client === q.client && dayOf(m.ts) === day);
      return res.json({ day, meals, totals: totals(meals) });
    }
    if (req.method === 'GET' && act === 'coach') {
      const day = q.date || dayOf(Date.now());
      const out = Object.values(db.clients).map(c => {
        const meals = db.meals.filter(m => m.client === c.id && dayOf(m.ts) === day);
        const last = db.meals.filter(m => m.client === c.id).sort((a, b) => b.ts - a.ts)[0];
        return { client: c, meals, totals: totals(meals), lastLogged: last ? last.ts : null, notLogged: meals.length === 0 };
      });
      out.sort((a, b) => (b.notLogged - a.notLogged) || a.client.name.localeCompare(b.client.name));
      return res.json({ day, clients: out });
    }
    if (req.method === 'POST' && act === 'reply') {
      const b = await body(req);
      const m = db.meals.find(x => x.id === b.id);
      if (!m) return res.status(404).json({ error: 'Not found' });
      const text = String(b.text || '').trim().slice(0, 500);
      if (!text) return res.status(400).json({ error: 'Empty reply' });
      m.replies.push({ ts: Date.now(), text });
      await save(db);
      return res.json({ meal: m });
    }
    if (req.method === 'GET' && act === 'week') {
      const c = db.clients[q.client];
      if (!c) return res.status(404).json({ error: 'Unknown client' });
      const days = [];
      for (let i = 6; i >= 0; i--) {
        const d = dayOf(Date.now() - i * 86400000);
        const ms = db.meals.filter(m => m.client === c.id && dayOf(m.ts) === d);
        const t = totals(ms);
        days.push({ date: d, meals: ms.length, kcal: Math.round(t.kcal), protein: Math.round(t.protein), carbs: Math.round(t.carbs), fat: Math.round(t.fat), names: ms.map(m => m.name) });
      }
      if (!days.some(d => d.meals)) return res.json({ summary: 'No meals logged in the last 7 days.', days });
      const summary = await weekSummary(c.name, days);
      return res.json({ summary, days });
    }
    res.status(404).json({ error: 'Unknown action' });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
};
