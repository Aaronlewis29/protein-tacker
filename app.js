/* Macro Log — calorie + protein tracker
   Pure static. No backend. Data and API key live in this browser only. */

'use strict';

// ─────────────────────────────────────────────────────────
// Constants
// ─────────────────────────────────────────────────────────
const APP_VERSION = 9;   // must match the ?v= in index.html
const STORE_KEY = 'macrolog.v1';
const RING_C = 2 * Math.PI * 52;          // circumference of r=52 ring
const OFF_URL = 'https://world.openfoodfacts.org/api/v2/product/';
const OFF_SEARCH = 'https://world.openfoodfacts.org/cgi/search.pl';
const ZXING_CDN = 'https://cdn.jsdelivr.net/npm/@zxing/library@0.21.3/umd/index.min.js';
const ANTHROPIC_URL = 'https://api.anthropic.com/v1/messages';
const GEMINI_URL = 'https://generativelanguage.googleapis.com/v1beta/models/';
const GEMINI_LIST = 'https://generativelanguage.googleapis.com/v1beta/models';

/* Both providers allow browser-direct calls. Gemini has a free tier;
   Anthropic is paid. Model names drift, so they stay editable in Settings. */
const PROVIDERS = {
  gemini: {
    // Only a starting guess. Google retires model names on a rolling basis
    // (2.0 Flash was shut off in June 2026), so the real list comes from the
    // Find button, and a dead name is auto-repaired on first use.
    name: 'Google Gemini — free tier',
    defaultModel: 'gemini-2.5-flash',
    suggest: ['gemini-2.5-flash', 'gemini-2.5-flash-lite'],
    keyHint: 'aistudio.google.com/apikey',
    keyUrl: 'https://aistudio.google.com/apikey',
  },
  anthropic: {
    name: 'Anthropic Claude — paid',
    defaultModel: 'claude-sonnet-5',
    suggest: ['claude-sonnet-5', 'claude-opus-5', 'claude-haiku-4-5-20251001'],
    keyHint: 'console.anthropic.com',
    keyUrl: 'https://console.anthropic.com/settings/keys',
  },
};

const SOURCE_LABEL = {
  ai: 'photo', label: 'label', barcode: 'barcode', search: 'database', manual: 'manual',
};

// ─────────────────────────────────────────────────────────
// State
// ─────────────────────────────────────────────────────────
const DEFAULTS = {
  entries: [],
  targets: { calories: 2000, protein: 150 },
  settings: { apiKey: '', provider: 'gemini', model: 'gemini-2.5-flash' },
};

let state = load();
let viewDate = todayKey();

// Declaration, not a const arrow: load() runs above this line.
function freshDefaults() {
  return JSON.parse(JSON.stringify(DEFAULTS));
}

function load() {
  try {
    const raw = localStorage.getItem(STORE_KEY);
    if (!raw) return freshDefaults();
    const parsed = JSON.parse(raw);
    return {
      entries: Array.isArray(parsed.entries) ? parsed.entries : [],
      targets: { ...DEFAULTS.targets, ...(parsed.targets || {}) },
      settings: { ...DEFAULTS.settings, ...(parsed.settings || {}) },
    };
  } catch {
    return freshDefaults();
  }
}

function save() {
  try {
    localStorage.setItem(STORE_KEY, JSON.stringify(state));
  } catch {
    toast('Could not save — storage may be full or blocked.', true);
  }
}

// ─────────────────────────────────────────────────────────
// Date helpers
// ─────────────────────────────────────────────────────────
function todayKey(d = new Date()) {
  const p = n => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

function shiftKey(key, days) {
  const [y, m, d] = key.split('-').map(Number);
  const dt = new Date(y, m - 1, d + days);
  return todayKey(dt);
}

function prettyDate(key) {
  const [y, m, d] = key.split('-').map(Number);
  const dt = new Date(y, m - 1, d);
  if (key === todayKey()) return 'Today';
  if (key === shiftKey(todayKey(), -1)) return 'Yesterday';
  return dt.toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' });
}

// ─────────────────────────────────────────────────────────
// Totals
// ─────────────────────────────────────────────────────────
function entriesFor(key) {
  return state.entries.filter(e => e.date === key);
}

function totalsFor(key) {
  return entriesFor(key).reduce(
    (acc, e) => ({
      calories: acc.calories + (Number(e.calories) || 0),
      protein: acc.protein + (Number(e.protein) || 0),
    }),
    { calories: 0, protein: 0 }
  );
}

function lastNDays(n) {
  const out = [];
  for (let i = n - 1; i >= 0; i--) {
    const key = shiftKey(todayKey(), -i);
    out.push({ key, ...totalsFor(key) });
  }
  return out;
}

// ─────────────────────────────────────────────────────────
// Rendering
// ─────────────────────────────────────────────────────────
const $ = sel => document.querySelector(sel);

function render() {
  renderRings();
  renderEntries();
  renderChart();
}

function renderRings() {
  const t = totalsFor(viewDate);
  const { calories: gc, protein: gp } = state.targets;

  setRing('#ring-cal', t.calories, gc);
  setRing('#ring-pro', t.protein, gp);

  $('#cal-now').textContent = Math.round(t.calories);
  $('#pro-now').textContent = Math.round(t.protein);
  $('#cal-goal').textContent = `/ ${gc}`;
  $('#pro-goal').textContent = `/ ${gp}`;
  $('#today-date').textContent = prettyDate(viewDate);
}

function setRing(sel, value, goal) {
  const el = $(sel);
  const pct = goal > 0 ? Math.min(value / goal, 1) : 0;
  el.style.strokeDashoffset = String(RING_C * (1 - pct));
  el.classList.toggle('over', goal > 0 && value > goal * 1.05);
}

function renderEntries() {
  const list = $('#entries');
  const rows = entriesFor(viewDate).sort((a, b) => b.ts - a.ts);

  $('#empty').hidden = rows.length > 0;
  list.replaceChildren();

  for (const e of rows) {
    const li = document.createElement('li');
    li.className = 'entry';

    const main = document.createElement('div');
    main.className = 'entry-main';
    const name = document.createElement('div');
    name.className = 'entry-name';
    name.textContent = e.name;
    const sub = document.createElement('div');
    sub.className = 'entry-sub';
    const time = new Date(e.ts).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
    sub.textContent = [e.portion, SOURCE_LABEL[e.source] || e.source, time].filter(Boolean).join(' · ');
    main.append(name, sub);

    const nums = document.createElement('div');
    nums.className = 'entry-nums';
    nums.innerHTML = `<b></b><br><span class="p"></span>`;
    nums.querySelector('b').textContent = `${Math.round(e.calories)} kcal`;
    nums.querySelector('.p').textContent = `${Math.round(e.protein)} g`;

    const del = document.createElement('button');
    del.className = 'del';
    del.type = 'button';
    del.setAttribute('aria-label', `Delete ${e.name}`);
    del.textContent = '×';
    del.onclick = () => {
      state.entries = state.entries.filter(x => x.id !== e.id);
      save();
      render();
      toast('Deleted');
    };

    li.append(main, nums, del);
    list.append(li);
  }
}

function renderChart() {
  const days = lastNDays(7);
  const maxCal = Math.max(state.targets.calories, ...days.map(d => d.calories), 1);
  const maxPro = Math.max(state.targets.protein, ...days.map(d => d.protein), 1);

  const chart = $('#chart');
  chart.replaceChildren();

  for (const d of days) {
    const col = document.createElement('div');
    col.className = 'bar-col' + (d.key === todayKey() ? ' today' : '');

    const pair = document.createElement('div');
    pair.className = 'bar-pair';

    const c = document.createElement('div');
    c.className = 'bar cal';
    c.style.height = `${(d.calories / maxCal) * 100}%`;
    c.title = `${Math.round(d.calories)} kcal`;

    const p = document.createElement('div');
    p.className = 'bar pro';
    p.style.height = `${(d.protein / maxPro) * 100}%`;
    p.title = `${Math.round(d.protein)} g protein`;

    pair.append(c, p);

    const lab = document.createElement('div');
    lab.className = 'bar-label';
    const [y, m, dd] = d.key.split('-').map(Number);
    lab.textContent = new Date(y, m - 1, dd).toLocaleDateString(undefined, { weekday: 'narrow' });

    col.append(pair, lab);
    chart.append(col);
  }

  const logged = days.filter(d => d.calories > 0 || d.protein > 0);
  if (logged.length) {
    const ac = logged.reduce((s, d) => s + d.calories, 0) / logged.length;
    const ap = logged.reduce((s, d) => s + d.protein, 0) / logged.length;
    $('#week-avg').textContent =
      `Average over ${logged.length} logged day${logged.length > 1 ? 's' : ''}: ${Math.round(ac)} kcal, ${Math.round(ap)} g protein.`;
  } else {
    $('#week-avg').textContent = 'No days logged yet this week.';
  }
}

// ─────────────────────────────────────────────────────────
// Adding entries
// ─────────────────────────────────────────────────────────
function addEntry({ name, portion = '', calories, protein, source }) {
  state.entries.push({
    id: crypto.randomUUID(),
    date: viewDate,
    ts: Date.now(),
    name: String(name).slice(0, 120),
    portion: String(portion).slice(0, 80),
    calories: Math.max(0, Number(calories) || 0),
    protein: Math.max(0, Number(protein) || 0),
    source,
  });
  save();
  render();
}

// ─────────────────────────────────────────────────────────
// Modal + toast
// ─────────────────────────────────────────────────────────
let onCloseHook = null;

function openModal(title, buildBody, onClose) {
  $('#modal-title').textContent = title;
  const body = $('#modal-body');
  body.replaceChildren();
  // Set the hook BEFORE buildBody: flows that own a camera stream replace it
  // with their own teardown, and assigning afterwards would wipe that out.
  onCloseHook = onClose || null;

  // Make the overlay visible BEFORE building. Safari refuses to play a <video>
  // that sits inside a display:none subtree, so starting the camera from
  // buildBody while the modal was still hidden made play() reject.
  // Both happen in one task, so nothing flashes.
  showOverlay(true);
  document.body.style.overflow = 'hidden';
  buildBody(body);
}

/* Inline style, not just the `hidden` attribute. An inline declaration beats
   any stylesheet rule, so the modal behaves correctly even if styles.css is
   stale in cache or fails to load at all. */
function showOverlay(show) {
  const ov = $('#overlay');
  ov.hidden = !show;
  ov.style.display = show ? 'flex' : 'none';
}

function closeModal() {
  showOverlay(false);
  document.body.style.overflow = '';
  if (onCloseHook) { try { onCloseHook(); } catch {} onCloseHook = null; }
  $('#modal-body').replaceChildren();
}

let toastTimer;
function toast(msg, isError = false) {
  const el = $('#toast');
  el.textContent = msg;
  el.classList.toggle('err', isError);
  el.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { el.hidden = true; }, isError ? 5200 : 2400);
}

