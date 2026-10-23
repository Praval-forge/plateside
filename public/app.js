'use strict';
/* Plateside front end. Talks to /api/* with a cookie session; no secrets live in the browser. */
const $ = (s, r = document) => r.querySelector(s), $$ = (s, r = document) => [...r.querySelectorAll(s)];
const app = $('#app');
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const R = n => Math.round(+n || 0);
const TYPES = { breakfast: '🌅 Breakfast', lunch: '🍛 Lunch', dinner: '🌙 Dinner', snack: '🍎 Snack' };

let user = null, clientDate = null, coachDate = null, progressDays = 7;

/* ---------- api ---------- */
async function api(method, path, body) {
  const r = await fetch('/api' + path, { method, credentials: 'same-origin', headers: body !== undefined ? { 'content-type': 'application/json' } : {}, body: body !== undefined ? JSON.stringify(body) : undefined });
  let j = null; try { j = await r.json(); } catch (e) { /* non-JSON */ }
  if (!r.ok) {
    const e = new Error((j && j.error && j.error.message) || 'Something went wrong. Please try again.');
    e.status = r.status; e.field = j && j.error && j.error.details && j.error.details.field;
    if (r.status === 401 && !path.startsWith('/auth/') && user) { user = null; renderNav(); showAuth('login', 'Your session ended. Please sign in again.'); }
    throw e;
  }
  return j;
}

