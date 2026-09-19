# Macro Log

A calorie and protein tracker you photograph food into. Three files, no build step, no server, no database. Runs free on GitHub Pages.

**Total cost to run: nothing.** Hosting is free, three of the four logging modes need no account at all, and the fourth runs on Google's free tier.

| Mode | How it works | Needs a key? |
|---|---|---|
| **Search / add** | Type "greek yoghurt", pick from the Open Food Facts database | No |
| **Barcode** | Scan the packet; exact nutrition from the same database | No |
| **Meal photo** | Photograph the plate; AI identifies foods and estimates macros | Free Gemini key |
| **Nutrition label** | Photograph the panel; AI transcribes the printed numbers | Free Gemini key |

Everything you log lives in your browser's local storage. Nothing is uploaded anywhere except the image you send for the two photo modes.

---

## Setup

### 1. Put it on GitHub Pages

```bash
git init
git add .
git commit -m "Macro Log"
git branch -M main
git remote add origin https://github.com/YOUR-USERNAME/macro-log.git
git push -u origin main
```

Then in the repo: **Settings → Pages → Source: Deploy from a branch → `main` / `(root)` → Save**. A minute later it's live at `https://YOUR-USERNAME.github.io/macro-log/`.

On a free GitHub account Pages only works from a **public** repo. Your API key isn't in the code, so nothing sensitive is exposed. If you'd rather keep it private, the [Student Developer Pack](https://education.github.com/pack) includes GitHub Pro free, which allows Pages from private repos.

HTTPS matters — the camera refuses to run over plain HTTP. GitHub Pages gives you HTTPS automatically.

### 2. Start using it — no key needed

Open the URL. Search, barcode scanning and manual entry all work immediately. For a lot of everyday logging that's genuinely enough, and the database gives you *exact* numbers rather than estimates.

### 3. Add a free Gemini key for photo modes

Get one at [aistudio.google.com/apikey](https://aistudio.google.com/apikey) — free, no card. Paste it into the app's Settings panel, never into the code.

Keys issued now are **auth keys** and start with `AQ.Ab`. The older **standard keys** starting with `AIza` were phased out during 2026 and Google rejects them, so if you have one lying around from an older project, create a fresh key rather than reusing it. The app warns about this but never blocks you — key formats change, and only the API can say for certain whether a key works.

Then press **Find** next to the Model box. Google retires model names on a rolling basis (2.0 Flash was shut off in June 2026 and now returns 404), so rather than trusting a hardcoded default, the app asks your key which models it can actually use and picks the best current Flash one. Do this again if photo modes ever start failing with a "model not found" error.

Settings also has a **Diagnostics** section with **Test API key** and **Test camera** buttons. The key test is a tiny text-only call — it costs nothing and reports Google's exact response, which is far more useful than a generic failure.

The free tier allows roughly 10 requests/minute and 250/day on Flash, or 15/minute and 1,000/day on Flash-Lite. Even at five photographed meals a day you'd use about 2% of it.

**One thing to weigh before photographing meals:** on Google's free tier, your prompts and images may be used to improve their models. Meal photos often catch your kitchen, your table, sometimes other people. If that bothers you, stick to barcode and search (which send nothing to any AI), or switch the provider to Anthropic in Settings, which is paid but doesn't train on API traffic.

### 4. Install it on your phone

iOS: Share → Add to Home Screen. Android: Chrome menu → Install app. It then opens fullscreen like a normal app.

The key and your log are stored per-browser, so phone and laptop each hold their own. Use **Settings → Export JSON** on one and Import on the other to merge.

---

## Running it locally

Don't double-click `index.html` — a `file://` URL blocks both the camera and network calls, and you'll think it's broken when it isn't. Serve it:

```bash
python3 -m http.server 8000
```

Then visit `http://localhost:8000`. Browsers treat `localhost` as a secure context, so the camera works there too. VS Code's Live Server extension does the same job.

---

## Switching providers

Settings has a provider dropdown (Gemini or Anthropic) and an **editable** model field. The model box is deliberately a text input rather than a dropdown: model names get retired, and when that happens you change one field instead of editing source. If a model 404s, the app tells you to change it there.

Gemini is called at `generativelanguage.googleapis.com`, which permits browser requests from any origin. Anthropic requires the `anthropic-dangerous-direct-browser-access` header, which the app sends. Azure OpenAI and OpenAI's direct API both refuse browser calls entirely — no CORS headers — so neither can work in a static app without a backend proxy.

## About the API key

The key sits in local storage and goes only to the provider's endpoint. That's the accepted pattern for a personal static app. Two consequences: anyone with access to your browser profile can read it, so treat it like a saved password; and it belongs in Settings only — if you ever paste it into a source file and push, revoke it immediately.

Exports deliberately omit the key, so backup files are safe to keep in cloud storage.

---

## Known limits

Meal-photo numbers are **estimates**. A model judging portions from a photo works from the same cues you do and can be off by a third on oils, dressings, and anything hidden underneath. When accuracy matters, use search, barcode, or the label reader — all of which give printed values rather than guesses.

Barcode scanning uses the browser's native `BarcodeDetector` where available (Chrome, Edge, Android) and falls back to ZXing from a CDN elsewhere, covering iOS Safari. If the camera won't open, you can type the digits.

Open Food Facts is crowd-sourced: strong coverage in Europe, patchier elsewhere, and some entries lack nutrition data. Every failure path falls back to manual entry rather than dead-ending.

Local storage is per-browser and per-device. No sync, and clearing site data wipes the log — export occasionally. Import merges by entry ID, so re-importing an old backup won't duplicate anything.

---

## Logo and icons

The mark is the app's own two progress rings: a 75% orange arc for calories around a 50% green arc for protein.

```
icons/logo.svg               master, transparent
icons/favicon.svg            thicker strokes so it survives 16x16
icons/apple-touch-icon.png   180px, opaque — iOS ignores transparency
icons/icon-192.png           Android / PWA
icons/icon-512.png           Android / PWA
icons/icon-maskable-512.png  extra padding for Android's circular crop
icons/logo-512.png           transparent, for docs
site.webmanifest             name, colours and icon set for "Install app"
```

The PNGs are generated rather than drawn: ImageMagick's built-in SVG renderer mangles this file and there's no librsvg, so they're rasterised with Pillow at 8x and downsampled. If you restyle the logo, regenerate them rather than scaling by hand.

## File layout

```
index.html    markup and modal shell
styles.css    all styling, dark and light
app.js        state, rendering, capture flows, API calls
```

No dependencies, no bundler, plain ES2022. ZXing is the only external code and it loads lazily, only when scanning a barcode on a browser without `BarcodeDetector`.

Two CSS notes worth keeping if you edit `styles.css`, both of them cascade traps that already bit once:

`[hidden] { display: none !important; }` near the top is load-bearing. The browser's own `[hidden]` rule loses to any author `display` value, so without it the modal overlay is permanently visible. The overlay also carries an inline `display:none` and JS sets `display` inline, so it stays correct even if this stylesheet is stale in cache.

The generic icon rule is written as `svg[viewBox]:not(.ring):not(.brand-mark)`. Without those exclusions it scores (0,1,2) and beats `.ring-bg` at (0,1,0), repainting the progress rings in `currentColor` at `stroke-width: 1.8` — thin grey circles instead of thick orange and green bands. Keep any new multi-coloured SVG out of that rule the same way.

## Ideas for later

A "recent foods" list that re-adds yesterday's breakfast in one tap would probably save more time than any of the AI features. Weekly and monthly averages are a small extension of the chart code. Cross-device sync is the one thing that genuinely needs a backend.
