const MODEL = process.env.ANTHROPIC_MODEL || 'claude-sonnet-4-5';
async function claude(content, system, max = 1200) {
  const key = process.env.ANTHROPIC_API_KEY;
  if (!key) throw new Error('AI key not configured on server');
  const r = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: { 'x-api-key': key, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' },
    body: JSON.stringify({ model: MODEL, max_tokens: max, system, messages: [{ role: 'user', content }] })
  });
  const j = await r.json();
  if (!r.ok) throw new Error(j.error?.message || 'AI request failed');
  return j.content.map(c => c.text || '').join('');
}
const parseJSON = (t) => { const m = t.match(/[\[{][\s\S]*[\]}]/); return JSON.parse(m ? m[0] : t); };

async function analyzePlate(dataUrl, note) {
  const m = /^data:(image\/[a-z+]+);base64,(.+)$/.exec(dataUrl || '');
  if (!m) throw new Error('Invalid image');
  const system = 'You are a nutrition analyst helping a coach. Look at the photo of a plate/meal. Identify each distinct food, estimate its portion in grams (or ml) from visual cues such as plate size, utensils and depth, and estimate kcal, protein, carbs and fat for that portion. Be realistic, do not invent foods you cannot see. If it is not food, return {"is_food":false,"items":[]}. Reply with JSON only: {"is_food":true,"meal_name":"short title","confidence":"low|medium|high","items":[{"name":"","portion_g":0,"portion_text":"e.g. 1 cup / 2 rotis","kcal":0,"protein":0,"carbs":0,"fat":0}],"note":"one line on what is uncertain"}';
  const txt = await claude([
    { type: 'image', source: { type: 'base64', media_type: m[1], data: m[2] } },
    { type: 'text', text: note ? `Client note: ${note}` : 'Analyse this meal.' }
  ], system);
  return parseJSON(txt);
}
async function weekSummary(name, daily) {
  const system = 'You write a 3 to 4 line plain-English weekly summary of a nutrition coaching client for their coach. Use only the data given. Mention logging consistency, average calories and protein, notable patterns, and one thing the coach could raise. No markdown, no bullets.';
  return (await claude([{ type: 'text', text: `Client: ${name}\nPer-day data (date, meals logged, kcal, protein g, carbs g, fat g, meal names):\n${JSON.stringify(daily)}` }], system, 400)).trim();
}
module.exports = { analyzePlate, weekSummary };
