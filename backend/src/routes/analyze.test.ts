import { describe, expect, test } from 'bun:test';
import { handleAnalyzeRoute } from './analyze.ts';

const validRequestBody = {
  payload: {
    timestamp: new Date().toISOString(),
    url: 'https://example.com/chat',
    totalScore: 3,
    riskLevel: 'MEDIUM',
    riskColor: 'YELLOW',
    occurrencesByCategory: {
      financialData: 0,
      missionRecruitment: 1,
      illicitRewardPromise: 0,
      personalInformation: 0,
      platformMigrationEvasion: 0,
      sextortionPhotoRequest: 0,
      meetingStrangers: 0,
      deepfakesMisinformation: 0,
      hacksMalwareDownload: 0,
      spamHarassmentMessages: 0,
      selfHarmSuicide: 0,
      directThreat: 0,
    },
    occurrencesBySeverity: { LOW: 0, MEDIUM: 1, HIGH: 0, CRITICAL: 0 },
    occurrencesBySignalType: { word: 1, hashtag: 0, emoji: 0 },
    matchedTerms: [],
    performance: {
      durationMs: 10,
      truncated: false,
      nodesScanned: 20,
      textCharsScanned: 700,
      batchBudgetMs: 50,
    },
  },
  source: 'initial',
  fingerprint: 'fp-routes',
  pageUrl: 'https://example.com/chat',
};

describe('handleAnalyzeRoute', () => {
  test('returns 200 with vNext metadata for valid payload', async () => {
    const request = new Request('http://localhost/analyze', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(validRequestBody),
    });

    const response = await handleAnalyzeRoute(request);
    const body = (await response.json()) as {
      ok: boolean;
      traceId?: string;
      pipelineVersion?: string;
      analysis?: unknown;
    };

    expect(response.status).toBe(200);
    expect(body.ok).toBe(true);
    expect(typeof body.traceId).toBe('string');
    expect(body.pipelineVersion).toBe('v1.0.0');
    expect(body.analysis).toBeUndefined();
  });

  test('returns 422 for malformed contract payload', async () => {
    const request = new Request('http://localhost/analyze', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ foo: 'bar' }),
    });

    const response = await handleAnalyzeRoute(request);
    const body = (await response.json()) as { ok: boolean; error?: string };
    expect(response.status).toBe(422);
    expect(body.ok).toBe(false);
    expect(body.error?.includes('contract')).toBe(true);
  });

  test('returns enriched analysis for intervention payload', async () => {
    const request = new Request('http://localhost/analyze', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        ...validRequestBody,
        fingerprint: 'fp-routes-critical',
        payload: {
          ...validRequestBody.payload,
          totalScore: 20,
          riskLevel: 'CRITICAL',
          riskColor: 'RED',
        },
      }),
    });

    const response = await handleAnalyzeRoute(request);
    const body = (await response.json()) as {
      ok: boolean;
      analysis?: { nudge?: string; severity?: string };
    };
    expect(response.status).toBe(200);
    expect(body.ok).toBe(true);
    expect(body.analysis?.severity).toBe('CRITICAL');
    expect(typeof body.analysis?.nudge).toBe('string');
  });
});
