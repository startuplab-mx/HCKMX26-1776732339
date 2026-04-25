# LUMI — Chrome Extension: Technical Description

> Real-time child safety via behavioral nudges. Chrome MV3 · Preact · WXT · Bun · Supabase.

---

## Table of Contents

1. [What It Does](#1-what-it-does)
2. [Architecture Overview](#2-architecture-overview)
3. [File Structure](#3-file-structure)
4. [Component Breakdown](#4-component-breakdown)
5. [End-to-End Flow](#5-end-to-end-flow)
6. [Data Flow Diagram](#6-data-flow-diagram)
7. [Key Design Decisions](#7-key-design-decisions)
8. [Constraints & Limitations](#8-constraints--limitations)

---

## 1. What It Does

LUMI is a Chrome MV3 browser extension that monitors a child's digital activity in real time across any website — YouTube, Roblox, TikTok, Discord, and others — and intervenes with contextual **nudges** when it detects risk.

A nudge is a friendly, age-appropriate overlay message that:
- Communicates the detected risk in simple language the child understands
- Guides them toward a safer decision
- Does **not** block content, remove access, or alert the recruiter/abuser that monitoring is active

When a threat crosses a configurable severity threshold, LUMI also notifies the parent or guardian via email and logs the event to the parent dashboard in real time.

LUMI's threat taxonomy covers eight categories across four severity levels:

| Severity | Categories |
|---|---|
| Crítico | Reclutamiento criminal, Contacto de riesgo |
| Alto | Ciberbullying, Manipulación social |
| Medio | Contenido normalizador, Oferta engañosa |
| Bajo | Lenguaje inapropiado, Uso excesivo |

---

## 2. Architecture Overview

LUMI has three deployment units that work together:

```
┌─────────────────────────────────┐     ┌──────────────────────────┐
│         Chrome Extension         │     │       Backend API         │
│                                 │     │   Bun + Elysia · Railway  │
│  content-script.ts              │────▶│                          │
│    └─ MutationObserver          │     │  POST /analyze           │
│    └─ extractSignals()          │     │    └─ OpenRouter LLM     │
│    └─ heuristic scorer          │     │    └─ Vision model       │
│    └─ debounce(300ms)           │     │    └─ Nudge generator    │
│                                 │     │    └─ Supabase logger    │
│  service-worker.ts              │◀────│    └─ Resend notifier    │
│    └─ Message router            │     │                          │
│    └─ captureVisibleTab()       │     └──────────────────────────┘
│    └─ fetch → backend           │
│                                 │     ┌──────────────────────────┐
│  nudge/renderer.ts              │     │     Parent Dashboard      │
│    └─ Preact overlay            │     │   Next.js · Vercel       │
│                                 │     │                          │
│  popup/Popup.tsx                │     │  Subscribes to Supabase  │
│    └─ Session summary           │     │  realtime threat feed    │
└─────────────────────────────────┘     └──────────────────────────┘
```

### Why a browser extension?

A Chrome extension is the only architecture that achieves cross-platform coverage (YouTube, Roblox, TikTok, Discord — all in one install) without requiring each platform's cooperation. It operates on the DOM that already exists in the browser, invisible to the platforms themselves.

### Why separate extension from backend?

The content script runs inside the web page's JavaScript context. If it made API calls directly, the OpenRouter API key would be visible in the extension bundle (which anyone can unpack and inspect). All network calls go through the background service worker, which acts as a secure proxy to the backend. The backend is the only place API keys live.

---

## 3. File Structure

```
extension/
├── src/
│   ├── content-script.ts       # Entry point — DOM observation + pipeline
│   ├── service-worker.ts       # Background process — network + screenshot
│   │
│   ├── scorer/
│   │   ├── index.ts            # Scoring logic + action decision
│   │   ├── keywords.ts         # Keyword lists + signal weights
│   │   └── patterns.ts         # Behavioral pattern detectors
│   │
│   ├── nudge/
│   │   ├── NudgeOverlay.tsx    # Preact component — the visible nudge
│   │   ├── renderer.ts         # Mounts/unmounts Preact into page DOM
│   │   └── nudge.css           # Scoped styles for the overlay
│   │
│   └── popup/
│       ├── Popup.tsx           # Child-facing session summary
│       └── popup.css
│
├── public/
│   └── icon.png
├── wxt.config.ts               # WXT configuration + manifest
└── .env                        # VITE_BACKEND_URL
```

---

## 4. Component Breakdown

### 4.1 `content-script.ts` — The Eyes

The content script is injected by Chrome into every page the child visits. It is the entry point for all detection.

**Responsibilities:**
- Attach a `MutationObserver` to `document.body` to watch for new DOM nodes in real time
- Extract relevant signals from each new node (text, sender, element type, platform)
- Run the heuristic scorer locally
- Send an `ESCALATE` message to the service worker when score exceeds threshold
- Listen for `SHOW_NUDGE` messages from the service worker and trigger the renderer

**Why MutationObserver?** Modern platforms like YouTube and Roblox are single-page apps — content loads without full page reloads. A one-time DOM scan on `document_idle` would miss nearly all chat messages and comments.

**Why debounce at 300ms?** On active pages, the observer can fire hundreds of times per second. Debouncing batches rapid mutations into a single pipeline call, preventing the scorer from being called unnecessarily on intermediate DOM states.

---

### 4.2 `scorer/index.ts` — The First Filter

The heuristic scorer is the fastest part of the system. It runs entirely inside the extension with no network call, completing in under 50ms.

**Five signal types:**

| Signal | What it measures | Weight |
|---|---|---|
| `keyword` | Match against narco-recruitment and grooming keyword lists | 0.35 |
| `offer` | Presence of offer/incentive language | 0.30 |
| `sender` | Unknown sender is more suspicious than a known contact | 0.20 |
| `pattern` | DM context, message length, pressure indicators | 0.10 |
| `platform` | Some platforms are higher risk by nature | 0.05 |

**Decision thresholds:**

```
score < 0.3  →  ignore   (safe, no action)
score 0.3–0.6 →  watch   (log locally, continue observing)
score > 0.6  →  escalate (send to backend LLM)
```

**Why heuristics first?** The LLM call costs time and money. The scorer filters out ~90% of content as safe instantly. The LLM only activates when there is genuine signal — keeping latency low and API costs minimal.

---

### 4.3 `scorer/keywords.ts` — Signal Vocabulary

Three keyword lists cover the primary threat vectors:

- **NARCO_KEYWORDS** — recruitment language specific to organized crime: coded terms for lookout roles, plaza references, easy money offers, protection promises
- **GROOMING_KEYWORDS** — trust-building and isolation language: secrecy requests, uniqueness flattery, in-person meeting pressure
- **OFFER_KEYWORDS** — generic incentive language: gifts, prizes, free items (including platform-specific bait like free Robux)

Keyword matching is case-insensitive and substring-based. A match returns a 0–1 score proportional to the number of hits, capped at 1.

---

### 4.4 `scorer/patterns.ts` — Behavioral Signals

Beyond keywords, behavioral context matters. A message saying "come meet me" in a public YouTube comment is lower risk than the same message in a private DM from an unknown user.

Pattern signals include:
- **Element type**: DMs and private chats are scored higher than public posts
- **Unknown sender**: No identifiable sender is a significant risk signal
- **Message length + punctuation**: Short messages with multiple exclamation marks suggest pressure tactics
- **Platform risk baseline**: Each platform has a base risk coefficient

---

### 4.5 `service-worker.ts` — The Secure Proxy

The service worker runs as a persistent background process, separate from any web page. It is the only part of the extension that can make network calls and access Chrome APIs that content scripts cannot.

**Responsibilities:**
1. Receive `ESCALATE` messages from the content script
2. Optionally capture a screenshot with `captureVisibleTab()` (score > 0.75 only)
3. POST the payload to the backend `/analyze` endpoint
4. Receive the nudge + severity in response
5. Forward a `SHOW_NUDGE` message to the active tab's content script
6. Update session storage with nudge count (for the popup)

**Why can't the content script do this?** Two reasons:
- `captureVisibleTab()` is only available to background scripts
- Fetch calls from a content script would expose the backend URL and any embedded tokens in the extension bundle

---

### 4.6 `nudge/renderer.ts` + `NudgeOverlay.tsx` — The Intervention

When the service worker sends `SHOW_NUDGE`, the renderer mounts a Preact component directly into the page's DOM as a fixed-position overlay.

**Design principles:**
- Non-blocking: the child can still see and interact with the page behind it
- Dismissable: a clear "Entendido, gracias" button removes the overlay
- Age-appropriate: icon + short plain-language message, no legal or technical language
- Severity-aware: color changes with severity (yellow → orange → red)
- Auto-dismiss: `bajo` severity nudges disappear after 15 seconds automatically

**CSS isolation:** All overlay styles are scoped under `#lumi-nudge-root *` to prevent bleeding into the host page. The stylesheet is loaded as a web accessible resource via `chrome.runtime.getURL()`.

**Why Preact over React?** Preact is 3KB vs React's ~40KB. Smaller bundle means faster injection into the page and less risk of conflicting with the host page's own React instance (Roblox's web UI, for example, uses React internally).

---

### 4.7 `popup/Popup.tsx` — Child-Facing Summary

The extension popup (shown when the child clicks the LUMI icon in the toolbar) displays a simple, non-alarming session summary: how many times LUMI checked in today. It reads from `chrome.storage.session` which the service worker updates after each nudge.

This is intentionally minimal. The popup is for the child, not the parent. It communicates presence and care, not surveillance.

---

## 5. End-to-End Flow

Below is the complete sequence from a new DOM node appearing on screen to a nudge being displayed and a parent being notified.

---

### Step 1 — Page loads, content script boots

Chrome detects a navigation matching `<all_urls>` in the manifest and injects `content-script.ts` into the page at `document_idle`. The script immediately attaches a `MutationObserver` to `document.body`.

---

### Step 2 — New content appears on screen

A new chat message, comment, or UI element is added to the DOM by the platform (YouTube loading comments, Roblox rendering chat). The `MutationObserver` fires with the new node.

---

### Step 3 — Debounce window (300ms)

If multiple nodes appear in rapid succession (e.g., a chat history loading), the debounce timer resets on each one. The pipeline only fires once, 300ms after the last mutation.

---

### Step 4 — Signal extraction

`extractSignals(node)` reads:
- `text` — the visible text content of the node
- `sender` — nearby DOM attributes like `data-author` or `data-username`
- `elementType` — classified as `dm`, `comment`, `post`, or `unknown` based on CSS class patterns
- `platform` — `location.hostname`
- `url` — full current URL
- `timestamp` — `Date.now()`

If text is shorter than 10 characters, the node is skipped as too short to be meaningful.

---

### Step 5 — Heuristic scoring (local, <50ms)

`score(payload)` evaluates all five signal types and returns one of three actions:

- `ignore` → pipeline stops, nothing happens
- `watch` → logged locally, observer continues
- `escalate` → payload sent to service worker

---

### Step 6 — Message to service worker

The content script sends a `ESCALATE` message via `chrome.runtime.sendMessage()` with the full payload including the score and per-signal breakdown.

---

### Step 7 — Optional screenshot (service worker)

If `score > 0.75`, the service worker calls `chrome.tabs.captureVisibleTab()` to take a JPEG screenshot at 60% quality. This is base64-encoded and attached to the backend payload. If the call fails (tab not active, permission issue), execution continues without the screenshot.

---

### Step 8 — Backend POST `/analyze`

The service worker sends a `POST` request to the LUMI backend with:

```json
{
  "text": "...",
  "sender": "...",
  "platform": "roblox.com",
  "elementType": "dm",
  "score": 0.74,
  "signals": { "keyword": 0.9, "offer": 0.6, "sender": 0.6, "pattern": 0.4, "platform": 0.4 },
  "screenshot": "data:image/jpeg;base64,..."
}
```

---

### Step 9 — LLM classification (backend)

The backend (Bun + Elysia on Railway) receives the payload and calls OpenRouter with a structured prompt. The model analyzes the text, the signal context, and optionally the screenshot. It returns a JSON object:

```json
{
  "category": "reclutamiento_criminal",
  "severity": "alto",
  "nudge": "Parece que alguien te está ofreciendo algo a cambio de un favor. Habla con un adulto de confianza antes de responder.",
  "confidence": 0.87
}
```

The screenshot is analyzed and immediately discarded — never written to disk or stored in any database.

---

### Step 10 — Event logged to Supabase

The backend inserts a row into the `threat_events` table:

```json
{
  "child_id": "...",
  "platform": "roblox.com",
  "category": "reclutamiento_criminal",
  "severity": "alto",
  "nudge_text": "...",
  "confidence": 0.87,
  "timestamp": "2026-04-25T14:32:00Z"
}
```

The parent dashboard is subscribed to this table via Supabase Realtime. The new row triggers an immediate UI update — no polling required.

---

### Step 11 — Parent notification check

The backend fetches the child's profile to read the parent's configured notification threshold (default: `medio`). If the event's severity meets or exceeds it, Resend sends an email immediately.

```
Severity ladder: bajo → medio → alto → crítico
If event severity index >= threshold index → send notification
```

---

### Step 12 — Nudge returned to extension

The backend responds to the POST with the nudge text and severity. The service worker receives this and calls:

```javascript
chrome.tabs.sendMessage(tab.id, {
  type: 'SHOW_NUDGE',
  nudge: result.nudge,
  severity: result.severity
})
```

---

### Step 13 — Nudge rendered on page

The content script's message listener receives `SHOW_NUDGE`. It calls `renderNudge()`, which:
1. Removes any existing nudge overlay
2. Creates a `div#lumi-nudge-root` and appends it to `document.body`
3. Mounts the `NudgeOverlay` Preact component into it
4. The child sees the nudge at the bottom-right of the screen

---

### Step 14 — Session storage updated

The service worker increments `lumiSession.nudgesShown` in `chrome.storage.session`. If the child opens the popup, they see an updated count.

---

## 6. Data Flow Diagram

```
PAGE DOM
   │
   │  MutationObserver fires on new node
   ▼
extractSignals()
   │
   │  text, sender, platform, elementType
   ▼
score()  ─────── < 0.3 ──────▶  IGNORE
   │
   │  > 0.6
   ▼
chrome.runtime.sendMessage('ESCALATE')
   │
   ▼
SERVICE WORKER
   │
   ├── score > 0.75? ──▶ captureVisibleTab() ──▶ base64 screenshot
   │
   ▼
POST /analyze  ──────────────────────────────────▶  BACKEND (Bun + Elysia)
                                                         │
                                                         ├──▶ OpenRouter LLM
                                                         │       └── returns { category, severity, nudge }
                                                         │
                                                         ├──▶ Supabase INSERT threat_events
                                                         │       └── Dashboard realtime update
                                                         │
                                                         ├──▶ Resend email (if severity >= threshold)
                                                         │
                                                         └──▶ Return { nudge, severity }
   │
   ◀─────────────────────────────────────────────────────
   │
chrome.tabs.sendMessage('SHOW_NUDGE')
   │
   ▼
CONTENT SCRIPT
   │
renderNudge(text, severity)
   │
   ▼
Preact NudgeOverlay mounted on page
Child sees nudge ✓
```

---

## 7. Key Design Decisions

### Two-step detection (heuristic + LLM)
The LLM is only called when the local scorer flags something. This keeps the system fast (sub-50ms for safe content), cost-efficient (LLM calls only on signal), and reliable (the scorer is deterministic and always available even if the backend is down).

### Content script cannot call APIs
All fetch calls go through the service worker. This keeps API keys server-side and out of the extension bundle, which is publicly inspectable.

### Screenshots analyzed and discarded immediately
Screenshots are sent to the vision model and the response is used to inform the nudge. The image bytes are never written to disk, never stored in Supabase, and never logged anywhere. This is the minimum viable privacy posture for a product dealing with minors.

### Preact over React
At ~3KB vs ~40KB, Preact injects faster and avoids conflicts with host page React instances. It supports hooks and functional components — the API LUMI needs.

### Nudges never block
The overlay is `position: fixed` and sits above content visually, but never disables interaction with the page beneath it. Blocking access would make the extension trivially bypassable (just close and reopen the tab) and would signal to a recruiter that monitoring is active.

### WXT for extension scaffolding
WXT handles manifest generation, hot reload in development, and the build pipeline for Chrome MV3. This saves significant setup time vs configuring Vite manually for a multi-entry extension.

### OpenRouter as model abstraction
Calling OpenRouter instead of Claude or Gemini directly means the model can be swapped without changing any code. During a hackathon this matters: if one provider's credits run out, the model string is the only thing that changes.

---

## 8. Constraints & Limitations

**Canvas-rendered content is invisible.** Some games render entirely to a `<canvas>` element. The MutationObserver sees the canvas tag, not its contents. Roblox's in-game chat (when running the desktop app) falls into this category. The extension covers the Roblox *website* but not the native client.

**End-to-end encrypted messages cannot be read.** WhatsApp Web encrypts messages client-side. The DOM shows placeholder elements but not decrypted text. This is by design in those platforms.

**Cross-origin iframes are isolated.** An iframe loading content from a different origin cannot be observed by the content script. If a platform embeds a third-party chat widget in an iframe, that content is outside LUMI's reach.

**The extension must be installed on the device the child uses.** LUMI has no coverage on devices where it isn't installed. It also doesn't cover native mobile apps — only web browsers with the extension active.

**False positives are possible.** The heuristic scorer uses keyword matching which is context-blind. A child discussing a school project about crime history could trip the narco keywords. The LLM in step 2 is designed to catch these — but a high-confidence false positive nudge is still a worse experience than no nudge. Threshold tuning during testing is important.

**The service worker can be unregistered.** Chrome may terminate idle service workers. This is handled by the MV3 architecture (service workers are re-registered on next message), but there is a small window where a rapid sequence of events could miss a message if the worker is spinning up.
