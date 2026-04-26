import { describe, expect, test } from 'bun:test';
import type { EscalationBackendRequest } from '@emmanuelbalderasb/shared-types';
import { evaluatePolicy } from './policy.ts';

const baseRequest: EscalationBackendRequest = {
  payload: {
    timestamp: new Date().toISOString(),
    url: 'https://example.com/chat',
    totalScore: 1,
    riskLevel: 'LOW',
    riskColor: 'GREEN',
    occurrencesByCategory: {
      financialData: 0,
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
    occurrencesBySeverity: { LOW: 1, MEDIUM: 0, HIGH: 0, CRITICAL: 0 },
    occurrencesBySignalType: { word: 1, hashtag: 0, emoji: 0 },
    matchedTerms: [],
    performance: {
      durationMs: 7,
      truncated: false,
      nodesScanned: 12,
      textCharsScanned: 320,
      batchBudgetMs: 50,
    },
  },
  source: 'initial',
  fingerprint: 'fp-policy',
  pageUrl: 'https://example.com',
};

describe('evaluatePolicy', () => {
  test('requires intervention for high risk', () => {
    const decision = evaluatePolicy({
      ...baseRequest,
      payload: { ...baseRequest.payload, riskLevel: 'HIGH' },
    });
    expect(decision.interventionRequired).toBe(true);
    expect(decision.reason).toBe('high-risk-level');
  });

  test('requires intervention for score threshold', () => {
    const decision = evaluatePolicy({
      ...baseRequest,
      payload: { ...baseRequest.payload, totalScore: 14, riskLevel: 'MEDIUM' },
    });
    expect(decision.interventionRequired).toBe(true);
    expect(decision.reason).toBe('score-threshold');
  });

  test('returns non intervention for low-risk low-score events', () => {
    const decision = evaluatePolicy(baseRequest);
    expect(decision.interventionRequired).toBe(false);
    expect(decision.reason).toBe('non-intervention');
  });
});
