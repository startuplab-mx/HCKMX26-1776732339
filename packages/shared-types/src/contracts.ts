import type { KeywordCategory, RiskColor, RiskLevel, Severity } from './risk-categories';

export const SIGNAL_TYPES = ['word', 'hashtag', 'emoji'] as const;
export type SignalType = (typeof SIGNAL_TYPES)[number];

export interface KeywordRule {
  id: string;
  signalType: SignalType;
  value: string;
  aliases?: readonly string[];
  mappedCategory: KeywordCategory;
  baseSeverity: Severity;
  confidence: number;
}

export interface MatchedTerm {
  ruleId: string;
  signalType: SignalType;
  matchedValue: string;
  normalizedValue: string;
  category: KeywordCategory;
  severity: Severity;
  count: number;
  scoreContribution: number;
}

export type CategoryBreakdown = Record<KeywordCategory, number>;
export type SeverityBreakdown = Record<RiskLevel, number>;
export type SignalTypeBreakdown = Record<SignalType, number>;

export interface AnalysisPerformance {
  durationMs: number;
  truncated: boolean;
  nodesScanned: number;
  textCharsScanned: number;
  batchBudgetMs: number;
}

export interface AnalysisPayload {
  timestamp: string;
  url: string;
  totalScore: number;
  riskLevel: RiskLevel;
  riskColor: RiskColor;
  occurrencesByCategory: CategoryBreakdown;
  occurrencesBySeverity: SeverityBreakdown;
  occurrencesBySignalType: SignalTypeBreakdown;
  matchedTerms: MatchedTerm[];
  performance: AnalysisPerformance;
}

export const ESCALATION_MESSAGE_TYPE = 'ESCALATE' as const;
export type AnalysisSource = 'initial' | 'mutation';

export interface EscalationMessage {
  type: typeof ESCALATION_MESSAGE_TYPE;
  payload: AnalysisPayload;
  source: AnalysisSource;
  fingerprint: string;
  pageUrl: string;
}

export interface EscalationBackendRequest {
  payload: AnalysisPayload;
  source: AnalysisSource;
  fingerprint: string;
  pageUrl: string;
  screenshotDataUrl?: string;
}

export const ANALYSIS_CATEGORIES = [
  'safe',
  'grooming',
  'scam',
  'threat',
  'selfHarm',
  'sexualRisk',
  'other',
] as const;
export type AnalysisCategory = (typeof ANALYSIS_CATEGORIES)[number];

export interface EscalationAnalysis {
  category: AnalysisCategory;
  severity: RiskLevel;
  confidence: number;
  nudge: string;
  visionSummary?: string;
}

export interface EscalationAck {
  ok: boolean;
  status?: number;
  error?: string;
  analysis?: EscalationAnalysis;
  traceId?: string;
  pipelineVersion?: string;
}
