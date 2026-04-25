# LUMI Chrome Extension — Actual Architecture

> Current implementation as of this repository state (MV3 + WXT + Preact + shared typed contracts).

---

## 1) What is implemented today

LUMI is currently a **keyword/rule-based risk analyzer extension** that:

- Scans visible page text (`<all_urls>`) from a content script.
- Scores detected risk indicators using local rule metadata (category, severity, confidence).
- Escalates medium/high/critical findings to the backend through the background worker.
- Optionally captures a screenshot for high-risk findings before sending the backend request.
- Returns an acknowledgment from background/backend transport, while local scanning continues fail-open.

Important: the current codebase **does not implement in-page nudge rendering** yet. The popup exists, but it is still scaffold/demo UI.

---

## 2) Runtime architecture

```text
┌──────────────────────────────────────────────────────────────────────┐
│ Chrome Tab                                                          │
│  content script: extension/entrypoints/content.ts                   │
│  - initial + mutation text extraction                               │
│  - normalization + rule matching                                    │
│  - scoring + risk level derivation                                  │
│  - dedupe/throttle escalation events                                │
│  - browser.runtime.sendMessage(ESCALATE)                            │
└───────────────────────────────┬──────────────────────────────────────┘
                                │ runtime message
                                ▼
┌──────────────────────────────────────────────────────────────────────┐
│ MV3 Background Worker                                                │
│  extension/entrypoints/background.ts                                │
│  - validates ESCALATE message shape                                 │
│  - decides if screenshot should be captured                         │
│  - captureVisibleTab(windowId, jpeg quality=60)                     │
│  - POST { payload, source, fingerprint, pageUrl, screenshot? }      │
│    to ${VITE_BACKEND_URL}/analyze                                   │
│  - returns EscalationAck { ok, status?, error? }                    │
└───────────────────────────────┬──────────────────────────────────────┘
                                │ HTTP
                                ▼
┌──────────────────────────────────────────────────────────────────────┐
│ Backend (/analyze)                                                   │
│  - receives EscalationBackendRequest                                 │
│  - performs server-side analysis/handling                            │
│  - responds with transport outcome consumed as EscalationAck         │
└──────────────────────────────────────────────────────────────────────┘
```

---

## 3) Code map (real files)

### Extension package (`extension/`)

- `entrypoints/content.ts`
  - Full risk-analysis pipeline (text collection, matching, scoring, escalation dispatch).
- `entrypoints/background.ts`
  - Message listener + backend forwarding + optional screenshot capture.
- `entrypoints/popup/*`
  - Preact popup scaffold (currently demo assets/counter UI).
- `wxt.config.ts`
  - WXT config, including extension page CSP for remote image hosts.

### Shared types package (`packages/shared-types/`)

- `src/contracts.ts`
  - Typed payload and message contracts shared between content/background/backend.
- `src/risk-categories.ts`
  - Category catalog + default severities + color mapping utilities.
- `src/risk-indicators.ts`
  - Concrete keyword/hashtag/emoji rule set used by the analyzer.

---

## 4) Content script pipeline (`entrypoints/content.ts`)

### 4.1 Entry and scope

- Registered for `matches: ['<all_urls>']`.
- Starts with:
  - an initial chunked scan of existing text nodes in `document.body`
  - a `MutationObserver` watching `childList + subtree` for newly added content.

### 4.2 Text extraction and normalization

- Ignores blocked tags: `SCRIPT`, `STYLE`, `NOSCRIPT`, `TEMPLATE`.
- Collects text via `TreeWalker(NodeFilter.SHOW_TEXT)`.
- Normalization:
  - lowercase
  - unicode NFD diacritic stripping
  - whitespace collapse/trim
- Uses hash-based dedupe (`buildTextHash`) to avoid re-analyzing repeated text.

### 4.3 Matching engine

- Compiles all `RISK_INDICATOR_RULES` into normalized variants (value + aliases).
- Counts occurrences using explicit boundary-aware matching for word/hashtag rules.
- Aggregates by:
  - category (`occurrencesByCategory`)
  - severity (`occurrencesBySeverity`)
  - signal type (`occurrencesBySignalType`)
- Emits detailed `matchedTerms` with per-rule `count` and `scoreContribution`.

### 4.4 Scoring and risk level

Per matched rule:

- `scoreContribution = log1p(count) * severityWeight * confidence`

Then adds severity amplifiers:

- `+ 2` per `HIGH` occurrence
- `+ 4` per `CRITICAL` occurrence

Risk levels are derived from final score and severity presence:

