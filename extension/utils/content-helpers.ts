import {
  KEYWORD_CATEGORIES,
  RISK_LEVELS,
  SIGNAL_TYPES,
  type AnalysisPayload,
  type KeywordRule,
  type RiskLevel,
} from '@shared';

export type CompiledRuleVariant = {
  rule: KeywordRule;
  normalizedNeedle: string;
  signalType: KeywordRule['signalType'];
  needsWordBoundary: boolean;
};

/**
 * Canonical normalization used for both page text and keyword rules.
 * Keeps matching resilient to case, accents, and uneven whitespace.
 */
export const normalizeText = (value: string): string =>
  value
    .toLowerCase()
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .replace(/\s+/g, ' ')
    .trim();

const isBoundaryChar = (value: string | undefined): boolean =>
  !value || !/[\p{L}\p{N}_]/u.test(value);

/**
 * Counts non-overlapping occurrences of a needle in a source string.
 * Optional boundary checks avoid false positives inside larger words.
 */
export const countOccurrences = (
  source: string,
  needle: string,
  needsWordBoundary: boolean,
): number => {
  if (!needle) {
    return 0;
  }

  let count = 0;
  let fromIndex = 0;

  while (fromIndex < source.length) {
    const matchIndex = source.indexOf(needle, fromIndex);
    if (matchIndex < 0) {
      break;
    }

    const endsAt = matchIndex + needle.length;
    const isBoundaryMatch =
      !needsWordBoundary ||
      (isBoundaryChar(source[matchIndex - 1]) && isBoundaryChar(source[endsAt]));

    if (isBoundaryMatch) {
      count += 1;
    }

    fromIndex = endsAt;
  }

  return count;
};

/**
 * Compiles all keyword rules into normalized variants.
 * @param rules - The list of keyword rules to compile.
 * @returns CompiledRuleVariant[]
 */
export const buildCompiledVariants = (
  rules: readonly KeywordRule[],
): CompiledRuleVariant[] => {
  const compiled: CompiledRuleVariant[] = [];

  for (const rule of rules) {
    const values = new Set<string>([rule.value, ...(rule.aliases ?? [])]);
    for (const value of values) {
      const normalizedNeedle = normalizeText(value);
      if (!normalizedNeedle) {
        continue;
      }

      compiled.push({
        rule,
        normalizedNeedle,
        signalType: rule.signalType,
        needsWordBoundary: rule.signalType !== 'emoji', // Emoji rules don't need word boundaries
      });
    }
  }

  console.debug('[risk-analyzer.compiledVariants]', compiled);
  return compiled;
};

/**
 * Builds a zeroed category breakdown.
 * @returns Record<KeywordCategory, number>
 */
export const buildZeroCategoryBreakdown =
  (): AnalysisPayload['occurrencesByCategory'] =>
    KEYWORD_CATEGORIES.reduce(
      (acc, category) => ({ ...acc, [category]: 0 }),
      {} as AnalysisPayload['occurrencesByCategory'],
    );

/**
 * Builds a zeroed severity breakdown.
 * @returns Record<RiskLevel, number>
 */
export const buildZeroSeverityBreakdown =
  (): AnalysisPayload['occurrencesBySeverity'] =>
    RISK_LEVELS.reduce(
      (acc, severity) => ({ ...acc, [severity]: 0 }),
      {} as AnalysisPayload['occurrencesBySeverity'],
    );

/**
 * Builds a zeroed signal type breakdown.
 * @returns Record<SignalType, number>
 */
export const buildZeroSignalBreakdown =
  (): AnalysisPayload['occurrencesBySignalType'] =>
    SIGNAL_TYPES.reduce(
      (acc, signalType) => ({ ...acc, [signalType]: 0 }),
      {} as AnalysisPayload['occurrencesBySignalType'],
    );

/**
 * Builds a hash of a text value.
 * @param value - The text value to hash.
 * @returns string
 */
export const buildTextHash = (value: string): string => {
  let hash = 5381;
  for (let i = 0; i < value.length; i += 1) {
    hash = (hash * 33) ^ value.charCodeAt(i);
  }
  return `${hash >>> 0}`;
};

export const buildEscalationFingerprint = (payload: AnalysisPayload): string => {
  // Stable fingerprint used to suppress duplicate escalations for near-identical findings.
  const termsKey = payload.matchedTerms
    .map((term) => `${term.ruleId}:${term.count}`)
    .sort()
    .join('|');

  return [payload.url, payload.riskLevel, payload.totalScore.toFixed(2), termsKey].join('::');
};
