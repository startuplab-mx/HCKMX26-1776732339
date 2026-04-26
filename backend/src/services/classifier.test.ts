import { describe, expect, test } from 'bun:test';
import type { EscalationBackendRequest } from '@emmanuelbalderasb/shared-types';
import { classifyIntervention } from './classifier.ts';

const request: EscalationBackendRequest = {
  payload: {
    timestamp: new Date().toISOString(),
    url: 'https://example.com/chat',
    totalScore: 18,
    riskLevel: 'CRITICAL',
    riskColor: 'RED',
    occurrencesByCategory: {
      financialData: 0,
      missionRecruitment: 0,
      illicitRewardPromise: 0,
      personalInformation: 0,
      platformMigrationEvasion: 0,
      sextortionPhotoRequest: 1,
      meetingStrangers: 0,
      deepfakesMisinformation: 0,
      hacksMalwareDownload: 0,
      spamHarassmentMessages: 0,
      selfHarmSuicide: 0,
      directThreat: 0,
    },
    occurrencesBySeverity: { LOW: 0, MEDIUM: 0, HIGH: 0, CRITICAL: 1 },
    occurrencesBySignalType: { word: 1, hashtag: 0, emoji: 0 },
    matchedTerms: [],
    performance: {
      durationMs: 9,
      truncated: false,
      nodesScanned: 20,
      textCharsScanned: 600,
      batchBudgetMs: 50,
    },
  },
  source: 'mutation',
  fingerprint: 'fp-classifier',
  pageUrl: 'https://example.com',
};

describe('classifyIntervention', () => {
  test('falls back deterministically when provider key is missing', async () => {
    const previousApiKey = Bun.env.OPENROUTER_API_KEY;
    Bun.env.OPENROUTER_API_KEY = undefined;

    const result = await classifyIntervention(request);
    expect(result.usedFallback).toBe(true);
    expect(result.nudge.length).toBeGreaterThan(10);
    expect(result.severity).toBe('CRITICAL');

    Bun.env.OPENROUTER_API_KEY = previousApiKey;
  });
});
