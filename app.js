/* Macro Log — calorie + protein tracker
   Pure static. No backend. Data and API key live in this browser only. */

'use strict';

// ─────────────────────────────────────────────────────────
// Constants
// ─────────────────────────────────────────────────────────
const STORE_KEY = 'macrolog.v1';
const RING_C = 2 * Math.PI * 52;          // circumference of r=52 ring
const OFF_URL = 'https://world.openfoodfacts.org/api/v2/product/';
const ZXING_CDN = 'https://cdn.jsdelivr.net/npm/@zxing/library@0.21.3/umd/index.min.js';
const ANTHROPIC_URL = 'https://api.anthropic.com/v1/messages';

const MODELS = [
  ['claude-sonnet-5', 'Sonnet 5 — balanced (recommended)'],
  ['claude-opus-5', 'Opus 5 — most accurate, pricier'],
  ['claude-haiku-4-5-20251001', 'Haiku 4.5 — fastest, cheapest'],
];

const SOURCE_LABEL = {
  ai: 'photo', label: 'label', barcode: 'barcode', manual: 'manual',
};

// ─────────────────────────────────────────────────────────
// State
// ─────────────────────────────────────────────────────────
const DEFAULTS = {
  entries: [],
  targets: { calories: 2000, protein: 150 },
  settings: { apiKey: '', model: 'claude-sonnet-5' },
};

let state = load();
let viewDate = todayKey();

function load() {
  try {
    const raw = localStorage.getItem(STORE_KEY);
    if (!raw) return structuredClone(DEFAULTS);
    const parsed = JSON.parse(raw);
    return {
      entries: Array.isArray(parsed.entries) ? parsed.entries : [],
      targets: { ...DEFAULTS.targets, ...(parsed.targets || {}) },
      settings: { ...DEFAULTS.settings, ...(parsed.settings || {}) },
    };
  } catch {
    return structuredClone(DEFAULTS);
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
  buildBody(body);
  $('#overlay').hidden = false;
  onCloseHook = onClose || null;
  document.body.style.overflow = 'hidden';
}

function closeModal() {
  $('#overlay').hidden = true;
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
  toast('Add your Anthropic API key in Settings first.', true);
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
  const bitmap = await createImageBitmap(file);
  const scale = Math.min(1, maxDim / Math.max(bitmap.width, bitmap.height));
  const w = Math.round(bitmap.width * scale);
  const h = Math.round(bitmap.height * scale);
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  canvas.getContext('2d').drawImage(bitmap, 0, 0, w, h);
  bitmap.close?.();
  const blob = await new Promise(res => canvas.toBlob(res, 'image/jpeg', quality));
  return { data: await fileToBase64(blob), mediaType: 'image/jpeg' };
}

async function askClaude(imageB64, mediaType, prompt) {
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
      max_tokens: 1200,
      messages: [{
        role: 'user',
        content: [
          { type: 'image', source: { type: 'base64', media_type: mediaType, data: imageB64 } },
          { type: 'text', text: prompt },
        ],
      }],
    }),
  });

  if (!res.ok) {
    let detail = '';
    try { detail = (await res.json())?.error?.message || ''; } catch {}
    if (res.status === 401) throw new Error('API key rejected. Check it in Settings.');
    if (res.status === 429) throw new Error('Rate limited — wait a moment and retry.');
    if (res.status === 400 && /credit|balance/i.test(detail)) throw new Error('Anthropic account has no credit.');
    throw new Error(detail || `API error ${res.status}`);
  }

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
      const raw = await askClaude(data, mediaType, MEAL_PROMPT);
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
      const raw = await askClaude(data, mediaType, LABEL_PROMPT);
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
    video.setAttribute('playsinline', '');
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
      try {
        stream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: 'environment' },
        });
        if (stopped) { stream.getTracks().forEach(t => t.stop()); return; }
        video.srcObject = stream;
        await video.play();
      } catch {
        hint.textContent = 'Camera unavailable. Type the barcode digits instead.';
        video.remove();
        return;
      }

      if ('BarcodeDetector' in window) {
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
      } else {
        try {
          await loadScript(ZXING_CDN);
          if (stopped) return;
          zxingReader = new window.ZXing.BrowserMultiFormatReader();
          zxingReader.decodeFromVideoElement(video, (result) => {
            if (result && !stopped) { stop(); lookupBarcode(body, result.getText()); }
          });
        } catch {
          hint.textContent = 'Scanner could not load. Type the barcode digits instead.';
        }
      }
    })();
  });
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

function showProduct(body, product, code) {
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
      source: 'barcode',
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
  openModal('Add manually', body => addManualForm(body, 'manual'));
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
  input.capture = 'environment';
  input.onchange = () => {
    const file = input.files?.[0];
    if (!file) return;
    openModal(title, body => handler(file, body));
  };
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
      <div>
        <label for="s-key">Anthropic API key</label>
        <input id="s-key" type="password" placeholder="sk-ant-..." autocomplete="off">
        <p class="hint">Stored only in this browser's local storage. Never sent anywhere except api.anthropic.com. Get one at <a href="https://console.anthropic.com/settings/keys" target="_blank" rel="noopener">console.anthropic.com</a>.</p>
      </div>
      <div>
        <label for="s-model">Model</label>
        <select id="s-model"></select>
      </div>
      <div class="row">
        <div><label for="s-cal">Daily calories</label><input id="s-cal" type="number" min="0" step="10"></div>
        <div><label for="s-pro">Daily protein (g)</label><input id="s-pro" type="number" min="0" step="5"></div>
      </div>
    `;
    body.append(wrap);

    const keyEl = wrap.querySelector('#s-key');
    const modelEl = wrap.querySelector('#s-model');
    const calEl = wrap.querySelector('#s-cal');
    const proEl = wrap.querySelector('#s-pro');

    keyEl.value = state.settings.apiKey;
    for (const [v, t] of MODELS) modelEl.append(new Option(t, v));
    modelEl.value = state.settings.model;
    calEl.value = state.targets.calories;
    proEl.value = state.targets.protein;

    const saveBtn = document.createElement('button');
    saveBtn.className = 'primary';
    saveBtn.type = 'button';
    saveBtn.textContent = 'Save';
    saveBtn.style.marginTop = '18px';
    saveBtn.onclick = () => {
      state.settings.apiKey = keyEl.value.trim();
      state.settings.model = modelEl.value;
      state.targets.calories = Math.max(0, Number(calEl.value) || 0);
      state.targets.protein = Math.max(0, Number(proEl.value) || 0);
      save();
      render();
      closeModal();
      toast('Saved');
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
  });
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
