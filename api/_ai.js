const MODELS = (process.env.AI_MODELS || 'gemini-flash-latest,gemini-3.5-flash,gemini-2.5-flash').split(',');
async function gemini(parts, system, max = 1500) {
  const key = process.env.GEMINI_API_KEY;
  if (!key) throw new Error('AI key not configured on server');
  let last = 'AI request failed';
  for (let round = 0; round < 2; round++) for (const m of MODELS) {
    const r = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${m}:generateContent`, {
      method: 'POST',
      headers: { 'x-goog-api-key': key, 'content-type': 'application/json' },
      body: JSON.stringify({ systemInstruction: { parts: [{ text: system }] }, contents: [{ role: 'user', parts }], generationConfig: { maxOutputTokens: max, temperature: 0.2, thinkingConfig: { thinkingBudget: 0 } } })
    });
    const j = await r.json().catch(() => ({}));
    if (r.ok) { const t = (j.candidates?.[0]?.content?.parts || []).map(p => p.text || '').join(''); if (t) return t; }
    last = j.error?.message || last;
  }
  throw new Error(last);
}
const parseJSON = (t) => { const m = t.match(/[\[{][\s\S]*[\]}]/); return JSON.parse(m ? m[0] : t); };

async function analyzePlate(dataUrl, note) {
  const m = /^data:(image\/[a-z+]+);base64,(.+)$/.exec(dataUrl || '');
  if (!m) throw new Error('Invalid image');
  const system = 'You are a nutrition analyst helping a coach. Look at the photo of a plate/meal. Identify each distinct food, estimate its portion in grams (or ml) from visual cues such as plate size, utensils and depth, and estimate kcal, protein, carbs and fat for that portion. Be realistic, do not invent foods you cannot see. If it is not food, return {"is_food":false,"items":[]}. Reply with JSON only: {"is_food":true,"meal_name":"short title","confidence":"low|medium|high","items":[{"name":"","portion_g":0,"portion_text":"e.g. 1 cup / 2 rotis","kcal":0,"protein":0,"carbs":0,"fat":0}],"note":"one line on what is uncertain"}';
  const txt = await gemini([
    { inline_data: { mime_type: m[1], data: m[2] } },
    { text: note ? `Client note: ${note}` : 'Analyse this meal.' }
  ], system);
  return parseJSON(txt);
}
async function weekSummary(name, daily) {
  const system = 'You write a 3 to 4 line plain-English weekly summary of a nutrition coaching client for their coach. Use only the data given. Mention logging consistency, average calories and protein, notable patterns, and one thing the coach could raise. No markdown, no bullets.';
  return (await gemini([{ text: `Client: ${name}\nPer-day data (date, meals logged, kcal, protein g, carbs g, fat g, meal names):\n${JSON.stringify(daily)}` }], system, 500)).trim();
}
module.exports = { analyzePlate, weekSummary };
