# LUMI Chrome Extension — Product & Architecture

> Current implementation as of this repository state (MV3 + WXT + Preact + shared typed contracts).

---

## Product overview

LUMI is a child-safety browser assistant focused on reducing narco-recruitment risk for minors online, especially early signals tied to cartel grooming or coercion patterns. It also supports broader child online-safety monitoring as a secondary scope. The extension watches page text in real time, detects risky language patterns, and escalates relevant events for additional backend analysis. It is designed to be fail-open, so browsing remains uninterrupted while detection and escalation continue in the background. The current implementation includes local page analysis, local in-page nudges, and a backend enrichment pipeline that can classify interventions and summarize screenshots for higher-risk events.

### AI contribution and human architecture ownership

This repository includes code and documentation produced with Cursor-assisted AI workflows. AI was used to accelerate implementation tasks, iteration, and writing support. However, the architecture, system boundaries, product decisions, and technical direction were designed and approved by human contributors.

AI/LLM outputs in this project are advisory and may be imperfect. They should not be treated as infallible safety decisions and must be reviewed in context with human judgment.

---

## 1) What is implemented today

LUMI is currently a **keyword/rule-based risk analyzer extension with backend enrichment** that:

- Scans visible page text (`<all_urls>`) from a content script.
- Scores detected risk indicators using local rule metadata (category, severity, confidence).
- Escalates medium/high/critical findings to the backend through the background worker.
- Optionally captures a screenshot for high-risk findings before sending the backend request.
- Renders local in-page hero and nudge UI when risk conditions are met.
- Returns an acknowledgment from background/backend transport, while local scanning continues fail-open.

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
│  - validates + normalizes + dedupes + policy checks                  │
│  - optional classifier and screenshot vision summary                 │
│  - async persistence + metrics/logging instrumentation               │
│  - responds with EscalationAck (+ optional analysis fields)          │
└──────────────────────────────────────────────────────────────────────┘
```

---

## 3) Code map

### Extension package (`extension/`)

- `entrypoints/content.ts`
  - Full risk-analysis pipeline (text collection, matching, scoring, escalation dispatch).
- `entrypoints/background.ts`
  - Message listener + backend forwarding + optional screenshot capture.
- `entrypoints/popup/*`
  - Preact popup with a "Control parental" action opening an extension dashboard page.
- `wxt.config.ts`
  - WXT config, including extension page CSP for remote image hosts.

### Shared types package (`packages/shared-types/`)

- `src/contracts.ts`
  - Typed payload and message contracts shared between content/background/backend.
- `src/risk-categories.ts`
  - Category catalog + default severities + color mapping utilities.
- `src/risk-indicators.ts`
  - Concrete keyword/hashtag/emoji rule set used by the analyzer.

### Backend package (`backend/`)

- `src/routes/analyze.ts`
  - Request contract validation and full analyze pipeline orchestration.
- `src/services/*`
  - `normalize.ts`, `dedupe.ts`, `policy.ts`, `classifier.ts`, `vision.ts` for staged analysis/enrichment.
- `src/db/*`
  - Optional event persistence for escalation telemetry/history.
- `src/observability/*`
  - Structured logging and stage/error metrics.

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
  - nominal budget metadata: `80ms`
  - early-stop threshold: `60ms`
  - per-batch text char cap: `14,000`
- Mutation debounce: `180ms`.
- Initial scan chunking:
  - max 150 text nodes per chunk
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
2. MutationObserver queues newly added nodes; flushes every 180ms.
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

- Production-ready popup/dashboard data integration with analyzer outcomes.
- Backend-to-content server-driven nudge contract wiring (`SHOW_NUDGE`) for runtime UI updates.
- Parent notification/dashboard/Supabase realtime pipeline.
- Persisted extension session UX linked to detection events.

---

## 9) Operational notes

- Extension networking requires `VITE_BACKEND_URL` configured at build/runtime.
- Optional extension gate `VITE_ENABLE_BACKEND_NUDGE=true` enables consumption/logging of backend `analysis.nudge` fields.
- Current popup provides a launcher action and is still largely independent of analyzer runtime state.
- Content script is intentionally fail-open: analysis continues even if backend calls fail.
- CSP in `wxt.config.ts` currently permits `img-src` for UploadThing CDN hosts on extension pages.
- Backend defaults to `PORT=3001` and supports `GET /health`, `POST /analyze`, and `GET /metrics`.
- Backend enrichment uses `OPENROUTER_API_KEY` (+ optional `LLM_MODEL` / `VISION_MODEL`) and optional persistence via `SUPABASE_URL` + `SUPABASE_ANON_KEY`.
- Architecture and technical design are human-authored; AI tooling (Cursor) is used for implementation assistance.

---

## 10) Recommended next architecture steps

If the goal is full LUMI behavior, next concrete additions would be:

1. Wire a typed background->content message (`SHOW_NUDGE`) path for server-driven nudges.
2. Connect popup/dashboard UX to live analyzer events and persisted history.
3. Add provider circuit-breaker state with temporary disable windows.
4. Harden privacy controls and explicit retention policies for persisted escalation data.
5. Add end-to-end load tests for enrichment latency and persistence durability.