function spinner(container, text) {
  container.replaceChildren();
  const s = document.createElement('div');
  s.className = 'spinner';
  const p = document.createElement('p');
  p.className = 'hint';
  p.style.textAlign = 'center';
  p.textContent = text;
  container.append(s, p);
}

// ─────────────────────────────────────────────────────────
// Anthropic vision
// ─────────────────────────────────────────────────────────
function needKey() {
  if (state.settings.apiKey) return false;
  toast('Add a free Gemini API key in Settings to use photos.', true);
  openSettings();
  return true;
}

async function fileToBase64(file) {
  const buf = await file.arrayBuffer();
  const bytes = new Uint8Array(buf);
  let bin = '';
  const CHUNK = 0x8000;
  for (let i = 0; i < bytes.length; i += CHUNK) {
    bin += String.fromCharCode.apply(null, bytes.subarray(i, i + CHUNK));
  }
  return btoa(bin);
}

/** Downscale so we do not ship a 12 MP phone photo to the API. */
async function shrinkImage(file, maxDim = 1100, quality = 0.82) {
  const src = await decodeImage(file);
  const scale = Math.min(1, maxDim / Math.max(src.width, src.height));
  const w = Math.max(1, Math.round(src.width * scale));
  const h = Math.max(1, Math.round(src.height * scale));

  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  canvas.getContext('2d').drawImage(src.image, 0, 0, w, h);
  src.release();

  const blob = await new Promise(res => canvas.toBlob(res, 'image/jpeg', quality));
  if (!blob) throw new Error('Could not process that image. Try a JPEG or PNG.');
  return { data: await fileToBase64(blob), mediaType: 'image/jpeg' };
}

/** createImageBitmap is fastest but chokes on some formats (notably HEIC from
    iPhones in non-Safari browsers). Fall back to decoding via an <img>. */
async function decodeImage(file) {
  if (typeof createImageBitmap === 'function') {
    try {
      const bmp = await createImageBitmap(file);
      return { image: bmp, width: bmp.width, height: bmp.height, release: () => bmp.close?.() };
    } catch { /* fall through */ }
  }

  const url = URL.createObjectURL(file);
  try {
    const img = await new Promise((resolve, reject) => {
      const el = new Image();
      el.onload = () => resolve(el);
      el.onerror = () => reject(new Error(
        'This browser could not read that image. If it came from an iPhone it may be HEIC — '
        + 'set Camera to "Most Compatible" in iOS Settings, or take the shot inside this app.'));
      el.src = url;
    });
    return {
      image: img,
      width: img.naturalWidth,
      height: img.naturalHeight,
      release: () => URL.revokeObjectURL(url),
    };
  } catch (err) {
    URL.revokeObjectURL(url);
    throw err;
  }
}

async function askVision(imageB64, mediaType, prompt) {
  return state.settings.provider === 'anthropic'
    ? askAnthropic(imageB64, mediaType, prompt)
    : askGemini(imageB64, mediaType, prompt);
}

/* Never swallow the provider's own message — Google in particular returns
   very specific 403s (API disabled, referrer blocked, key restricted) that
   each need a different fix. Lead with the likely cause, then quote them. */
async function apiFail(res, who) {
  let detail = '';
  try {
    const j = await res.json();
    detail = j?.error?.message || j?.[0]?.error?.message || '';
  } catch {}

  const d = detail.toLowerCase();
  let lead;

  if (/has not been used in project|is disabled|enable the api|serviceusage/.test(d)) {
    lead = 'The Generative Language API is not enabled on the key\'s Google Cloud project. '
         + 'Open the link in the error below and click Enable, then wait a minute.';
  } else if (/referer|referrer|not authorized to use this api|api_key_http_referrer/.test(d)) {
    lead = 'This key is restricted to certain websites and your page is not on the list. '
         + 'In Google AI Studio or Cloud Console, either remove the restriction or add '
         + `"${location.origin}/*" to the allowed referrers.`;
  } else if (/api key not valid|invalid api key|api_key_invalid|standard key|auth key/.test(d)) {
    lead = state.settings.apiKey.startsWith('AIza')
      ? 'This is an older "standard" Google key (AIza…). Google stopped accepting these in 2026. '
        + 'Create a new key at aistudio.google.com/apikey — it will start with "AQ.Ab" — and paste that instead.'
      : 'Google says the key is not valid. Re-copy it from aistudio.google.com/apikey.';
  } else if (/expired/.test(d)) {
    lead = 'This key has expired. Create a new one.';
  } else if (res.status === 401 || res.status === 403) {
    lead = `${who} refused the request (${res.status}).`;
  } else if (res.status === 429) {
    lead = who === 'Gemini'
      ? 'Free-tier limit hit. Wait a minute, or switch to Flash-Lite in Settings.'
      : 'Rate limited — wait a moment and retry.';
  } else if (res.status === 404 || /not found|not supported|unsupported model/.test(d)) {
    lead = `Model "${state.settings.model}" does not exist for this key. `
         + 'Google retires model names regularly. Open Settings and press Find next to the '
         + 'Model box — it lists the models your key can actually use and picks the best one.';
  } else if (/credit|balance|quota/.test(d)) {
    lead = `${who} account is out of credit or quota.`;
  } else {
    lead = `${who} error ${res.status}.`;
  }

  throw new Error(detail && !lead.includes(detail) ? `${lead}\n\nGoogle said: ${detail}` : lead);
}

