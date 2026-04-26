import type { AnalysisCategory, RiskLevel } from '@emmanuelbalderasb/shared-types';
import { getSupabaseClient } from './client.ts';

export type EscalationEventRecord = {
  eventId: string;
  fingerprint: string;
  pipelineVersion: string;
  source: string;
  pageUrl: string;
  receivedAt: string;
  riskLevel: RiskLevel;
  totalScore: number;
  occurrencesByCategory: Record<string, number>;
  occurrencesBySeverity: Record<string, number>;
  occurrencesBySignalType: Record<string, number>;
  matchedTerms: string[];
  llmCategory: AnalysisCategory | null;
  llmConfidence: number | null;
  nudgeText: string | null;
  visionSummary: string | null;
  processingMs: number;
  timeoutFlags: string[];
  providerFailures: string[];
  deduped: boolean;
};

const WRITE_TIMEOUT_MS = 600;
const TABLE_NAME = 'escalation_events';

const withTimeout = async <T>(promise: Promise<T>, timeoutMs: number): Promise<T> => {
  return await Promise.race([
    promise,
    new Promise<T>((_, reject) => {
      setTimeout(() => reject(new Error(`Timeout after ${timeoutMs}ms`)), timeoutMs);
    }),
  ]);
};

export const persistEscalationEvent = async (
  event: EscalationEventRecord,
): Promise<{ ok: true } | { ok: false; error: string }> => {
  const { client, reason } = getSupabaseClient();
  if (!client) {
    return { ok: false, error: reason ?? 'Supabase not configured' };
  }

  try {
    const result = await withTimeout(
      Promise.resolve(client.from(TABLE_NAME).insert(event)),
      WRITE_TIMEOUT_MS,
    );
    if (result.error) {
      throw new Error(result.error.message);
    }
    return { ok: true };
  } catch (error: unknown) {
    return {
      ok: false,
      error: error instanceof Error ? error.message : String(error),
    };
  }
};
