import type { EscalationBackendRequest } from '@emmanuelbalderasb/shared-types';

type PolicyDecisionReason =
  | 'critical-risk-level'
  | 'high-risk-level'
  | 'score-threshold'
  | 'non-intervention';

export type PolicyDecision = {
  interventionRequired: boolean;
  reason: PolicyDecisionReason;
};

const INTERVENTION_SCORE_THRESHOLD = 10;

export const evaluatePolicy = (request: EscalationBackendRequest): PolicyDecision => {
  if (request.payload.riskLevel === 'CRITICAL') {
    return { interventionRequired: true, reason: 'critical-risk-level' };
  }

  if (request.payload.riskLevel === 'HIGH') {
    return { interventionRequired: true, reason: 'high-risk-level' };
  }

  if (request.payload.totalScore >= INTERVENTION_SCORE_THRESHOLD) {
    return { interventionRequired: true, reason: 'score-threshold' };
  }

  return { interventionRequired: false, reason: 'non-intervention' };
};