async function askGemini(imageB64, mediaType, prompt, retried = false) {
  const url = `${GEMINI_URL}${encodeURIComponent(state.settings.model)}:generateContent`;
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-goog-api-key': state.settings.apiKey,
    },
    body: JSON.stringify({
      contents: [{
        parts: [
          { inline_data: { mime_type: mediaType, data: imageB64 } },
          { text: prompt },
        ],
      }],
      generationConfig: {
        maxOutputTokens: 1600,
        temperature: 0.2,
        responseMimeType: 'application/json',
      },
    }),
  });

  if (!res.ok) {
    // A retired model name shouldn't need manual intervention: look up what
    // this key can use, switch to it permanently, and retry once.
    if (await recoverModel(res, retried)) {
      return askGemini(imageB64, mediaType, prompt, true);
    }
    await apiFail(res, 'Gemini');
  }

  const json = await res.json();
  const cand = json.candidates?.[0];
  if (!cand) throw new Error('Gemini returned nothing. Try a clearer photo.');
  if (cand.finishReason === 'SAFETY') throw new Error('Gemini blocked that image.');
  return (cand.content?.parts || []).map(p => p.text || '').join('');
}

/** True if the failure was "model not found" AND we successfully switched. */
async function recoverModel(res, alreadyRetried) {
  if (alreadyRetried || state.settings.provider !== 'gemini') return false;
  if (res.status !== 404 && res.status !== 400) return false;

  let detail = '';
  try { detail = (await res.clone().json())?.error?.message || ''; } catch {}
  if (!/not found|not supported|unsupported model|is not available/i.test(detail)
      && res.status !== 404) return false;

  try {
    const models = await listGeminiModels();
    const old = state.settings.model;
    if (!models.length || models[0] === old) return false;
    state.settings.model = models[0];
    save();
    toast(`${old} is retired — switched to ${models[0]}`);
    console.info(`Model auto-migrated: ${old} -> ${models[0]}`);
    return true;
  } catch (err) {
    console.warn('Model auto-recovery failed:', err);
    return false;
  }
}

async function askAnthropic(imageB64, mediaType, prompt) {
  const res = await fetch(ANTHROPIC_URL, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-api-key': state.settings.apiKey,
      'anthropic-version': '2023-06-01',
      'anthropic-dangerous-direct-browser-access': 'true',
    },
    body: JSON.stringify({
      model: state.settings.model,
      max_tokens: 1600,
      messages: [{
        role: 'user',
        content: [
          { type: 'image', source: { type: 'base64', media_type: mediaType, data: imageB64 } },
          { type: 'text', text: prompt },
        ],
      }],
    }),
  });

  if (!res.ok) await apiFail(res, 'Anthropic');

  const json = await res.json();
  return json.content.map(b => b.text || '').join('');
}

/** Models sometimes wrap JSON in prose or fences. Dig it out. */
function extractJSON(text) {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  const candidate = fenced ? fenced[1] : text;
  try { return JSON.parse(candidate.trim()); } catch {}
  const start = candidate.indexOf('{');
  const end = candidate.lastIndexOf('}');
  if (start !== -1 && end > start) {
    try { return JSON.parse(candidate.slice(start, end + 1)); } catch {}
  }
  throw new Error('Could not read the model response. Try a clearer photo.');
}

const MEAL_PROMPT = `You are a nutrition estimator. Identify every distinct food and drink in this photo.

For each item estimate the visible portion and its calories and protein. Use common reference objects (plate size, cutlery, hands) to judge portion size.

Respond with ONLY this JSON, no other text:
{"items":[{"name":"short food name","portion":"e.g. 150 g or 1 medium","calories":number,"protein":number}],"note":"one short sentence on confidence, or empty string"}

If the photo contains no food, return {"items":[],"note":"No food detected"}.`;

const LABEL_PROMPT = `Read this nutrition facts label exactly as printed. Do not estimate — transcribe.

Respond with ONLY this JSON, no other text:
{"product":"product name if visible else empty","serving":"serving size as printed","perServing":{"calories":number,"protein":number},"per100g":{"calories":number,"protein":number},"note":"short note, or empty string"}

If a per-100g column is absent, set per100g to null. If energy is only in kJ, convert to kcal by dividing by 4.184. Protein is in grams.`;

// ─────────────────────────────────────────────────────────
// Flow: meal photo
// ─────────────────────────────────────────────────────────
function flowPhoto() {
  if (needKey()) return;
  pickImage(async (file, body) => {
    spinner(body, 'Identifying food…');
    try {
      const { data, mediaType } = await shrinkImage(file);
      const raw = await askVision(data, mediaType, MEAL_PROMPT);
      const parsed = extractJSON(raw);
      const items = (parsed.items || []).filter(i => i && i.name);
      if (!items.length) {
        body.replaceChildren();
        const p = document.createElement('p');
        p.className = 'note';
        p.textContent = parsed.note || 'No food detected in that photo.';
        body.append(p);
        addManualForm(body, 'ai');
        return;
      }
      showFound(body, items, parsed.note, 'ai');
    } catch (err) {
      showError(body, err);
    }
  }, 'Meal photo');
}

// ─────────────────────────────────────────────────────────
// Flow: nutrition label
// ─────────────────────────────────────────────────────────
function flowLabel() {
  if (needKey()) return;
  pickImage(async (file, body) => {
    spinner(body, 'Reading label…');
    try {
      const { data, mediaType } = await shrinkImage(file, 1400, 0.88);
      const raw = await askVision(data, mediaType, LABEL_PROMPT);
      const d = extractJSON(raw);
      showLabelResult(body, d);
    } catch (err) {
      showError(body, err);
    }
  }, 'Nutrition label');
}

