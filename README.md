# Macro Log

A calorie and protein tracker you photograph food into. Entirely static — three files, no build step, no server, no database. Runs on GitHub Pages for free.

Four ways to log something:

| Mode | How it works | Needs a key? |
|---|---|---|
| **Meal photo** | Photograph the plate; Claude identifies each food and estimates calories and protein | Yes |
| **Nutrition label** | Photograph the panel on the packet; Claude transcribes the printed numbers | Yes |
| **Barcode** | Scan the barcode; nutrition comes from the Open Food Facts public database | No |
| **Manual** | Type it in | No |

Everything you log lives in your browser's local storage. Nothing is uploaded anywhere except the image you send to Anthropic when using the two photo modes.

---

## Setup

### 1. Get an Anthropic API key

Create one at [console.anthropic.com/settings/keys](https://console.anthropic.com/settings/keys) and add a little credit to the account. You paste the key into the app's own Settings panel — **never into the code**.

Rough cost: a food photo is around a third of a cent on Sonnet. Logging five meals a day for a month lands well under a dollar. Switch to Haiku in Settings to cut that further.

### 2. Put it on GitHub Pages

```bash
git init
git add index.html styles.css app.js README.md .gitignore
git commit -m "Macro Log"
git branch -M main
git remote add origin https://github.com/YOUR-USERNAME/macro-log.git
git push -u origin main
```

Then in the repo: **Settings → Pages → Source: Deploy from a branch → `main` / `(root)` → Save**.

A minute later it's live at `https://YOUR-USERNAME.github.io/macro-log/`.

HTTPS matters here — the camera API refuses to run over plain HTTP. GitHub Pages gives you HTTPS automatically.

### 3. Open it on your phone

Open the URL, tap Settings, paste your key, set your daily calorie and protein targets. On iOS use Share → Add to Home Screen; on Android, Chrome's "Install app". It then behaves like a normal app.

The key is stored per-browser, so you'll paste it once on your phone and once on your laptop.

---

## Running it locally

Opening `index.html` as a `file://` URL won't work — the camera and `fetch` both need a real origin. Serve it instead:

```bash
python3 -m http.server 8000
```

Then visit `http://localhost:8000`. Browsers treat `localhost` as a secure context, so the camera works there too.

In VS Code the Live Server extension does the same thing; in PyCharm, right-click `index.html` → Open in Browser.

---

## About the API key

The key sits in your browser's local storage and is sent only to `api.anthropic.com`. That is the accepted pattern for a personal static app, and Anthropic supports it deliberately via the `anthropic-dangerous-direct-browser-access` header. Two things follow from it:

Anyone who can use your browser profile can read the key out of local storage, so treat it like a saved password. And the key belongs in the Settings panel only — if you ever paste it into a source file and push, GitHub's secret scanning will catch it, but by then it's public and you'll need to revoke it.

Exports deliberately omit the key, so a backup file is safe to keep in cloud storage.

If you later want the key off your device entirely, that needs a backend to hold it, which means somewhere other than GitHub Pages — Azure Static Web Apps has a free tier with Python functions that would suit.

---

## Known limits

The meal-photo numbers are **estimates**. A model judging portion size from a photo is working from the same cues you are, and it can be off by a third either way on things like oil, dressings, and anything hidden under something else. For accuracy that matters, weigh the food and use the label or manual path. The photo path is for speed, not precision.

Barcode scanning uses the browser's native `BarcodeDetector` where it exists (Chrome, Edge, Android) and falls back to ZXing loaded from a CDN elsewhere, which covers iOS Safari. If the camera can't be opened at all, the modal lets you type the digits.

Open Food Facts is crowd-sourced. Coverage is strong in Europe and patchy elsewhere, and some entries have no nutrition data recorded. When a lookup misses, the app offers manual entry rather than failing. Should the browser block the request outright on CORS grounds, you'll get the same fallback — photographing the label works regardless.

Local storage is per-browser and per-device. There's no sync, and clearing site data wipes the log, so use **Settings → Export JSON** occasionally. Import merges by entry ID rather than overwriting, so re-importing an old backup won't create duplicates.

---

## File layout

```
index.html    markup and modal shell
styles.css    all styling, dark and light
app.js        state, rendering, capture flows, API calls
```

No dependencies, no bundler. `app.js` is plain ES2022 in a classic script tag. ZXing is the only external code and it loads lazily, only if you scan a barcode on a browser lacking `BarcodeDetector`.

## Ideas for later

Cross-device sync needs a backend and a database. Weekly and monthly averages are a small extension of the existing chart code. A "recent foods" list that lets you re-add yesterday's breakfast in one tap would probably save more time than any of the AI features.
