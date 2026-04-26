import { describe, expect, test } from 'bun:test';
import type { EscalationBackendRequest } from '@emmanuelbalderasb/shared-types';
import { normalizeEscalationRequest } from './normalize.ts';

const buildRequest = (): EscalationBackendRequest => ({
  payload: {
    timestamp: new Date().toISOString(),
    url: 'https://example.com/chat',
    totalScore: 12,
    riskLevel: 'HIGH',
    riskColor: 'RED',
    occurrencesByCategory: {
      financialData: 1,
      missionRecruitment: 0,
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
    occurrencesBySeverity: { LOW: 0, MEDIUM: 0, HIGH: 1, CRITICAL: 0 },
    occurrencesBySignalType: { word: 1, hashtag: 0, emoji: 0 },
    matchedTerms: [],
    performance: {
      durationMs: 11,
      truncated: false,
      nodesScanned: 50,
      textCharsScanned: 1200,
      batchBudgetMs: 50,
    },
  },
  source: 'initial',
  fingerprint: '  fp-123  ',
  pageUrl: '  https://example.com/page  ',
  screenshotDataUrl: `  ${'data:image/jpeg;base64,'.padEnd(40, 'a')}  `,
});

describe('normalizeEscalationRequest', () => {
  test('trims top-level transport fields', () => {
    const normalized = normalizeEscalationRequest(buildRequest());
    expect(normalized.fingerprint).toBe('fp-123');
    expect(normalized.pageUrl).toBe('https://example.com/page');
  });

  test('drops screenshots above max supported size', () => {
    const request = buildRequest();
    request.screenshotDataUrl = `data:image/jpeg;base64,${'a'.repeat(1_300_000)}`;
    const normalized = normalizeEscalationRequest(request);
    expect(normalized.screenshotDataUrl).toBeUndefined();
  });
});