function showLabelResult(body, d) {
  body.replaceChildren();

  const per = d.perServing || {};
  const per100 = d.per100g || null;

  if (d.note) {
    const n = document.createElement('p');
    n.className = 'note';
    n.textContent = d.note;
    body.append(n);
  }

  const wrap = document.createElement('div');
  wrap.className = 'stack';
  wrap.innerHTML = `
    <div>
      <label for="l-name">Product</label>
      <input id="l-name" type="text">
    </div>
    <div>
      <label for="l-basis">Amount eaten</label>
      <select id="l-basis"></select>
    </div>
    <div id="l-grams-wrap" hidden>
      <label for="l-grams">Grams eaten</label>
      <input id="l-grams" type="number" min="0" step="1" value="100">
    </div>
    <div class="row">
      <div><label for="l-cal">Calories</label><input id="l-cal" type="number" min="0" step="1"></div>
      <div><label for="l-pro">Protein (g)</label><input id="l-pro" type="number" min="0" step="0.1"></div>
    </div>
  `;
  body.append(wrap);

  const nameEl = wrap.querySelector('#l-name');
  const basisEl = wrap.querySelector('#l-basis');
  const gramsWrap = wrap.querySelector('#l-grams-wrap');
  const gramsEl = wrap.querySelector('#l-grams');
  const calEl = wrap.querySelector('#l-cal');
  const proEl = wrap.querySelector('#l-pro');

  nameEl.value = d.product || '';

  const opts = [];
  if (per.calories != null) opts.push(['serving', `1 serving${d.serving ? ` (${d.serving})` : ''}`]);
  if (per100) opts.push(['grams', 'Weigh it in grams']);
  if (!opts.length) opts.push(['serving', 'As shown']);
  for (const [v, t] of opts) {
    const o = document.createElement('option');
    o.value = v; o.textContent = t;
    basisEl.append(o);
  }

  function recalc() {
    const mode = basisEl.value;
    gramsWrap.hidden = mode !== 'grams';
    if (mode === 'serving') {
      calEl.value = Math.round(per.calories || 0);
      proEl.value = round1(per.protein || 0);
    } else {
      const g = Number(gramsEl.value) || 0;
      calEl.value = Math.round(((per100?.calories || 0) * g) / 100);
      proEl.value = round1(((per100?.protein || 0) * g) / 100);
    }
  }
  basisEl.onchange = recalc;
  gramsEl.oninput = recalc;
  recalc();

  const btn = document.createElement('button');
  btn.className = 'primary';
  btn.type = 'button';
  btn.textContent = 'Add to log';
  btn.style.marginTop = '18px';
  btn.onclick = () => {
    if (!nameEl.value.trim()) { toast('Give it a name.', true); nameEl.focus(); return; }
    addEntry({
      name: nameEl.value.trim(),
      portion: basisEl.value === 'grams' ? `${gramsEl.value} g` : (d.serving || '1 serving'),
      calories: calEl.value,
      protein: proEl.value,
      source: 'label',
    });
    closeModal();
    toast('Added');
  };
  body.append(btn);
}

// ─────────────────────────────────────────────────────────
// Flow: barcode
// ─────────────────────────────────────────────────────────
function flowBarcode() {
  openModal('Scan barcode', body => {
    const video = document.createElement('video');
    // Safari needs these as attributes, not just properties, or it refuses
    // to autoplay the stream and opens fullscreen instead.
    video.setAttribute('playsinline', '');
    video.setAttribute('webkit-playsinline', '');
    video.setAttribute('muted', '');
    video.setAttribute('autoplay', '');
    video.muted = true;
    body.append(video);

    const hint = document.createElement('p');
    hint.className = 'hint';
    hint.textContent = 'Point the camera at the barcode.';
    body.append(hint);

    const manualWrap = document.createElement('div');
    manualWrap.style.marginTop = '14px';
    manualWrap.innerHTML = `
      <label for="bc-manual">…or type the digits</label>
      <input id="bc-manual" type="text" inputmode="numeric" placeholder="e.g. 5000112637922">
    `;
    body.append(manualWrap);

    const goBtn = document.createElement('button');
    goBtn.className = 'primary';
    goBtn.type = 'button';
    goBtn.textContent = 'Look up';
    goBtn.style.marginTop = '12px';
    goBtn.onclick = () => {
      const code = manualWrap.querySelector('#bc-manual').value.trim();
      if (code) { stop(); lookupBarcode(body, code); }
    };
    body.append(goBtn);

    let stream = null;
    let zxingReader = null;
    let rafId = null;
    let stopped = false;

    function stop() {
      stopped = true;
      if (rafId) cancelAnimationFrame(rafId);
      if (zxingReader) { try { zxingReader.reset(); } catch {} }
      if (stream) stream.getTracks().forEach(t => t.stop());
    }
    onCloseHook = stop;

    (async () => {
      const useZxing = !('BarcodeDetector' in window);

      // ZXing opens its own stream, so don't take the camera twice.
      if (!useZxing) {
        try {
          stream = await openCamera();
        } catch (err) {
          cameraFailed(hint, video, err);
          return;
        }
        if (stopped) { stream.getTracks().forEach(t => t.stop()); return; }
        video.srcObject = stream;
        // A rejected play() is not fatal — frames can still be grabbed from
        // the attached stream, so warn rather than tearing the scanner down.
        try { await video.play(); } catch (e) { console.warn('video.play() rejected:', e); }

        const det = new window.BarcodeDetector({
          formats: ['ean_13', 'ean_8', 'upc_a', 'upc_e', 'code_128'],
        });
        const tick = async () => {
          if (stopped) return;
          try {
            const codes = await det.detect(video);
            if (codes.length) { stop(); lookupBarcode(body, codes[0].rawValue); return; }
          } catch {}
          rafId = requestAnimationFrame(tick);
        };
        rafId = requestAnimationFrame(tick);
        return;
      }

      // Safari and Firefox have no BarcodeDetector — fall back to ZXing.
      if (!navigator.mediaDevices?.getUserMedia) {
        cameraFailed(hint, video, new Error('nomediadevices'));
        return;
      }
      try {
        await loadScript(ZXING_CDN);
      } catch {
        hint.textContent = 'Scanner library could not load (offline, or a blocker stopped the CDN). Type the digits instead.';
        video.remove();
        return;
      }
      if (stopped) return;

      try {
        zxingReader = new window.ZXing.BrowserMultiFormatReader();
        const onResult = (result, err) => {
          if (result && !stopped) { stop(); lookupBarcode(body, result.getText()); }
        };
        // decodeFromConstraints lets us ask for the rear camera; older builds
        // of the library only have decodeFromVideoDevice.
        if (typeof zxingReader.decodeFromConstraints === 'function') {
          await zxingReader.decodeFromConstraints(
            { video: { facingMode: { ideal: 'environment' } } }, video, onResult);
        } else {
          await zxingReader.decodeFromVideoDevice(null, video, onResult);
        }
      } catch (err) {
        cameraFailed(hint, video, err);
      }
    })();
  });
}

/** Rear camera if there is one, otherwise whatever camera exists. */
async function openCamera() {
  if (!window.isSecureContext) throw new Error('insecure');
  if (!navigator.mediaDevices?.getUserMedia) throw new Error('nomediadevices');
  try {
    return await navigator.mediaDevices.getUserMedia({
      video: { facingMode: { ideal: 'environment' } },
    });
  } catch (err) {
    // A laptop has no rear camera; retry unconstrained before giving up.
    if (err?.name === 'OverconstrainedError' || err?.name === 'NotFoundError') {
      return navigator.mediaDevices.getUserMedia({ video: true });
    }
    throw err;
  }
}

/** Say WHY the camera failed — "unavailable" is not actionable. */
function cameraFailed(hint, video, err) {
  const name = err?.name || '';
  const msg = String(err?.message || '');
  let text;

  if (msg === 'insecure' || msg === 'nomediadevices' || !window.isSecureContext) {
    text = `Camera blocked: this page is on ${location.protocol}//${location.hostname}. `
         + 'Browsers only allow camera access over https:// or on localhost. '
         + 'Open the GitHub Pages URL instead of an IP address.';
  } else if (name === 'NotAllowedError' || name === 'SecurityError') {
    text = 'Camera permission was denied. Allow it for this site in your browser settings, then reopen this.';
  } else if (name === 'NotFoundError' || name === 'OverconstrainedError') {
    text = 'No camera found on this device.';
  } else if (name === 'NotReadableError' || name === 'AbortError') {
    text = 'The camera is already in use by another app. Close that app and try again.';
  } else {
    text = `Camera error: ${name || 'unknown'}${msg ? ` — ${msg}` : ''}.`;
  }

  hint.textContent = `${text} You can still type the barcode digits below.`;
  hint.style.color = 'var(--danger)';
  video.remove();
  console.warn('Camera failure:', err);
}

