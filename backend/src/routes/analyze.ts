import type {
  EscalationAck,
  EscalationBackendRequest,
} from '@emmanuelbalderasb/shared-types';
import { persistEscalationEvent } from '../db/escalation-events.ts';
import { incrementErrorCounter, observeStageDuration } from '../observability/metrics.ts';
import { logger } from '../observability/logger.ts';
import { classifyIntervention } from '../services/classifier.ts';
import { dedupeService } from '../services/dedupe.ts';
import { normalizeEscalationRequest } from '../services/normalize.ts';
import { evaluatePolicy } from '../services/policy.ts';
import { summarizeScreenshot } from '../services/vision.ts';

const PIPELINE_VERSION = 'v1.0.0';

const json = (body: EscalationAck, status: number): Response =>
  Response.json(body, {
    status,
    headers: {
      'x-trace-id': body.traceId ?? '',
      'x-pipeline-version': PIPELINE_VERSION,
    },
  });

const isRecord = (value: unknown): value is Record<string, unknown> =>
  Boolean(value) && typeof value === 'object' && !Array.isArray(value);

const isEscalationBackendRequest = (value: unknown): value is EscalationBackendRequest => {
  if (!isRecord(value)) {
    return false;
  }

  if (typeof value.source !== 'string' || typeof value.fingerprint !== 'string') {
    return false;
  }

  if (typeof value.pageUrl !== 'string') {
    return false;
  }

  if (!isRecord(value.payload)) {
    return false;
  }

  const payload = value.payload;
  if (
    typeof payload.timestamp !== 'string' ||
    typeof payload.url !== 'string' ||
    typeof payload.totalScore !== 'number' ||
    typeof payload.riskLevel !== 'string' ||
    !Array.isArray(payload.matchedTerms)
  ) {
    return false;
  }

  return true;
};

const now = (): number => performance.now();

export const handleAnalyzeRoute = async (request: Request): Promise<Response> => {
  const traceId = crypto.randomUUID();
  const pipelineStart = now();

  let requestPayload: unknown;
  try {
    requestPayload = await request.json();
  } catch {
    incrementErrorCounter('request.invalid_json');
    return json(
      {
        ok: false,
        status: 400,
        error: 'Invalid JSON body',
        traceId,
        pipelineVersion: PIPELINE_VERSION,
      },
      400,
    );
  }

  const validationStart = now();
  if (!isEscalationBackendRequest(requestPayload)) {
    observeStageDuration('validate', now() - validationStart);
    incrementErrorCounter('request.invalid_schema');
    return json(
      {
        ok: false,
        status: 422,
        error: 'Request does not match EscalationBackendRequest contract',
        traceId,
        pipelineVersion: PIPELINE_VERSION,
      },
      422,
    );
  }
  observeStageDuration('validate', now() - validationStart);

  const normalizeStart = now();
  const normalizedRequest = normalizeEscalationRequest(requestPayload);
  observeStageDuration('normalize', now() - normalizeStart);

  const dedupeStart = now();
  const isDuplicate = dedupeService.isDuplicate(normalizedRequest.fingerprint);
  observeStageDuration('dedupe', now() - dedupeStart);

  const policyStart = now();
  const policyDecision = evaluatePolicy(normalizedRequest);
  observeStageDuration('policy', now() - policyStart);

  let classification: Awaited<ReturnType<typeof classifyIntervention>> | undefined;
  const providerFailures: string[] = [];
  const timeoutFlags: string[] = [];

  if (policyDecision.interventionRequired) {
    const classifierStart = now();
    classification = await classifyIntervention(normalizedRequest);
    if (classification.usedFallback) {
      providerFailures.push('classifier_fallback');
    }
    observeStageDuration('classifier', now() - classifierStart);
  }

  const visionStart = now();
  const visionResult = await summarizeScreenshot(normalizedRequest.screenshotDataUrl);
  if (visionResult.timedOut) {
    timeoutFlags.push('vision_timeout');
  }
  observeStageDuration('vision', now() - visionStart);

  const processingMs = Number((now() - pipelineStart).toFixed(2));
  const ackBody: EscalationAck = {
    ok: true,
    status: isDuplicate && !policyDecision.interventionRequired ? 202 : 200,
    traceId,
    pipelineVersion: PIPELINE_VERSION,
    analysis: classification
      ? {
          category: classification.category,
          severity: classification.severity,
          confidence: classification.confidence,
          nudge: classification.nudge,
          visionSummary: visionResult.summary,
        }
      : undefined,
  };

  const persistStart = now();
  void persistEscalationEvent({
    eventId: traceId,
    fingerprint: normalizedRequest.fingerprint,
    pipelineVersion: PIPELINE_VERSION,
    source: normalizedRequest.source,
    pageUrl: normalizedRequest.pageUrl,
    receivedAt: normalizedRequest.payload.timestamp,
    riskLevel: normalizedRequest.payload.riskLevel,
    totalScore: normalizedRequest.payload.totalScore,
    occurrencesByCategory: normalizedRequest.payload.occurrencesByCategory,
    occurrencesBySeverity: normalizedRequest.payload.occurrencesBySeverity,
    occurrencesBySignalType: normalizedRequest.payload.occurrencesBySignalType,
    matchedTerms: normalizedRequest.payload.matchedTerms.map((term) => term.matchedValue),
    llmCategory: classification?.category ?? null,
    llmConfidence: classification?.confidence ?? null,
    nudgeText: classification?.nudge ?? null,
    visionSummary: visionResult.summary ?? null,
    processingMs,
    timeoutFlags,
    providerFailures,
    deduped: isDuplicate,
  }).then((result) => {
    observeStageDuration('persist', now() - persistStart);
    if (!result.ok) {
      incrementErrorCounter('persist.write_failed');
      logger.warn('persist.write_failed', {
        traceId,
        error: result.error,
      });
    }
  });

  logger.info('analyze.completed', {
    traceId,
    riskLevel: normalizedRequest.payload.riskLevel,
    totalScore: normalizedRequest.payload.totalScore,
    interventionRequired: policyDecision.interventionRequired,
    policyReason: policyDecision.reason,
    deduped: isDuplicate,
    processingMs,
  });

  return json(ackBody, ackBody.status ?? 200);
};
