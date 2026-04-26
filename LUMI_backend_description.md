# LUMI — Backend Integration Plan (Adapted to Current Project)

> Current stack: MV3 + WXT + Preact + shared typed contracts.  
> This document keeps the original structure but reflects what is already built today and what the backend must support next.

---

## Table of Contents

1. [What It Does](#1-what-it-does)
2. [Architecture Overview](#2-architecture-overview)
3. [File Structure](#3-file-structure)
4. [Component Breakdown](#4-component-breakdown)
5. [API Reference](#5-api-reference)
6. [End-to-End Request Flow](#6-end-to-end-request-flow)
7. [Analysis/LLM Strategy](#7-analysisllm-strategy)
8. [Data Operations](#8-data-operations)
9. [Key Design Decisions](#9-key-design-decisions)
10. [Environment Variables](#10-environment-variables)

---

## 1. What It Does

LUMI currently works as an **extension-first risk detection system**:

- The content script scans visible page text in real time.
- It scores risk signals locally using shared keyword rules and severity weights.
- For `MEDIUM/HIGH/CRITICAL`, it escalates a typed payload to the background worker.
- The background worker optionally captures a screenshot and forwards the escalation to backend `POST /analyze`.

The backend is currently a transport integration point for escalations. The near-term plan is to evolve that endpoint so every escalation that requires intervention returns an LLM-generated child-safe nudge, without breaking the existing contracts between content/background/shared types.

---

## 2. Architecture Overview

```text
Chrome Tab
  │
  │ content script (extension/entrypoints/content.ts)
  │ - text extraction + normalization
  │ - rule matching + scoring
  │ - escalation throttling
  ▼
MV3 Background Worker (extension/entrypoints/background.ts)
  │
  │ - validates ESCALATE message
  │ - optional captureVisibleTab jpeg
  │ - POST /analyze with EscalationBackendRequest
  ▼
Backend /analyze
  │
  │ - receives typed escalation payload
  │ - handles server-side processing (current + future)
  ▼
EscalationAck back to extension runtime
```

---

## 3. File Structure

```text
extension/
├── entrypoints/
│   ├── content.ts                # Local analyzer + escalation producer
│   ├── background.ts             # Escalation transport + screenshot capture
│   └── popup/*                   # Popup UI (currently scaffold/demo)
├── utils/
│   ├── content-helpers.ts        # normalization, hash/fingerprint, matching helpers
│   └── background-helpers.ts     # backend URL + screenshot policy helpers
└── wxt.config.ts

packages/shared-types/
└── src/
    ├── contracts.ts              # AnalysisPayload/Escalation* contracts
    ├── risk-categories.ts        # category + severity model
    └── risk-indicators.ts        # keyword rule inventory

backend/
├── src/
│   ├── index.ts                  # server bootstrap + route registration
│   ├── routes/
│   │   ├── analyze.ts            # POST /analyze (main ingestion endpoint)
│   │   └── health.ts             # GET /health
│   ├── contracts/
│   │   ├── escalation.ts         # runtime schema mirrors shared-types contract
│   │   └── response.ts           # ack + analysis response shape (includes nudge)
│   ├── services/
│   │   ├── normalize.ts          # sanitize/trim payload for stable downstream usage
│   │   ├── dedupe.ts             # idempotency window by fingerprint
│   │   ├── classifier.ts         # mandatory LLM nudge + classification orchestration
│   │   ├── vision.ts             # screenshot interpretation (when provided)
│   │   └── policy.ts             # risk policy gates (when to call LLM/store/escalate)
│   ├── db/
│   │   ├── client.ts             # database client lifecycle
│   │   └── escalation-events.ts  # event insert/query helpers
│   └── observability/
│       ├── logger.ts             # structured logs
│       └── metrics.ts            # latency/error counters
└── (implementation can be phased; structure above is target backend layout)
```

---

## 4. Component Breakdown

### 4.1 `extension/entrypoints/content.ts` — Real-time Analyzer

Main behavior implemented today:

- Runs on `<all_urls>`.
- Performs an initial chunked scan plus mutation-based incremental scans.
- Normalizes text (lowercase, diacritic stripping, whitespace cleanup).
- Matches against `RISK_INDICATOR_RULES` (word/hashtag/emoji).
- Computes aggregate score and final `RiskLevel`.
- Escalates only on meaningful risk (`MEDIUM+`) and throttles repeated events by fingerprint.

Also includes current UX overlays (Lumi hover element and medium/high risk GIF overlays), which are independent of backend response payloads.

### 4.2 `extension/entrypoints/background.ts` — Escalation Transport Layer

Main behavior implemented today:

- Accepts only `ESCALATE` messages matching shared contracts.
- Reads `VITE_BACKEND_URL` and sends request to `${VITE_BACKEND_URL}/analyze`.
- Captures screenshot only for stronger risk signals (`HIGH/CRITICAL` or high score threshold).
- Returns typed `EscalationAck` to content script (`ok`, optional status/error).
- Persists local risk summary state in `browser.storage.local`.

### 4.3 `packages/shared-types/src/contracts.ts` — Contract Source of Truth

Defines typed structures used across extension and backend:

- `AnalysisPayload`
- `EscalationMessage`
- `EscalationBackendRequest`
- `EscalationAck`

This package is the integration boundary. Backend changes should preserve compatibility with these contracts (or version them intentionally).

### 4.4 `extension/utils/content-helpers.ts` — Deterministic Signal Helpers

Holds pure helpers for:

- text normalization
- compiled matching variants
- occurrence counting
- text hash dedupe
- escalation fingerprint generation
- zero-value category/severity/signal breakdown builders

Keeping this logic isolated makes risk analysis behavior deterministic and easier to test.

### 4.5 `extension/utils/background-helpers.ts` — Transport Policy Helpers

Contains runtime policies and guards such as:

- backend URL normalization/validation
- escalation message type guards
- screenshot eligibility decision (`shouldCaptureScreenshot`)

This keeps `background.ts` focused on orchestration rather than branching policy details.

### 4.6 `backend/src/routes/analyze.ts` — Ingestion + Orchestration Boundary

`POST /analyze` should be treated as a pipeline with explicit stages:

1. **Decode + schema validation**
   - Validate request shape against the same contract semantics used in `packages/shared-types/src/contracts.ts`.
   - Reject malformed requests with `400/422` quickly.

2. **Normalization**
   - Clamp long strings, normalize URL fields, and trim oversized screenshot payloads.
   - Keep normalized copy for processing and (optional) persistence.

3. **Idempotency / dedupe check**
   - Use `fingerprint` + short TTL window to avoid repeated inserts/expensive enrich calls caused by DOM churn.
   - Duplicate events can still return `ok: true` to keep extension flow stable.

4. **Policy decision**
   - Based on `riskLevel`, `totalScore`, and screenshot presence, decide whether to:
     - return immediate ack only for non-intervention events,
     - run mandatory LLM nudge generation for intervention events,
     - add vision context when screenshot is present.

5. **LLM nudge generation (required for intervention events)**
   - Run classifier/LLM with strict timeout budgets.
   - Treat provider failures as non-fatal by returning a deterministic fallback nudge; never return an intervention event without nudge text.

6. **Persistence + async side-effects**
   - Insert normalized escalation record.
   - Add enriched attributes when available.
   - Keep persistence non-blocking when safe; if awaited, enforce short timeout.

7. **Response assembly**
   - Always return `EscalationAck`-compatible payload (`ok`, optional `status/error`).
   - Include additive fields only when the extension version supports them.

### 4.7 `backend/src/services/*` — Service Responsibilities

- `normalize.ts`: canonical event mapper from transport payload into backend-safe domain object.
- `dedupe.ts`: idempotency key generation and TTL checks.
- `policy.ts`: pure business logic for intervention thresholds, LLM invocation, and storage policy.
- `classifier.ts`: LLM request builder + strict parser + fallback nudge outputs.
- `vision.ts`: screenshot analysis guardrails (size/type/timeout) and one-line visual summary extraction.

These services should be pure where possible and called by route handlers/orchestrators rather than directly coupled to HTTP framework internals.

### 4.8 `backend/src/db/*` — Persistence Layer

- `client.ts`: one shared connection/client instance.
- `escalation-events.ts`: typed insert/query API for event records.
- Writes should include:
  - request metadata (`timestamp`, `source`, `fingerprint`, `pageUrl`)
  - payload summary (`riskLevel`, `totalScore`, breakdown snapshots)
  - enrichment results when present (`category`, `confidence`, `nudge`, `visionSummary`)
  - operational metadata (`processingMs`, `pipelineVersion`, `errorFlags`)

---

## 5. API Reference

### `POST /analyze`

Current integration contract from extension to backend:

**Request body (`EscalationBackendRequest`):**

```json
{
  "payload": {
    "timestamp": "2026-04-26T00:00:00.000Z",
    "url": "https://example.com/chat",
    "totalScore": 12.37,
    "riskLevel": "HIGH",
    "riskColor": "RED",
    "occurrencesByCategory": {},
    "occurrencesBySeverity": {},
    "occurrencesBySignalType": {},
    "matchedTerms": [],
    "performance": {
      "durationMs": 22.4,
      "truncated": false,
      "nodesScanned": 160,
      "textCharsScanned": 9200,
      "batchBudgetMs": 80
    }
  },
  "source": "mutation",
  "fingerprint": "sha256:...",
  "pageUrl": "https://example.com/chat",
  "screenshotDataUrl": "data:image/jpeg;base64,..."
}
```

**Response consumed by extension (`EscalationAck`):**

```json
{
  "ok": true,
  "status": 200
}
```

Recommended response semantics:

- `200`: accepted/processed (base behavior)
- `202`: accepted asynchronously (only for non-intervention/background jobs)
- `400/422`: invalid request contract
- `429`: rate limited (future hardening)
- `500`: unexpected backend failure

Planned additive response envelope (vNext, backward compatible):

```json
{
  "ok": true,
  "status": 200,
  "analysis": {
    "category": "contacto_riesgo",
    "severity": "HIGH",
    "confidence": 0.88,
    "nudge": "Esta conversación puede ser riesgosa. Mejor habla con un adulto de confianza antes de responder."
  },
  "traceId": "evt_01H...",
  "pipelineVersion": "2026-04-v1"
}
```

Notes:
- Keep `ok/status/error` stable so existing extension code continues working.
- Additional fields must be optional and feature-gated by extension version.
- For intervention-level escalations, `analysis.nudge` is required and should be LLM-generated (or deterministic fallback if provider fails).

### `GET /health` (recommended)

Backend should expose a simple health route for deployment checks.

---

## 6. End-to-End Request Flow

```text
1. Content script scans initial DOM text in chunks.
2. MutationObserver accumulates new nodes and analyzes them on debounce.
3. Matcher computes score, breakdowns, and risk level from shared rules.
4. If risk is MEDIUM/HIGH/CRITICAL, content builds escalation fingerprint.
5. Content sends ESCALATE runtime message to background.
6. Background validates config and decides whether screenshot is needed.
7. Background posts EscalationBackendRequest to backend /analyze.
8. Backend validates schema and normalizes request.
9. Backend checks dedupe/idempotency by fingerprint window.
10. Backend executes policy branch (non-intervention ack vs intervention path).
11. For intervention events, backend runs classifier/LLM under strict timeout.
12. Backend adds vision context when screenshot is provided.
13. Backend stores normalized event (including nudge/enrichment outputs).
14. Backend returns EscalationAck-compatible response.
15. Background returns ack to content script.
16. Content continues scanning fail-open even if transport fails.
```

---

## 7. Analysis/LLM Strategy

Current state: risk detection is deterministic and local (rule/score based) inside the extension.

Adapted backend strategy for this codebase:

1. Keep local analyzer as fast first-pass signal engine.
2. Use backend as the mandatory nudge generation layer for intervention events (LLM + optional vision context).
3. Preserve backward compatibility: if advanced backend processing fails, still return valid `EscalationAck` so extension pipeline does not break.
4. Introduce enriched response payloads behind feature flags/versioning to avoid breaking current extension handlers.

Backend execution constraints (recommended):

- End-to-end target for non-intervention ack path: `p95 < 350ms`.
- Intervention path target (includes LLM nudge): `p95 < 1500ms`.
- Hard timeout budget per external provider call.
- Strict JSON-only parsing for model outputs plus deterministic fallback object.
- Circuit-breaker behavior: if provider error rate spikes, degrade to deterministic fallback nudge generation (not nudge omission).

This aligns with what is already implemented instead of assuming backend-only analysis from day one.

---

## 8. Data Operations

### Current implemented data flow

- Local risk telemetry is persisted in `browser.storage.local` by background worker.
- No strict dependency on backend persistence for analyzer continuity.

### Planned backend data flow (adapted)

- Accept and validate typed escalation events.
- Persist normalized escalation records (if/when DB integration is enabled).
- Attach LLM outputs for intervention events (category, confidence, nudge text, moderation flags).
- Keep insertion/logging non-blocking relative to extension round-trip where possible.

Recommended event model fields:

- **Identity**: `event_id`, `fingerprint`, `pipeline_version`
- **Transport context**: `source`, `page_url`, `received_at`
- **Risk summary**: `risk_level`, `total_score`, compacted breakdowns
- **Evidence summary**: top `matched_terms`, screenshot-present flag
- **Enrichment**: `llm_category`, `llm_confidence`, `nudge_text`, `vision_summary`
- **Ops telemetry**: `processing_ms`, `timeouts`, `provider_failures`, `deduped`

---

## 9. Key Design Decisions

**Extension-first detection.**  
The fastest and most reliable signal path is local analysis in content script; backend augments rather than blocks the primary detection loop.

**Typed contracts in shared package.**  
`packages/shared-types` is the canonical interface between extension and backend, reducing drift and integration bugs.

**Fail-open escalation transport.**  
If backend/network fails, content analysis continues. This avoids blind spots caused by transient outages.

**Selective screenshot capture.**  
Screenshots are only captured for stronger risks, reducing data volume and privacy exposure.

**Throttled escalation fingerprints.**  
Repeated DOM churn is common on modern sites; fingerprint throttling prevents backend spam and noisy duplicates.

**Backend evolution without contract breakage.**  
Nudge generation is mandatory for intervention events, while response shape changes remain additive and versioned to avoid disrupting current extension flow.

---

## 10. Environment Variables

Current extension runtime expectation:

```bash
# Extension -> backend target
VITE_BACKEND_URL=https://your-backend-host
```

Backend variables depend on deployed implementation, but recommended baseline:

```bash
# Server
PORT=3000

# LLM (required for intervention-level nudge generation)
OPENROUTER_API_KEY=sk-or-...
LLM_MODEL=anthropic/claude-sonnet-4-5

# Optional if/when persistence is enabled
SUPABASE_URL=https://xxxx.supabase.co
SUPABASE_ANON_KEY=eyJ...
```

No secrets should be exposed to content script or popup contexts.