function loadScript(src) {
  return new Promise((resolve, reject) => {
    const s = document.createElement('script');
    s.src = src;
    s.onload = resolve;
    s.onerror = () => reject(new Error('script load failed'));
    document.head.append(s);
  });
}

async function lookupBarcode(body, code) {
  spinner(body, `Looking up ${code}…`);
  try {
    const url = `${OFF_URL}${encodeURIComponent(code)}.json?fields=product_name,brands,nutriments,serving_size`;
    const res = await fetch(url);
    if (!res.ok) throw new Error(`Lookup failed (${res.status})`);
    const json = await res.json();
    if (json.status === 0 || !json.product) {
      body.replaceChildren();
      const p = document.createElement('p');
      p.className = 'note';
      p.textContent = `Barcode ${code} is not in the Open Food Facts database. Enter it by hand, or photograph the nutrition label instead.`;
      body.append(p);
      addManualForm(body, 'barcode');
      return;
    }
    showProduct(body, json.product, code);
  } catch (err) {
    body.replaceChildren();
    const p = document.createElement('p');
    p.className = 'note';
    p.textContent = 'Could not reach the food database from the browser. Photograph the nutrition label instead, or enter the values by hand.';
    body.append(p);
    addManualForm(body, 'barcode');
    console.warn('Open Food Facts lookup failed:', err);
  }
}

function showProduct(body, product, code, source = 'barcode') {
  const n = product.nutriments || {};
  const cal100 = num(n['energy-kcal_100g']) ?? (num(n['energy_100g']) != null ? num(n['energy_100g']) / 4.184 : null);
  const pro100 = num(n['proteins_100g']);
  const calServ = num(n['energy-kcal_serving']);
  const proServ = num(n['proteins_serving']);

  const title = [product.brands, product.product_name].filter(Boolean).join(' — ') || `Product ${code}`;

  body.replaceChildren();

  if (cal100 == null && calServ == null) {
    const p = document.createElement('p');
    p.className = 'note';
    p.textContent = `Found "${title}", but it has no nutrition data recorded. Enter the values by hand.`;
    body.append(p);
    addManualForm(body, 'barcode', title);
    return;
  }

  const wrap = document.createElement('div');
  wrap.className = 'stack';
  wrap.innerHTML = `
    <div>
      <label for="b-name">Product</label>
      <input id="b-name" type="text">
    </div>
    <div>
      <label for="b-basis">Amount eaten</label>
      <select id="b-basis"></select>
    </div>
    <div id="b-grams-wrap">
      <label for="b-grams">Grams eaten</label>
      <input id="b-grams" type="number" min="0" step="1" value="100">
    </div>
    <div class="row">
      <div><label for="b-cal">Calories</label><input id="b-cal" type="number" min="0" step="1"></div>
      <div><label for="b-pro">Protein (g)</label><input id="b-pro" type="number" min="0" step="0.1"></div>
    </div>
  `;
  body.append(wrap);

  const basisEl = wrap.querySelector('#b-basis');
  const gramsWrap = wrap.querySelector('#b-grams-wrap');
  const gramsEl = wrap.querySelector('#b-grams');
  const calEl = wrap.querySelector('#b-cal');
  const proEl = wrap.querySelector('#b-pro');
  wrap.querySelector('#b-name').value = title;

  if (cal100 != null) basisEl.append(new Option('Weigh it in grams', 'grams'));
  if (calServ != null) basisEl.append(new Option(`1 serving${product.serving_size ? ` (${product.serving_size})` : ''}`, 'serving'));

  function recalc() {
    const mode = basisEl.value;
    gramsWrap.hidden = mode !== 'grams';
    if (mode === 'serving') {
      calEl.value = Math.round(calServ || 0);
      proEl.value = round1(proServ || 0);
    } else {
      const g = Number(gramsEl.value) || 0;
      calEl.value = Math.round(((cal100 || 0) * g) / 100);
      proEl.value = round1(((pro100 || 0) * g) / 100);
    }
  }
  basisEl.onchange = recalc;
  gramsEl.oninput = recalc;
  recalc();

  const btn = document.createElement('button');
  btn.className = 'primary';
  btn.type = 'button';
  btn.textContent = 'Add to log';
  btn.style.marginTop = '18px';
  btn.onclick = () => {
    addEntry({
      name: wrap.querySelector('#b-name').value.trim() || title,
      portion: basisEl.value === 'grams' ? `${gramsEl.value} g` : (product.serving_size || '1 serving'),
      calories: calEl.value,
      protein: proEl.value,
      source,
    });
    closeModal();
    toast('Added');
  };
  body.append(btn);
}

// ─────────────────────────────────────────────────────────
// Flow: manual
// ─────────────────────────────────────────────────────────
function flowManual() {
  openModal('Add manually', body => {
    addSearchBox(body);

    const hr = document.createElement('hr');
    hr.style.cssText = 'border:0;border-top:1px solid var(--line);margin:20px 0 16px';
    body.append(hr);

    const h = document.createElement('p');
    h.className = 'hint';
    h.style.margin = '0 0 12px';
    h.textContent = 'Or enter it yourself:';
    body.append(h);

    addManualForm(body, 'manual');
  });
}

/** Free-text lookup against Open Food Facts. No key, no AI, no cost. */
function addSearchBox(body) {
  const wrap = document.createElement('div');
  wrap.innerHTML = `
    <label for="q">Search the food database</label>
    <div style="display:flex;gap:8px">
      <input id="q" type="search" placeholder="e.g. greek yoghurt" enterkeyhint="search">
      <button id="q-go" class="act" style="flex:none;padding:11px 16px">Find</button>
    </div>
  `;
  body.append(wrap);

  const results = document.createElement('div');
  results.style.marginTop = '12px';
  body.append(results);

  const input = wrap.querySelector('#q');

  async function go() {
    const q = input.value.trim();
    if (q.length < 2) { toast('Type at least two characters.', true); return; }

    results.replaceChildren();
    const loading = document.createElement('p');
    loading.className = 'hint';
    loading.textContent = 'Searching…';
    results.append(loading);

    try {
      const url = `${OFF_SEARCH}?search_terms=${encodeURIComponent(q)}`
        + '&search_simple=1&action=process&json=1&page_size=12'
        + '&fields=code,product_name,brands,nutriments,serving_size';
      const res = await fetch(url);
      if (!res.ok) throw new Error(`Search failed (${res.status})`);
      const json = await res.json();

      const hits = (json.products || []).filter(p =>
        p.product_name && num(p.nutriments?.['energy-kcal_100g']) != null);

      results.replaceChildren();
      if (!hits.length) {
        const p = document.createElement('p');
        p.className = 'hint';
        p.textContent = `Nothing usable found for "${q}". Try a simpler word, or enter it by hand below.`;
        results.append(p);
        return;
      }

      const ul = document.createElement('ul');
      ul.className = 'found';
      for (const prod of hits) {
        const li = document.createElement('li');
        li.style.cursor = 'pointer';

        const main = document.createElement('div');
        main.className = 'f-main';
        const nm = document.createElement('div');
        nm.className = 'f-name';
        nm.textContent = prod.product_name;
        const sb = document.createElement('div');
        sb.className = 'f-sub';
        sb.textContent = prod.brands || '';
        main.append(nm, sb);

        const nums = document.createElement('div');
        nums.className = 'f-nums';
        const kcal = Math.round(num(prod.nutriments['energy-kcal_100g']));
        const pro = round1(num(prod.nutriments['proteins_100g']) || 0);
        nums.innerHTML = '<div></div><div style="color:var(--pro)"></div>';
        nums.children[0].textContent = `${kcal} kcal`;
        nums.children[1].textContent = `${pro} g /100g`;

        li.append(main, nums);
        li.onclick = () => showProduct($('#modal-body'), prod, prod.code || '', 'search');
        ul.append(li);
      }
      results.append(ul);

      const note = document.createElement('p');
      note.className = 'hint';
      note.textContent = 'Tap one to choose your portion.';
      results.append(note);
    } catch (err) {
      results.replaceChildren();
      const p = document.createElement('p');
      p.className = 'hint';
      p.textContent = 'Could not reach the food database. Enter it by hand below.';
      results.append(p);
      console.warn('Open Food Facts search failed:', err);
    }
  }

  wrap.querySelector('#q-go').onclick = go;
  input.addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); go(); } });
}