/* ---------- small helpers ---------- */
function toast(msg) { const t = $('#toast'); t.textContent = msg; t.classList.add('show'); clearTimeout(toast.h); toast.h = setTimeout(() => t.classList.remove('show'), 3000); }
function confetti() { const cs = ['#14804a', '#f59e0b', '#3b82f6', '#ec4899', '#34d399']; for (let i = 0; i < 46; i++) { const e = document.createElement('i'); e.className = 'cf'; e.style.cssText = `left:${Math.random() * 100}vw;background:${cs[i % 5]};animation-delay:${Math.random() * .4}s;animation-duration:${1.2 + Math.random()}s;border-radius:${i % 3 ? '2px' : '50%'}`; document.body.appendChild(e); setTimeout(() => e.remove(), 2600); } }
function theme(t, save) { document.documentElement.dataset.theme = t; $('#th').textContent = t === 'dark' ? '☀️' : '🌙'; $('#th').title = t === 'dark' ? 'Switch to light mode' : 'Switch to dark mode'; $('meta[name=theme-color]').content = t === 'dark' ? '#0c1311' : '#14804a'; if (save) try { localStorage.setItem('pl_theme', t); } catch (e) { /* private mode */ } }
theme(document.documentElement.dataset.theme || 'dark');
$('#th').onclick = () => theme(document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark', true);
const tz = () => (user && user.timezone) || undefined;
const tm = (t, z) => new Date(t).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', timeZone: z || tz() });
function addDays(d, n) { const t = new Date(d + 'T00:00:00Z'); t.setUTCDate(t.getUTCDate() + n); return t.toISOString().slice(0, 10); }
function dateLabel(d, today) { if (d === today) return 'Today'; if (d === addDays(today, -1)) return 'Yesterday'; return new Date(d + 'T12:00:00').toLocaleDateString('en-IN', { weekday: 'short', day: 'numeric', month: 'short' }); }
function ago(ts) { if (!ts) return 'never'; const s = (Date.now() - new Date(ts)) / 1000; if (s < 90) return 'just now'; if (s < 3600) return `${R(s / 60)}m ago`; if (s < 86400) return `${R(s / 3600)}h ago`; if (s < 172800) return 'yesterday'; return `${R(s / 86400)} days ago`; }
const greet = () => { const h = +new Date().toLocaleString('en-GB', { hour: '2-digit', hour12: false, timeZone: tz() }); return h < 12 ? 'Good morning' : h < 17 ? 'Good afternoon' : 'Good evening'; };
const avc = n => ['#14804a', '#2563eb', '#c026d3', '#ea580c', '#0891b2', '#7c3aed'][[...n].reduce((a, c) => a + c.charCodeAt(0), 0) % 6];
const guessType = () => { const h = +new Date().toLocaleString('en-GB', { hour: '2-digit', hour12: false, timeZone: tz() }); return h < 11 ? 'breakfast' : h < 16 ? 'lunch' : h < 19 ? 'snack' : 'dinner'; };
const macChips = t => `<span class="chip k">${R(t.kcal)} kcal</span><span class="chip p">P ${R(t.protein)}g</span><span class="chip c">C ${R(t.carbs)}g</span><span class="chip f">F ${R(t.fat)}g</span>`;
const skeleton = () => { app.innerHTML = '<div class="narrow"><div class="skel"></div><div class="skel"></div><div class="skel"></div></div>'; };
const errBox = (e) => `<div class="err" role="alert">${esc(e.message || e)}</div>`;
async function busy(btn, label, fn) { const t = btn.textContent; btn.disabled = true; if (label) btn.textContent = label; try { return await fn(); } catch (e) { toast(e.message); } finally { btn.disabled = false; btn.textContent = t; } }
function shrink(file) {
  return new Promise((ok, no) => {
    const im = new Image();
    im.onload = () => {
      const s = Math.min(1, 1000 / Math.max(im.width, im.height)), c = document.createElement('canvas');
      c.width = Math.round(im.width * s); c.height = Math.round(im.height * s);
      c.getContext('2d').drawImage(im, 0, 0, c.width, c.height);
      let q = .82, out = c.toDataURL('image/jpeg', q);
      while (out.length > 1_900_000 && q > .4) { q -= .15; out = c.toDataURL('image/jpeg', q); }
      URL.revokeObjectURL(im.src); ok(out);
    };
    im.onerror = () => no(new Error('Could not read that photo. Try another one.'));
    im.src = URL.createObjectURL(file);
  });
}

/* ---------- navigation ---------- */
function renderNav() {
  const nav = $('#nav');
  if (!user) { nav.innerHTML = ''; return; }
  const h = location.hash || '#/';
  const on = p => (h.startsWith(p) ? ' class="on"' : '');
  nav.innerHTML = user.role === 'coach'
    ? `<a href="#/clients"${on('#/clients') || on('#/client/')}>Clients</a><a href="#/settings"${on('#/settings')}>Settings</a>`
    : `<a href="#/today"${on('#/today')}>Today${user.unreadReplies ? `<span class="badge" title="New coach replies">${user.unreadReplies}</span>` : ''}</a><a href="#/progress"${on('#/progress')}>Progress</a><a href="#/settings"${on('#/settings')}>Settings</a>`;
}
async function route() {
  if (!user) return;
  renderNav();
  const h = location.hash.replace(/^#/, '') || '/';
  skeleton(); window.scrollTo(0, 0);
  try {
    if (h.startsWith('/settings')) await viewSettings();
    else if (user.role === 'coach') {
      const m = /^\/client\/([0-9a-f-]{36})/.exec(h);
      if (m) await viewCoachClient(m[1]); else await viewClients();
    } else if (h.startsWith('/progress')) await viewProgress();
    else await viewToday();
  } catch (e) {
    if (e.status === 401) return;
    app.innerHTML = `<div class="narrow"><div class="card empty"><div class="big">😕</div><b>Couldn't load this page</b><p>${esc(e.message)}</p><button class="btn p" id="rt">Try again</button></div></div>`;
    $('#rt').onclick = route;
  }
}
window.addEventListener('hashchange', route);

/* ---------- auth ---------- */
function showAuth(mode = 'register', notice = '') {
  const inv = (new URLSearchParams(location.search).get('invite') || '').toUpperCase();
  const reg = mode === 'register';
  app.innerHTML = `<div class="auth"><div class="card">
   <div style="text-align:center;margin-bottom:14px"><div style="font-size:40px">🥗</div><h1 class="hello" style="margin:0">${reg ? 'Show your coach your plate' : 'Welcome back'}</h1><div class="mut">${reg ? 'Snap a photo. AI reads your plate. Your coach sees it the same day.' : 'Sign in to continue.'}</div></div>
   ${notice ? `<div class="err" style="margin:0 0 12px">${esc(notice)}</div>` : ''}
   <div class="tabs2" role="tablist"><button data-m="register" class="${reg ? 'on' : ''}">Create account</button><button data-m="login" class="${reg ? '' : 'on'}">Sign in</button></div>
   <form id="af" novalidate>
    ${reg ? `<div class="field"><label>I am a…</label><div class="roles"><button type="button" class="role on" data-r="client"><b>🙋 Client</b><span>I log my meals</span></button><button type="button" class="role" data-r="coach"><b>👩‍⚕️ Coach</b><span>I guide clients</span></button></div></div>
    <div class="field"><label for="nm">Your name</label><input id="nm" autocomplete="name" maxlength="60" required></div>` : ''}
    <div class="field"><label for="em">Email</label><input id="em" type="email" autocomplete="email" maxlength="120" required></div>
    <div class="field"><label for="pw">Password</label><div class="pwrap"><input id="pw" type="password" autocomplete="${reg ? 'new-password' : 'current-password'}" maxlength="72" required><button type="button" id="sp">Show</button></div>${reg ? '<div class="hint">At least 8 characters.</div>' : ''}</div>
    ${reg ? `<div class="field" id="ivf"><label for="iv">Coach invite code <span class="mut">(optional)</span></label><input id="iv" maxlength="20" value="${esc(inv)}" placeholder="e.g. K7M2QX9P" autocapitalize="characters"><div class="hint">Ask your coach for their code. You can also add it later in Settings.</div></div>` : ''}
    <div id="ae"></div>
    <button class="btn p lg" style="width:100%" type="submit">${reg ? 'Create my account' : 'Sign in'}</button>
   </form></div>
   <p class="mut" style="text-align:center;font-size:12px">Your meal photos are private: only you and your coach can see them.</p></div>`;
  let role = 'client';
  $$('.tabs2 button').forEach(b => b.onclick = () => showAuth(b.dataset.m));
  $$('.role').forEach(b => b.onclick = () => { role = b.dataset.r; $$('.role').forEach(x => x.classList.toggle('on', x === b)); const f = $('#ivf'); if (f) f.hidden = role === 'coach'; });
  $('#sp').onclick = () => { const p = $('#pw'); p.type = p.type === 'password' ? 'text' : 'password'; $('#sp').textContent = p.type === 'password' ? 'Show' : 'Hide'; };
  $('#af').onsubmit = async e => {
    e.preventDefault();
    const btn = e.target.querySelector('[type=submit]'); $('#ae').innerHTML = '';
    const body = { email: $('#em').value, password: $('#pw').value };
    if (reg) Object.assign(body, { name: $('#nm').value, role, timezone: Intl.DateTimeFormat().resolvedOptions().timeZone, inviteCode: role === 'client' ? $('#iv').value.trim() || undefined : undefined });
    await busy(btn, reg ? 'Creating…' : 'Signing in…', async () => {
      try {
        const r = await api('POST', reg ? '/auth/register' : '/auth/login', body);
        user = r.user; history.replaceState(null, '', location.pathname); if (reg) confetti();
        await loadMe(); location.hash = user.role === 'coach' ? '#/clients' : '#/today'; route();
      } catch (x) { $('#ae').innerHTML = errBox(x); }
    });
  };
}
async function loadMe() { user = (await api('GET', '/me')).user; renderNav(); }

/* ---------- meals (shared) ---------- */
function repliesHtml(m) { return m.replies.map(r => `<div class="reply"><b>${esc(r.coachName || 'Coach')}</b> · ${tm(r.createdAt, mealTz)}${r.read === false && user.role === 'client' ? '<span class="new">NEW</span>' : ''}<br>${esc(r.body)}</div>`).join(''); }
let mealTz;
function itemRow(i = {}, k = 0, edit = true) {
  return edit
    ? `<tr data-k="${k}"><td><input class="n" value="${esc(i.name || '')}" maxlength="60" aria-label="Food name" placeholder="Food"></td><td><input class="g" type="number" min="0" value="${i.portionG ?? 0}" aria-label="Grams"></td><td><input class="k" type="number" min="0" value="${R(i.kcal)}" aria-label="kcal"></td><td class="hide"><input class="p" type="number" min="0" value="${R(i.protein)}" aria-label="Protein"></td><td class="hide"><input class="c" type="number" min="0" value="${R(i.carbs)}" aria-label="Carbs"></td><td class="hide"><input class="f" type="number" min="0" value="${R(i.fat)}" aria-label="Fat"></td><td class="x"><button type="button" class="rm" aria-label="Remove food">✕</button></td></tr>`
    : `<tr><td>${esc(i.name)} <small>${esc(i.portionText || '')}</small></td><td>${R(i.portionG)}g</td><td>${R(i.kcal)}</td><td class="hide">${R(i.protein)}</td><td class="hide">${R(i.carbs)}</td><td class="hide">${R(i.fat)}</td></tr>`;
}
function itemsTable(m, edit) { return `<table class="items${edit ? '' : ' ro'}"><thead><tr><th>Food</th><th>Grams</th><th>kcal</th><th class="hide">P</th><th class="hide">C</th><th class="hide">F</th>${edit ? '<th></th>' : ''}</tr></thead><tbody>${m.items.map((i, k) => itemRow(i, k, edit)).join('')}</tbody></table>`; }
const confPill = m => (m.corrected ? '<span class="pill">✓ Corrected by client</span>' : `<span class="pill ${m.confidence === 'low' ? 'w' : ''}">AI ${esc(m.confidence || '')} confidence</span>`);
function mealCard(m, o = {}) {
  mealTz = o.tz || tz();
  return `<div class="card" data-id="${m.id}"><div class="meal">${m.imageUrl ? `<img src="${m.imageUrl}" alt="Photo of ${esc(m.name)}" loading="lazy">` : ''}<div class="info"><h3>${esc(m.name)}</h3><small>${tm(m.loggedAt, mealTz)}</small> ${m.mealType ? `<span class="pill a">${TYPES[m.mealType]}</span>` : ''} ${confPill(m)}<div class="macros">${macChips(m.totals)}</div><div class="mut" style="font-size:13px">${esc(m.note ? '“' + m.note + '” ' : '')}${esc(m.aiNote)}</div></div></div>
  ${o.edit ? '' : itemsTable(m, false)}${repliesHtml(m)}
  ${o.edit ? `<details class="edit"><summary>Check or fix the details</summary><p class="mut" style="font-size:13px;margin:0 0 6px">AI estimates can be off. Fix anything wrong and your coach sees the corrected version.</p><div class="field"><input class="mn" value="${esc(m.name)}" maxlength="60" aria-label="Meal name"></div>${itemsTable(m, true)}<div class="row" style="margin-top:10px"><button class="btn s add" type="button">＋ Add food</button><span class="sp"></span><button class="btn p save" type="button">Save corrections</button><button class="btn s danger-o del" type="button">Delete</button></div></details>` : ''}
  ${o.reply ? `<div class="rp"><input class="rt" maxlength="500" placeholder="Reply to ${esc(o.reply)}…" aria-label="Reply"><button class="btn s send" type="button">Send</button></div><div class="quick">${['Great choice! 👏', 'Nice portion size', 'Try adding more protein', 'Add some veggies 🥦'].map(t => `<button type="button">${t}</button>`).join('')}</div>` : ''}</div>`;
}
function readItems(card) { return $$('tbody tr', card).map(r => ({ name: $('.n', r).value.trim(), portion_g: +$('.g', r).value || 0, kcal: +$('.k', r).value || 0, protein: +$('.p', r).value || 0, carbs: +$('.c', r).value || 0, fat: +$('.f', r).value || 0 })).filter(i => i.name); }
function bindMealEditing(root, refresh) {
  $$('.card[data-id]', root).forEach(c => {
    const id = c.dataset.id, sv = $('.save', c); if (!sv) return;
    $('.add', c).onclick = () => { const tb = $('tbody', c); tb.insertAdjacentHTML('beforeend', itemRow({}, tb.children.length, true)); $('tbody tr:last-child .n', c).focus(); };
    c.addEventListener('click', e => { if (e.target.classList.contains('rm')) e.target.closest('tr').remove(); });
    sv.onclick = () => busy(sv, 'Saving…', async () => {
      const items = readItems(c); if (!items.length) return toast('Add at least one food.');
      await api('PATCH', `/meals/${id}`, { name: $('.mn', c).value.trim() || undefined, items }); toast('Saved. Thanks for keeping it accurate! ✅'); refresh();
    });
    $('.del', c).onclick = () => { if (confirm('Delete this meal?')) busy($('.del', c), '…', async () => { await api('DELETE', `/meals/${id}`); toast('Meal deleted'); refresh(); }); };
  });
}
function bindReplies(root, refresh) {
  $$('.quick button', root).forEach(b => b.onclick = () => { const i = b.closest('.card').querySelector('.rt'); i.value = b.textContent; i.focus(); });
  $$('.card[data-id]', root).forEach(c => {
    const send = $('.send', c); if (!send) return;
    const go = () => { const v = $('.rt', c).value.trim(); if (!v) return toast('Type a reply first'); busy(send, '…', async () => { await api('POST', `/meals/${c.dataset.id}/replies`, { body: v }); toast('Reply sent ✅'); refresh(); }); };
    send.onclick = go; $('.rt', c).onkeydown = e => { if (e.key === 'Enter') go(); };
  });
}
function barChart(days, goal) {
  const max = Math.max(goal * 1.15, ...days.map(d => d.kcal), 1), long = days.length > 10;
  return `<div class="chart" role="img" aria-label="Calories per day">${days.map(d => `<div class="col" title="${esc(d.date)}: ${d.meals} meals, ${d.kcal} kcal"><div class="b ${!d.meals ? 'none' : d.kcal > goal * 1.1 ? 'over' : ''}" style="height:${d.meals ? Math.max(4, d.kcal / max * 100) : 2}%"></div></div>`).join('')}<div class="gl" style="bottom:${goal / max * 100}%"><span>goal ${goal}</span></div></div>
  <div class="xl">${days.map((d, i) => `<span>${long ? (i % 2 ? '' : new Date(d.date + 'T12:00:00').getDate()) : new Date(d.date + 'T12:00:00').toLocaleDateString('en-IN', { weekday: 'short' }).slice(0, 2)}</span>`).join('')}</div>`;
}
const dayNav = (cur, today, id = 'dn') => `<div class="dnav"><button class="btn s" id="${id}p" aria-label="Previous day">‹</button><div class="t">${dateLabel(cur, today)}${cur !== today ? ` <small class="mut">· ${cur}</small>` : ''}</div><button class="btn s" id="${id}n" aria-label="Next day" ${cur >= today ? 'disabled' : ''}>›</button>${cur !== today ? `<button class="btn s" id="${id}t">Today</button>` : ''}</div>`;

/* ---------- client: today ---------- */
function motive(n, kcal, goal, streak) {
  if (!n) return streak ? `Your ${streak}-day streak is on the line. One quick photo keeps it alive. 🔥` : 'A quick photo of your next meal is all it takes to get started.';
  if (kcal < goal * .5) return "Great start! Every logged meal makes your coach's advice sharper.";
  if (kcal < goal * .9) return "You're well on your way. Keep going, you're doing great! 💪";
  if (kcal <= goal * 1.1) return 'Right on target today. Brilliant consistency! 🎯';
  return "A little over today, and that's okay. Tomorrow is a fresh plate. 🌱";
}
async function viewToday() {
  const [d, st] = await Promise.all([api('GET', '/meals' + (clientDate ? `?date=${clientDate}` : '')), api('GET', '/stats?days=7')]);
  const today = st.today, cur = d.date, isToday = cur === today, t = d.totals, g = d.goalKcal, C = 2 * Math.PI * 54, name = esc(user.name.split(' ')[0]);
  const unreadBanner = user.unreadReplies ? `<div class="banner">💬 Your coach replied to ${user.unreadReplies === 1 ? 'a meal' : user.unreadReplies + ' meals'}. Look for the NEW tags below.</div>` : '';
  const needCoach = !user.coach ? `<div class="banner" style="background:var(--gl);color:var(--g)">👋 You are not linked to a coach yet. <a href="#/settings">Add an invite code</a> to share your meals.</div>` : '';
  const wd = st.days, mx = Math.max(g * .5, ...wd.map(x => x.kcal), 1);
  app.innerHTML = `<div class="narrow">${unreadBanner}${needCoach}
  <div class="row" style="margin-bottom:10px"><div class="grow"><h1 class="hello">${isToday ? `${greet()}, ${name} 👋` : 'Meals on ' + dateLabel(cur, today)}</h1><div class="mut">${isToday ? motive(d.meals.length, t.kcal, g, st.streak) : 'Looking back at an earlier day.'}</div></div>${st.streak ? `<span class="streak">🔥 ${st.streak}-day streak</span>` : ''}</div>
  ${dayNav(cur, today)}
  <div class="card"><div class="top"><div class="ring"><svg width="132" height="132" viewBox="0 0 132 132"><circle cx="66" cy="66" r="54" fill="none" style="stroke:var(--soft)" stroke-width="13"/><circle id="rg" cx="66" cy="66" r="54" fill="none" stroke="${t.kcal > g * 1.1 ? '#f59e0b' : '#14804a'}" stroke-width="13" stroke-linecap="round" stroke-dasharray="${C}" stroke-dashoffset="${C}" style="transition:stroke-dashoffset .9s cubic-bezier(.2,.8,.2,1)"/></svg><div class="mid"><b>${R(t.kcal)}</b><small>of ${g} kcal</small></div></div>
  <div>${[['Protein', t.protein, g * .075, '--p'], ['Carbs', t.carbs, g * .125, '--c'], ['Fat', t.fat, g * .033, '--f']].map(([n, v, tg, c]) => `<div class="macro"><div class="l"><span>${n}</span><span class="mut">${R(v)}g / ${R(tg)}g</span></div><div class="bar"><i style="width:0;background:var(${c})" data-w="${Math.min(100, v / tg * 100)}"></i></div></div>`).join('')}<small><a href="#/settings">Change daily goal</a></small></div></div></div>
  ${isToday ? `<div class="card"><h2>Log a meal</h2><label class="drop" id="dz"><input type="file" id="ph" accept="image/jpeg,image/png,image/webp,image/*"><span class="ic">📸</span><b>Tap to take or choose a photo</b><span class="mut">or drag a picture here</span></label>
   <div class="mtypes" id="mt">${Object.entries(TYPES).map(([k, v]) => `<button type="button" data-t="${k}" class="${k === guessType() ? 'on' : ''}">${v}</button>`).join('')}</div>
   <textarea id="nt" rows="1" maxlength="300" placeholder="Optional note, e.g. “no sugar in my tea”" style="margin-top:8px"></textarea><div id="st"></div></div>` : ''}
  <div class="card"><h2>Your week</h2><div class="week">${wd.map((x, i) => `<div class="day${i === 6 ? ' today' : ''}"><div class="dot" title="${x.meals} meals, ${x.kcal} kcal"><i style="height:0" data-h="${x.meals ? Math.max(12, x.kcal / mx * 100) : 0}"></i></div><b>${new Date(x.date + 'T12:00:00').toLocaleDateString('en-IN', { weekday: 'short' }).slice(0, 3)}</b></div>`).join('')}</div></div>
  <h2 style="margin:18px 2px 10px">${isToday ? "Today's meals" : 'Meals'}</h2><div id="ms">${d.meals.slice().reverse().map(m => mealCard(m, { edit: true })).join('') || `<div class="card empty"><div class="big">🍽️</div><b>${isToday ? 'Nothing logged yet today' : 'No meals logged this day'}</b><p>${isToday ? 'Your first photo is just a tap away.' : ''}</p></div>`}</div></div>`;
  requestAnimationFrame(() => requestAnimationFrame(() => { $('#rg').style.strokeDashoffset = C * (1 - Math.min(1, t.kcal / g)); $$('[data-w]').forEach(e => e.style.width = e.dataset.w + '%'); $$('[data-h]').forEach(e => e.style.height = e.dataset.h + '%'); }));
  const go = date => { clientDate = date === today ? null : date; route(); };
  $('#dnp').onclick = () => go(addDays(cur, -1)); $('#dnn').onclick = () => go(addDays(cur, 1)); if ($('#dnt')) $('#dnt').onclick = () => go(today);
  bindMealEditing(app, route);
  if (isToday) bindUpload();
  if (user.unreadReplies) { api('POST', '/replies/read', {}).then(() => { user.unreadReplies = 0; renderNav(); }).catch(() => {}); }
}
function bindUpload() {
  let type = guessType();
  $$('#mt button').forEach(b => b.onclick = () => { type = b.dataset.t; $$('#mt button').forEach(x => x.classList.toggle('on', x === b)); });
  const upload = async f => {
    if (!f) return;
    if (!f.type.startsWith('image/')) { $('#st').innerHTML = errBox('Please choose a photo.'); return; }
    let img;
    try { img = await shrink(f); } catch (x) { $('#st').innerHTML = errBox(x); return; }
    const note = $('#nt').value;
    $('#dz').outerHTML = `<div class="prev"><img class="scan" src="${img}" alt="Your photo"><div><b>AI is reading your plate<span class="dots"></span></b><div class="mut">Naming foods and estimating portions</div></div></div>`;
    try { await api('POST', '/meals', { image: img, note, mealType: type }); confetti(); toast('Logged! Your coach will see this today 🎉'); route(); }
    catch (x) { await route(); $('#st').innerHTML = errBox(x); }
  };
  $('#ph').onchange = e => upload(e.target.files[0]);
  const dz = $('#dz');
  ['dragenter', 'dragover'].forEach(v => dz.addEventListener(v, e => { e.preventDefault(); dz.classList.add('over'); }));
  ['dragleave', 'drop'].forEach(v => dz.addEventListener(v, e => { e.preventDefault(); dz.classList.remove('over'); }));
  dz.addEventListener('drop', e => upload(e.dataTransfer.files[0]));
}

/* ---------- client: progress ---------- */
async function viewProgress() {
  const s = await api('GET', `/stats?days=${progressDays}`);
  app.innerHTML = `<div class="narrow"><h1 class="hello">Your progress</h1><div class="mut" style="margin-bottom:12px">Small steps, logged every day, add up.</div>
  <div class="tiles"><div class="tile g"><b>${s.streak}</b><span>🔥 Day streak</span></div><div class="tile"><b>${s.loggedDays}/${progressDays}</b><span>Days logged</span></div><div class="tile"><b>${s.avgKcal}</b><span>Avg kcal / day</span></div><div class="tile"><b>${s.avgProtein}g</b><span>Avg protein / day</span></div></div>
  <div class="card"><div class="row"><h2 style="margin:0" class="grow">Calories per day</h2><div class="filters"><button data-d="7" class="${progressDays === 7 ? 'on' : ''}">7 days</button><button data-d="30" class="${progressDays === 30 ? 'on' : ''}">30 days</button></div></div>${barChart(s.days, s.goalKcal)}<div class="tl"><span>Dashed line: your daily goal</span><span>Amber = over goal</span></div></div>
  <div class="card"><h2>✨ Weekly insight</h2><p class="mut" style="margin-top:0">A short, friendly read on your last 7 days.</p><button class="btn p" id="ins">Show my insight</button><div id="io" class="ins" hidden></div></div></div>`;
  $$('.filters button').forEach(b => b.onclick = () => { progressDays = +b.dataset.d; route(); });
  $('#ins').onclick = e => busy(e.target, 'Writing…', async () => { const r = await api('GET', '/insights'); const o = $('#io'); o.hidden = false; o.textContent = r.summary; });
}

/* ---------- coach ---------- */
async function viewClients() {
  const d = await api('GET', '/coach/overview' + (coachDate ? `?date=${coachDate}` : ''));
  const cl = d.clients, nl = cl.filter(c => c.notLogged), meals = cl.reduce((s, c) => s + c.meals.length, 0), link = `${location.origin}/?invite=${d.inviteCode}`;
  let q = '', f = 'all';
  app.innerHTML = `<div class="row" style="margin-bottom:12px"><div class="grow"><h1 class="hello">Your clients</h1><div class="mut">${d.date} · ${!cl.length ? 'Invite your first client below.' : nl.length ? `${nl.length} still to log. A friendly nudge goes a long way.` : 'Everyone has logged today. Great coaching! 🎉'}</div></div></div>
  ${cl.length ? `<div class="tiles"><div class="tile"><b>${cl.length}</b><span>Clients</span></div><div class="tile g"><b>${cl.length - nl.length}</b><span>Logged today</span></div><div class="tile ${nl.length ? 'w' : ''}"><b>${nl.length}</b><span>Not logged yet</span></div><div class="tile"><b>${meals}</b><span>Meals today</span></div></div>
  <div class="tools"><input id="q" type="search" placeholder="Search clients…" aria-label="Search clients"><div class="filters">${[['all', 'All'], ['no', 'Not logged'], ['yes', 'Logged']].map(([k, l]) => `<button data-f="${k}" class="${k === 'all' ? 'on' : ''}">${l}</button>`).join('')}</div></div><div class="grid" id="gr"></div>` : ''}
  <div class="card" style="${cl.length ? 'margin-top:16px' : ''}"><h2>${cl.length ? 'Invite more clients' : '👋 Get your first client'}</h2><p class="mut" style="margin-top:0">Share your invite code. Clients enter it when they sign up, or later in Settings.</p><div class="row"><span class="code" id="cd">${esc(d.inviteCode)}</span><button class="btn s" id="cc">Copy code</button><button class="btn p" id="cl">Copy invite link</button></div></div>`;
  const draw = () => {
    const list = cl.filter(c => (f === 'all' || (f === 'no') === c.notLogged) && c.name.toLowerCase().includes(q));
    $('#gr').innerHTML = list.map(c => `<div class="card cc" data-id="${c.id}" tabindex="0" role="link" aria-label="Open ${esc(c.name)}"><div class="who"><div class="av" style="background:${avc(c.name)}">${esc(c.name.trim()[0] || '?').toUpperCase()}</div><div style="flex:1;min-width:0"><h2>${esc(c.name)}</h2>${c.notLogged ? `<span class="pill w">Nothing logged today</span>` : `<small>${c.meals.length} meal${c.meals.length > 1 ? 's' : ''} · ${R(c.totals.kcal)} / ${c.goalKcal} kcal</small>`}</div>${c.streak ? `<span class="streak" style="padding:3px 9px;font-size:12px">🔥 ${c.streak}</span>` : ''}</div>
     ${c.notLogged ? `<small class="mut">Last logged ${esc(ago(c.lastLoggedAt))}</small>` : `<div class="macros">${macChips(c.totals)}</div><div class="bar spark"><i style="width:${Math.min(100, c.totals.kcal / c.goalKcal * 100)}%;background:var(--g)"></i></div>`}
     ${c.needsReply ? '<div style="margin-top:8px"><span class="pill a">💬 Needs your reply</span></div>' : ''}</div>`).join('') || '<div class="card empty" style="grid-column:1/-1"><div class="big">🔍</div><b>No clients match</b></div>';
    $$('.cc').forEach(el => { const open = () => { location.hash = '#/client/' + el.dataset.id; }; el.onclick = open; el.onkeydown = e => { if (e.key === 'Enter') open(); }; });
  };
  if (cl.length) { draw(); $('#q').oninput = e => { q = e.target.value.toLowerCase(); draw(); }; $$('.filters button').forEach(b => b.onclick = () => { f = b.dataset.f; $$('.filters button').forEach(x => x.classList.toggle('on', x === b)); draw(); }); }
  const copy = (t, m) => navigator.clipboard.writeText(t).then(() => toast(m), () => toast('Copy failed. Select the code and copy it manually.'));
  $('#cc').onclick = () => copy(d.inviteCode, 'Code copied'); $('#cl').onclick = () => copy(link, 'Invite link copied');
}
async function viewCoachClient(id) {
  const d = await api('GET', `/coach/clients/${id}` + (coachDate ? `?date=${coachDate}` : '')), c = d.client, s = d.stats;
  const today = s.today, cur = d.date, name = esc(c.name);
  app.innerHTML = `<div class="narrow"><a class="back" href="#/clients">‹ All clients</a>
  <div class="who" style="margin-bottom:12px"><div class="av" style="background:${avc(c.name)};width:52px;height:52px;font-size:20px">${esc(c.name.trim()[0] || '?').toUpperCase()}</div><div style="flex:1"><h1 class="hello" style="margin:0">${name}</h1><div class="mut">${esc(c.email)} · goal ${c.goalKcal} kcal</div></div>${s.streak ? `<span class="streak">🔥 ${s.streak}-day streak</span>` : ''}</div>
  <div class="tiles"><div class="tile"><b>${s.loggedDays}/14</b><span>Days logged</span></div><div class="tile"><b>${s.avgKcal}</b><span>Avg kcal</span></div><div class="tile"><b>${s.avgProtein}g</b><span>Avg protein</span></div><div class="tile"><b>${R(d.totals.kcal)}</b><span>kcal on ${esc(dateLabel(cur, today).toLowerCase())}</span></div></div>
  <div class="card"><h2>Last 14 days</h2>${barChart(s.days, c.goalKcal)}<div class="row" style="margin-top:12px"><button class="btn s" id="ins">✨ Weekly summary</button></div><div id="io" class="ins" hidden></div></div>
  ${dayNav(cur, today)}
  <div id="ms">${d.meals.slice().reverse().map(m => mealCard(m, { reply: c.name.split(' ')[0], tz: c.timezone })).join('') || '<div class="card empty"><div class="big">🍽️</div><b>No meals on this day</b></div>'}</div>
  <div style="margin-top:18px"><button class="btn s danger-o" id="rm">Remove this client</button></div></div>`;
  const go = date => { coachDate = date === today ? null : date; route(); };
  $('#dnp').onclick = () => go(addDays(cur, -1)); $('#dnn').onclick = () => go(addDays(cur, 1)); if ($('#dnt')) $('#dnt').onclick = () => go(today);
  $('#ins').onclick = e => busy(e.target, 'Writing…', async () => { const r = await api('GET', `/coach/clients/${id}/insights`); const o = $('#io'); o.hidden = false; o.textContent = r.summary; });
  $('#rm').onclick = e => { if (confirm(`Remove ${c.name} from your clients? They keep their account and data.`)) busy(e.target, '…', async () => { await api('DELETE', `/coach/clients/${id}`); toast('Client removed'); location.hash = '#/clients'; }); };
  bindReplies(app, route);
}

/* ---------- settings ---------- */
async function viewSettings() {
  await loadMe();
  const u = user, zones = (Intl.supportedValuesOf ? Intl.supportedValuesOf('timeZone') : [u.timezone]);
  if (!zones.includes(u.timezone)) zones.unshift(u.timezone);
  app.innerHTML = `<div class="narrow"><h1 class="hello">Settings</h1><div class="mut" style="margin-bottom:14px">${esc(u.email)} · ${u.role === 'coach' ? 'Coach' : 'Client'}</div>
  <div class="card sec"><h2>Profile</h2><form id="pf"><div class="field"><label for="n">Name</label><input id="n" value="${esc(u.name)}" maxlength="60" required></div>
   ${u.role === 'client' ? `<div class="field"><label for="g">Daily calorie goal (kcal)</label><input id="g" type="number" min="800" max="6000" step="50" value="${u.goalKcal}"></div>` : ''}
   <div class="field"><label for="z">Timezone</label><select id="z">${zones.map(z => `<option ${z === u.timezone ? 'selected' : ''}>${esc(z)}</option>`).join('')}</select><div class="hint">Decides when your "day" starts and ends.</div></div><button class="btn p" type="submit">Save profile</button></form></div>
  ${u.role === 'client' ? `<div class="card sec"><h2>Your coach</h2>${u.coach ? `<div class="kv"><span>Linked to <b>${esc(u.coach.name)}</b></span><button class="btn s" id="lv">Leave</button></div><p class="mut" style="font-size:13px;margin-bottom:0">Your coach can see your meals and reply to them.</p>` : `<p class="mut" style="margin-top:0">Enter the invite code your coach gave you.</p><form class="ifield" id="jf"><input id="ic" placeholder="Invite code" maxlength="20" autocapitalize="characters" required><button class="btn p" type="submit">Join</button></form>`}</div>`
      : `<div class="card sec"><h2>Invite code</h2><div class="row"><span class="code">${esc(u.inviteCode)}</span><button class="btn s" id="ro">Generate a new code</button></div><p class="mut" style="font-size:13px;margin-bottom:0">A new code stops the old one from working. Existing clients stay linked.</p></div>`}
  <div class="card sec"><h2>Password</h2><form id="pwf"><div class="field"><label for="cp">Current password</label><input id="cp" type="password" autocomplete="current-password" required></div><div class="field"><label for="np">New password</label><input id="np" type="password" autocomplete="new-password" minlength="8" maxlength="72" required><div class="hint">At least 8 characters. Changing it signs you out on other devices.</div></div><button class="btn p" type="submit">Change password</button></form></div>
  <div class="card sec"><h2>Your data</h2><p class="mut" style="margin-top:0">Download everything you've logged, or delete your account and all its data permanently.</p><div class="row"><button class="btn s" id="ex">Download my data</button><button class="btn s danger-o" id="dl">Delete my account</button></div></div>
  <button class="btn s" id="lo">Sign out</button></div>`;
  $('#pf').onsubmit = e => { e.preventDefault(); busy(e.target.querySelector('button'), 'Saving…', async () => { const b = { name: $('#n').value, timezone: $('#z').value }; if ($('#g')) b.goalKcal = +$('#g').value; user = { ...user, ...(await api('PATCH', '/me', b)).user }; toast('Profile saved ✅'); }); };
  if ($('#jf')) $('#jf').onsubmit = e => { e.preventDefault(); busy(e.target.querySelector('button'), '…', async () => { await api('POST', '/me/coach', { inviteCode: $('#ic').value }); toast('Linked to your coach 🎉'); route(); }); };
  if ($('#lv')) $('#lv').onclick = () => { if (confirm('Stop sharing your meals with this coach?')) busy($('#lv'), '…', async () => { await api('DELETE', '/me/coach'); toast('You left your coach'); route(); }); };
  if ($('#ro')) $('#ro').onclick = () => { if (confirm('Generate a new invite code? The old one will stop working.')) busy($('#ro'), '…', async () => { await api('POST', '/coach/invite/rotate', {}); toast('New code created'); route(); }); };
  $('#pwf').onsubmit = e => { e.preventDefault(); busy(e.target.querySelector('button'), 'Changing…', async () => { await api('POST', '/me/password', { current: $('#cp').value, next: $('#np').value }); e.target.reset(); toast('Password changed ✅'); }); };
  $('#ex').onclick = e => busy(e.target, 'Preparing…', async () => { const j = await api('GET', '/me/export'); const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([JSON.stringify(j, null, 2)], { type: 'application/json' })); a.download = 'plateside-data.json'; a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 1000); });
  $('#dl').onclick = () => { const p = prompt('This permanently deletes your account and all meals. Type your password to confirm.'); if (p) busy($('#dl'), '…', async () => { await api('DELETE', '/me', { password: p }); user = null; renderNav(); showAuth('register'); toast('Account deleted'); }); };
  $('#lo').onclick = e => busy(e.target, '…', async () => { await api('POST', '/auth/logout', {}); user = null; clientDate = coachDate = null; renderNav(); showAuth('login'); });
}

/* ---------- boot ---------- */
(async () => {
  try { await loadMe(); } catch (e) { user = null; }
  if (!user) { const inv = new URLSearchParams(location.search).get('invite'); showAuth(inv ? 'register' : 'login'); return; }
  if (!location.hash || location.hash === '#/') location.hash = user.role === 'coach' ? '#/clients' : '#/today';
  route();
})();