- `CRITICAL` if critical hits exist or score >= 16
- `HIGH` if score >= 10 or any high hits
- `MEDIUM` if score >= 4
- otherwise `LOW`

### 4.5 Budgets, batching, and throttling

- Analysis budgets:
  - nominal budget metadata: `50ms`
  - early-stop threshold: `40ms`
  - per-batch text char cap: `14,000`
- Mutation debounce: `120ms`.
- Initial scan chunking:
  - max 140 text nodes per chunk
  - yields with `setTimeout(..., 0)` to stay responsive.
- Escalation throttling:
  - fingerprint-based suppression window: `15s`.
  - cache limits for hashes and escalations to bound memory.

### 4.6 Escalation trigger

Escalates only when:

- `matchedTerms.length > 0`, and
- `riskLevel` is in `{ MEDIUM, HIGH, CRITICAL }`.

Dispatch message:

- type: `ESCALATE`
- payload: full `AnalysisPayload`
- metadata: `source` (`initial|mutation`), `fingerprint`, `pageUrl`.

If transport fails, analyzer keeps running (fail-open behavior).

---

## 5) Background worker behavior (`entrypoints/background.ts`)

### 5.1 Message handling

- Listens to `browser.runtime.onMessage`.
- Accepts only messages with `type === ESCALATE`.
- Normalizes/validates `VITE_BACKEND_URL`; returns error ack if missing.

### 5.2 Screenshot policy

Captures screenshot only when escalation is stronger:

- `totalScore >= 10`, or
- `riskLevel` is `HIGH`/`CRITICAL`.

Capture details:

- API: `browser.tabs.captureVisibleTab(windowId, { format: 'jpeg', quality: 60 })`
- On capture failure, continues request without screenshot.

### 5.3 Backend request

POST target:

- `${VITE_BACKEND_URL}/analyze`

Body (`EscalationBackendRequest`):

- `payload`
- `source`
- `fingerprint`
- `pageUrl`
- optional `screenshotDataUrl`

Returns `EscalationAck`:

- success: `{ ok: true, status }`
- failure: `{ ok: false, status?, error }`

---

## 6) Shared contract model

Core shared types (from `packages/shared-types/src/contracts.ts`):

- `AnalysisPayload`
  - scoring result + breakdown maps + matched term list + performance telemetry.
- `EscalationMessage`
  - runtime message envelope from content to background.
- `EscalationBackendRequest`
  - HTTP payload from background to backend.
- `EscalationAck`
  - transport outcome returned back to content script.

Also shared:

- `RiskLevel`: `LOW | MEDIUM | HIGH | CRITICAL`
- `RiskColor`: derived (`GREEN | YELLOW | RED`)
- Category definitions + default severities in `risk-categories.ts`
- Rule inventory in `risk-indicators.ts` (word, hashtag, emoji signals)

---

## 7) End-to-end sequence (implemented)

1. Content script boots on page and scans existing text in chunks.
2. MutationObserver queues newly added nodes; flushes every 120ms.
3. Analyzer normalizes text and matches against compiled indicator rules.
4. It computes score + risk level + breakdowns + matched terms.
5. If eligible, it generates a fingerprint and sends `ESCALATE`.
6. Background receives message, decides screenshot/no screenshot.
7. Background POSTs to backend `/analyze` with typed request body.
8. Background returns `EscalationAck` to content script.
9. Content script logs ack/failure and continues scanning.

---

## 8) What is not yet in this codebase

The following items may exist in product vision docs, but are not implemented here:

- In-page nudge overlay renderer/mounting flow.
- Background-to-content `SHOW_NUDGE` message contract and UI reaction path.
- Parent notification/dashboard/Supabase realtime pipeline.
- Persisted extension session UX linked to detection events.

---

## 9) Operational notes

- Extension networking requires `VITE_BACKEND_URL` configured at build/runtime.
- Current popup is non-production scaffold and independent of analyzer state.
- Content script is intentionally fail-open: analysis continues even if backend calls fail.
- CSP in `wxt.config.ts` currently permits `img-src` for UploadThing CDN hosts on extension pages.

---

## 10) Recommended next architecture steps

If the goal is full LUMI behavior, next concrete additions would be:

1. Add backend response schema for actionable intervention payload (nudge text + severity + rationale).
2. Add typed background->content message (`SHOW_NUDGE`) and content listener.
3. Implement nudge renderer module with isolated styles and dedupe.
4. Add local event persistence + popup state bound to analyzer outcomes.
5. Add test fixtures for scoring, escalation throttling, and contract compatibility.