function addManualForm(body, source, prefillName = '') {
  const wrap = document.createElement('div');
  wrap.className = 'stack';
  wrap.innerHTML = `
    <div>
      <label for="m-name">Food</label>
      <input id="m-name" type="text" placeholder="e.g. Chicken breast">
    </div>
    <div>
      <label for="m-portion">Portion (optional)</label>
      <input id="m-portion" type="text" placeholder="e.g. 200 g">
    </div>
    <div class="row">
      <div><label for="m-cal">Calories</label><input id="m-cal" type="number" min="0" step="1" placeholder="0"></div>
      <div><label for="m-pro">Protein (g)</label><input id="m-pro" type="number" min="0" step="0.1" placeholder="0"></div>
    </div>
  `;
  body.append(wrap);

  const nameEl = wrap.querySelector('#m-name');
  nameEl.value = prefillName;

  const btn = document.createElement('button');
  btn.className = 'primary';
  btn.type = 'button';
  btn.textContent = 'Add to log';
  btn.style.marginTop = '18px';
  btn.onclick = () => {
    if (!nameEl.value.trim()) { toast('Give it a name.', true); nameEl.focus(); return; }
    addEntry({
      name: nameEl.value.trim(),
      portion: wrap.querySelector('#m-portion').value.trim(),
      calories: wrap.querySelector('#m-cal').value,
      protein: wrap.querySelector('#m-pro').value,
      source,
    });
    closeModal();
    toast('Added');
  };
  body.append(btn);
  nameEl.focus();
}

// ─────────────────────────────────────────────────────────
// Shared result list (AI meal photo)
// ─────────────────────────────────────────────────────────
function showFound(body, items, note, source) {
  body.replaceChildren();

  if (note) {
    const n = document.createElement('p');
    n.className = 'note';
    n.textContent = note;
    body.append(n);
  }

  const ul = document.createElement('ul');
  ul.className = 'found';

  items.forEach((it, i) => {
    const li = document.createElement('li');

    const cb = document.createElement('input');
    cb.type = 'checkbox';
    cb.checked = true;
    cb.id = `f-${i}`;

    const main = document.createElement('div');
    main.className = 'f-main';
    const nm = document.createElement('label');
    nm.className = 'f-name';
    nm.htmlFor = `f-${i}`;
    nm.style.margin = '0';
    nm.style.color = 'var(--text)';
    nm.textContent = it.name;
    const sb = document.createElement('div');
    sb.className = 'f-sub';
    sb.textContent = it.portion || '';
    main.append(nm, sb);

    const nums = document.createElement('div');
    nums.className = 'f-nums';
    nums.innerHTML = `<div></div><div style="color:var(--pro)"></div>`;
    nums.children[0].textContent = `${Math.round(it.calories || 0)} kcal`;
    nums.children[1].textContent = `${round1(it.protein || 0)} g`;

    li.append(cb, main, nums);
    ul.append(li);
  });

  body.append(ul);

  const btn = document.createElement('button');
  btn.className = 'primary';
  btn.type = 'button';
  btn.textContent = 'Add selected';
  btn.onclick = () => {
    let added = 0;
    items.forEach((it, i) => {
      if (ul.querySelector(`#f-${i}`).checked) {
        addEntry({
          name: it.name,
          portion: it.portion || '',
          calories: it.calories,
          protein: it.protein,
          source,
        });
        added++;
      }
    });
    closeModal();
    toast(added ? `Added ${added} item${added > 1 ? 's' : ''}` : 'Nothing selected');
  };
  body.append(btn);

  const hint = document.createElement('p');
  hint.className = 'hint';
  hint.textContent = 'These are estimates. Untick anything wrong, then adjust in the log if needed.';
  body.append(hint);
}

function showError(body, err) {
  body.replaceChildren();
  const p = document.createElement('p');
  p.className = 'note';
  p.style.borderLeftColor = 'var(--danger)';
  p.textContent = err.message || String(err);
  body.append(p);
  addManualForm(body, 'manual');
}

// ─────────────────────────────────────────────────────────
// Image picker
// ─────────────────────────────────────────────────────────
function pickImage(handler, title) {
  const input = document.createElement('input');
  input.type = 'file';
  input.accept = 'image/*';
  // No `capture` attribute: setting it forces the camera and removes the
  // option to choose an existing photo, and on desktop it can leave the
  // picker with no usable source at all.
  input.style.cssText = 'position:fixed;left:-9999px;opacity:0';

  input.onchange = () => {
    const file = input.files?.[0];
    input.remove();
    if (!file) return;
    if (!/^image\//.test(file.type) && !/\.(jpe?g|png|webp|heic|heif)$/i.test(file.name)) {
      toast('That file is not an image.', true);
      return;
    }
    openModal(title, body => handler(file, body));
  };

  // iOS Safari can skip the change event for an input that was never in the
  // document, so attach it before clicking.
  document.body.append(input);
  input.click();
}

// ─────────────────────────────────────────────────────────
// Settings
// ─────────────────────────────────────────────────────────
function openSettings() {
  openModal('Settings', body => {
    const wrap = document.createElement('div');
    wrap.className = 'stack';
    wrap.innerHTML = `
      <p class="note">Barcode scanning, food search and manual entry all work with no key at all. A key is only needed for the two photo modes.</p>
      <div>
        <label for="s-provider">Photo recognition by</label>
        <select id="s-provider"></select>
      </div>
      <div>
        <label for="s-key">API key</label>
        <input id="s-key" type="password" placeholder="paste key" autocomplete="off">
        <p class="hint" id="s-keyhint"></p>
      </div>
      <div>
        <label for="s-model">Model</label>
        <div style="display:flex;gap:8px">
          <input id="s-model" type="text" list="s-models" autocomplete="off" autocapitalize="off" spellcheck="false">
          <button id="s-find" class="act" type="button" style="flex:none;padding:11px 14px">Find</button>
        </div>
        <datalist id="s-models"></datalist>
        <p class="hint" id="s-modelhint">Google retires model names regularly. Press Find to list the ones your key can actually use and pick the best.</p>
      </div>
      <div class="row">
        <div><label for="s-cal">Daily calories</label><input id="s-cal" type="number" min="0" step="10"></div>
        <div><label for="s-pro">Daily protein (g)</label><input id="s-pro" type="number" min="0" step="5"></div>
      </div>
    `;
    body.append(wrap);

    const provEl = wrap.querySelector('#s-provider');
    const keyEl = wrap.querySelector('#s-key');
    const hintEl = wrap.querySelector('#s-keyhint');
    const modelEl = wrap.querySelector('#s-model');
    const listEl = wrap.querySelector('#s-models');
    const calEl = wrap.querySelector('#s-cal');
    const proEl = wrap.querySelector('#s-pro');

    for (const [id, p] of Object.entries(PROVIDERS)) provEl.append(new Option(p.name, id));
    provEl.value = PROVIDERS[state.settings.provider] ? state.settings.provider : 'gemini';
    keyEl.value = state.settings.apiKey;
    modelEl.value = state.settings.model;
    calEl.value = state.targets.calories;
    proEl.value = state.targets.protein;

    let lastProvider = provEl.value;
    function syncProvider(resetModel) {
      const p = PROVIDERS[provEl.value];
      listEl.replaceChildren();
      for (const m of p.suggest) listEl.append(new Option(m));
      if (resetModel) modelEl.value = p.defaultModel;
      hintEl.replaceChildren();
      hintEl.append(document.createTextNode('Stored only in this browser. Get one at '));
      const a = document.createElement('a');
      a.href = p.keyUrl;
      a.target = '_blank';
      a.rel = 'noopener';
      a.textContent = p.keyHint;
      hintEl.append(a, document.createTextNode(
        provEl.value === 'gemini'
          ? '. The free tier is ample for personal use, but Google may use free-tier images to improve its models — see the README before photographing anything private.'
          : '. Paid — needs credit on the account.'
      ));
    }
    provEl.onchange = () => {
      syncProvider(provEl.value !== lastProvider);
      lastProvider = provEl.value;
    };
    syncProvider(false);

    const findBtn = wrap.querySelector('#s-find');
    const modelHint = wrap.querySelector('#s-modelhint');
    findBtn.onclick = async () => {
      if (provEl.value !== 'gemini') {
        modelHint.textContent = 'Model discovery is only available for Gemini.';
        return;
      }
      // Use whatever is typed right now, so this works before the first Save.
      const typed = keyEl.value.replace(/\s+/g, '');
      if (!typed) {
        modelHint.textContent = 'Paste your API key first.';
        modelHint.style.color = 'var(--danger)';
        return;
      }
      const previous = state.settings.apiKey;
      state.settings.apiKey = typed;

      findBtn.disabled = true;
      findBtn.textContent = '…';
      modelHint.style.color = '';
      modelHint.textContent = 'Asking Google which models this key can use…';
      try {
        const models = await listGeminiModels();
        listEl.replaceChildren();
        for (const m of models) listEl.append(new Option(m));
        modelEl.value = models[0];
        modelHint.textContent = `${models.length} models available. Picked ${models[0]} — open the dropdown to choose another. Press Save to keep it.`;
        modelHint.style.color = 'var(--pro)';
      } catch (err) {
        state.settings.apiKey = previous;
        modelHint.textContent = err.message;
        modelHint.style.color = 'var(--danger)';
      }
      findBtn.disabled = false;
      findBtn.textContent = 'Find';
    };

    const saveBtn = document.createElement('button');
    saveBtn.className = 'primary';
    saveBtn.type = 'button';
    saveBtn.textContent = 'Save';
    saveBtn.style.marginTop = '18px';
    saveBtn.onclick = () => {
      // Strip ALL whitespace, not just the ends: copying from a web page or a
      // wrapped terminal line can embed spaces or newlines mid-key.
      const key = keyEl.value.replace(/\s+/g, '');
      // Advisory only. Always save — the API decides what is valid, not us.
      const note = keyProblem(key, provEl.value);
      state.settings.apiKey = key;
      state.settings.provider = provEl.value;
      state.settings.model = modelEl.value.trim() || PROVIDERS[provEl.value].defaultModel;
      state.targets.calories = Math.max(0, Number(calEl.value) || 0);
      state.targets.protein = Math.max(0, Number(proEl.value) || 0);
      save();
      render();
      if (note) {
        // Keep the panel open so the caution is readable, but the key IS saved.
        modelHint.textContent = `Saved. Note: ${note}`;
        modelHint.style.color = 'var(--cal)';
        toast('Saved');
      } else {
        closeModal();
        toast('Saved');
      }
    };
    body.append(saveBtn);

    // Data management
    const hr = document.createElement('hr');
    hr.style.cssText = 'border:0;border-top:1px solid var(--line);margin:22px 0 16px';
    body.append(hr);

    const dataRow = document.createElement('div');
    dataRow.className = 'row';

    const exportBtn = document.createElement('button');
    exportBtn.className = 'act';
    exportBtn.type = 'button';
    exportBtn.textContent = 'Export JSON';
    exportBtn.onclick = exportData;

    const importBtn = document.createElement('button');
    importBtn.className = 'act';
    importBtn.type = 'button';
    importBtn.textContent = 'Import JSON';
    importBtn.onclick = importData;

    dataRow.append(exportBtn, importBtn);
    body.append(dataRow);

    const warn = document.createElement('p');
    warn.className = 'hint';
    warn.textContent = `${state.entries.length} entries stored in this browser. Clearing site data erases them — export a backup now and then.`;
    body.append(warn);

    addDiagnostics(body);
  });
}

/* Model IDs are retired and renamed constantly — 2.0 Flash was shut off in
   June 2026 and now 404s. Rather than ship a name that rots, ask the key what
   it can actually use. */
async function listGeminiModels() {
  if (!state.settings.apiKey) throw new Error('Save an API key first.');
  const res = await fetch(`${GEMINI_LIST}?pageSize=200`, {
    headers: { 'x-goog-api-key': state.settings.apiKey },
  });
  if (!res.ok) await apiFail(res, 'Gemini');
  const json = await res.json();
  const usable = (json.models || [])
    .filter(m => (m.supportedGenerationMethods || []).includes('generateContent'))
    .map(m => String(m.name || '').replace(/^models\//, ''))
    .filter(Boolean);
  if (!usable.length) throw new Error('This key has no models that support generateContent.');
  return usable.sort((a, b) => rankModel(b) - rankModel(a));
}

/** Prefer a current, stable Flash model: multimodal, cheap, on the free tier. */
function rankModel(id) {
  let s = 0;
  if (/flash/i.test(id)) s += 100;          // free tier + vision
  if (/lite/i.test(id)) s -= 25;            // weaker at reading labels
  if (/preview|exp|thinking|tts|image/i.test(id)) s -= 60;  // unstable or wrong modality
  if (/pro/i.test(id)) s -= 80;             // paid-only on the free tier
  const v = parseFloat((id.match(/(\d+(?:\.\d+)?)/) || [])[1] || 0);
  return s + v * 3;                         // newer wins among equals
}

/* ADVISORY ONLY — never blocks a save. Key formats change (Google moved from
   AIza "standard" keys to AQ.Ab "auth" keys during 2026 and began rejecting
   the old ones), so the API is the only real authority on whether a key is
   valid. A hard format check here would lock users out of working keys. */
function keyProblem(key, provider) {
  if (!key) return null;

  if (provider === 'gemini') {
    if (key.startsWith('sk-ant-')) return 'This looks like an Anthropic key — you may want to switch the provider above.';
    if (/^sk-/.test(key)) return 'This looks like an OpenAI key, which this app cannot use.';
    if (key.startsWith('AIza')) {
      return 'This is an older "standard" Google key. Google began rejecting these in 2026 — '
           + 'if it fails, create a new key at aistudio.google.com/apikey, which now issues "AQ.Ab" auth keys.';
    }
    if (!/^AQ\./.test(key)) {
      return 'Unfamiliar key format (current Gemini keys start with "AQ."). Saved anyway — press Test API key to find out for certain.';
    }
    if (key.length < 20) return `This looks truncated (only ${key.length} characters).`;
  }

  if (provider === 'anthropic') {
    if (/^(AIza|AQ\.)/.test(key)) return 'This looks like a Google key — you may want to switch the provider above.';
    if (!key.startsWith('sk-ant-')) return 'Anthropic keys usually start with "sk-ant-".';
  }
  return null;
}

/** Minimal text-only call: proves the key works without spending an image. */
async function testKey() {
  const { provider, apiKey, model } = state.settings;
  if (!apiKey) throw new Error('No API key saved yet.');

  if (provider === 'gemini') {
    const res = await fetch(`${GEMINI_URL}${encodeURIComponent(model)}:generateContent`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-goog-api-key': apiKey },
      body: JSON.stringify({
        contents: [{ parts: [{ text: 'Reply with the single word: ok' }] }],
        generationConfig: { maxOutputTokens: 10 },
      }),
    });
    if (!res.ok) {
      if (await recoverModel(res, false)) {
        return `${model} is retired. Switched to ${state.settings.model}, which works.`;
      }
      await apiFail(res, 'Gemini');
    }
    return `Key works with ${model}.`;
  }

  const res = await fetch(ANTHROPIC_URL, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
      'anthropic-dangerous-direct-browser-access': 'true',
    },
    body: JSON.stringify({
      model, max_tokens: 10,
      messages: [{ role: 'user', content: 'Reply with the single word: ok' }],
    }),
  });
  if (!res.ok) await apiFail(res, 'Anthropic');
  return `Key works with ${model}.`;
}

/** What this browser actually supports. Turns "it doesn't work" into a fact. */
function addDiagnostics(body) {
  const hr = document.createElement('hr');
  hr.style.cssText = 'border:0;border-top:1px solid var(--line);margin:20px 0 14px';
  body.append(hr);

  const h = document.createElement('div');
  h.style.cssText = 'font-size:.82rem;font-weight:600;margin-bottom:8px';
  h.textContent = 'Diagnostics';
  body.append(h);

  const secure = window.isSecureContext;
  const hasCam = !!navigator.mediaDevices?.getUserMedia;
  const rows = [
    ['App version', `v${APP_VERSION}`],
    ['Page address', `${location.protocol}//${location.host || 'file'}`],
    ['Secure context', secure ? 'yes' : 'NO — camera will be blocked'],
    ['Camera API', hasCam ? 'available' : 'MISSING'],
    ['Barcode scanner', 'BarcodeDetector' in window ? 'native' : 'ZXing fallback (needs internet)'],
    ['Image decoding', typeof createImageBitmap === 'function' ? 'fast path' : 'fallback path'],
    ['API key', state.settings.apiKey ? `set (${state.settings.apiKey.length} chars)` : 'not set — photo modes disabled'],
    ['Provider', `${state.settings.provider} / ${state.settings.model}`],
  ];

  const tbl = document.createElement('div');
  tbl.style.cssText = 'font-size:.78rem;line-height:1.7';
  for (const [k, v] of rows) {
    const bad = /NO|MISSING|not set/.test(v);
    const line = document.createElement('div');
    line.style.cssText = 'display:flex;gap:10px;justify-content:space-between';
    const a = document.createElement('span');
    a.style.color = 'var(--muted)';
    a.textContent = k;
    const b = document.createElement('span');
    b.style.cssText = `text-align:right;${bad ? 'color:var(--danger);font-weight:600' : ''}`;
    b.textContent = v;
    line.append(a, b);
    tbl.append(line);
  }
  body.append(tbl);

  const keyBtn = document.createElement('button');
  keyBtn.className = 'act';
  keyBtn.type = 'button';
  keyBtn.style.marginTop = '12px';
  keyBtn.textContent = 'Test API key';
  keyBtn.onclick = async () => {
    document.getElementById('key-result')?.remove();
    keyBtn.disabled = true;
    keyBtn.textContent = 'Testing…';
    const out = document.createElement('p');
    out.id = 'key-result';
    out.className = 'hint';
    out.style.whiteSpace = 'pre-wrap';
    try {
      out.textContent = await testKey();
      out.style.color = 'var(--pro)';
      keyBtn.textContent = 'Test API key';
    } catch (err) {
      out.textContent = err.message;
      out.style.color = 'var(--danger)';
      keyBtn.textContent = 'Test API key';
    }
    keyBtn.disabled = false;
    keyBtn.after(out);
  };
  body.append(keyBtn);

  const test = document.createElement('button');
  test.className = 'act';
  test.type = 'button';
  test.style.marginTop = '12px';
  test.textContent = 'Test camera';
  test.onclick = async () => {
    test.disabled = true;
    test.textContent = 'Testing…';
    try {
      const s = await openCamera();
      const label = s.getVideoTracks()[0]?.label || 'camera';
      s.getTracks().forEach(t => t.stop());
      test.textContent = `Camera works: ${label}`.slice(0, 44);
      test.style.color = 'var(--pro)';
    } catch (err) {
      const fake = { textContent: '', style: {} };
      cameraFailed(fake, { remove() {} }, err);
      test.textContent = 'Camera failed — see below';
      test.style.color = 'var(--danger)';
      const p = document.createElement('p');
      p.className = 'hint';
      p.style.color = 'var(--danger)';
      p.textContent = fake.textContent;
      test.after(p);
    }
  };
  body.append(test);
}

function exportData() {
  const copy = { ...state, settings: { ...state.settings, apiKey: '' } }; // never export the key
  const blob = new Blob([JSON.stringify(copy, null, 2)], { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `macrolog-${todayKey()}.json`;
  a.click();
  URL.revokeObjectURL(a.href);
  toast('Exported (key excluded)');
}

function importData() {
  const input = document.createElement('input');
  input.type = 'file';
  input.accept = 'application/json,.json';
  input.onchange = async () => {
    const file = input.files?.[0];
    if (!file) return;
    try {
      const incoming = JSON.parse(await file.text());
      if (!Array.isArray(incoming.entries)) throw new Error('Not a Macro Log backup.');
      const seen = new Set(state.entries.map(e => e.id));
      const fresh = incoming.entries.filter(e => e && e.id && !seen.has(e.id));
      state.entries.push(...fresh);
      if (incoming.targets) state.targets = { ...state.targets, ...incoming.targets };
      save();
      render();
      closeModal();
      toast(`Imported ${fresh.length} new entries`);
    } catch (err) {
      toast(err.message || 'Import failed.', true);
    }
  };
  input.click();
}

// ─────────────────────────────────────────────────────────
// Utils
// ─────────────────────────────────────────────────────────
function num(v) {
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}
function round1(v) {
  return Math.round(Number(v) * 10) / 10;
}

// ─────────────────────────────────────────────────────────
// Wiring
// ─────────────────────────────────────────────────────────
const FLOWS = { photo: flowPhoto, label: flowLabel, barcode: flowBarcode, manual: flowManual };

document.querySelectorAll('.act[data-act]').forEach(btn => {
  btn.addEventListener('click', () => FLOWS[btn.dataset.act]());
});

$('#btn-settings').addEventListener('click', openSettings);
$('#btn-close').addEventListener('click', closeModal);
$('#overlay').addEventListener('click', e => { if (e.target.id === 'overlay') closeModal(); });
document.addEventListener('keydown', e => {
  if (e.key === 'Escape' && !$('#overlay').hidden) closeModal();
});

$('#btn-prev').addEventListener('click', () => { viewDate = shiftKey(viewDate, -1); render(); });
$('#btn-next').addEventListener('click', () => {
  if (viewDate >= todayKey()) { toast('That is the future.'); return; }
  viewDate = shiftKey(viewDate, 1);
  render();
});

render();
