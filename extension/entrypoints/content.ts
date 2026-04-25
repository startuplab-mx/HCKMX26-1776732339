import {
  KEYWORD_CATEGORIES,
  type AnalysisPayload,
  type KeywordRule,
  type MatchedTerm,
  type RiskLevel,
  RISK_INDICATOR_RULES,
  RISK_LEVELS,
  SIGNAL_TYPES,
  riskLevelToColor,
} from '@shared';

const ANALYSIS_BUDGET_MS = 50;
const EARLY_STOP_MS = 40;
const DEBOUNCE_MS = 120;
const INITIAL_SCAN_MAX_TEXT_NODES_PER_CHUNK = 140;
const MAX_TEXT_CHARS_PER_BATCH = 14_000;
const MAX_HASH_CACHE_SIZE = 4_000;
const BLOCKED_TAGS = new Set(['SCRIPT', 'STYLE', 'NOSCRIPT', 'TEMPLATE']);

type CompiledRuleVariant = {
  rule: KeywordRule;
  normalizedNeedle: string;
  signalType: KeywordRule['signalType'];
  needsWordBoundary: boolean;
};

type BatchSource = 'initial' | 'mutation';

type AnalyzeResult = {
  payload: AnalysisPayload | null;
  truncated: boolean;
};

type MatchAccumulator = {
  rule: KeywordRule;
  normalizedValue: string;
  count: number;
};

const normalizeText = (value: string): string =>
  value
    .toLowerCase()
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .replace(/\s+/g, ' ')
    .trim();

const isBoundaryChar = (value: string | undefined): boolean =>
  !value || !/[\p{L}\p{N}_]/u.test(value);

const countOccurrences = (
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

const buildCompiledVariants = (rules: readonly KeywordRule[]): CompiledRuleVariant[] => {
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
        needsWordBoundary: rule.signalType !== 'emoji',
      });
    }
  }

  return compiled;
};

const buildZeroCategoryBreakdown = (): AnalysisPayload['occurrencesByCategory'] =>
  KEYWORD_CATEGORIES.reduce(
    (acc, category) => ({ ...acc, [category]: 0 }),
    {} as AnalysisPayload['occurrencesByCategory'],
  );

const buildZeroSeverityBreakdown = (): AnalysisPayload['occurrencesBySeverity'] =>
  RISK_LEVELS.reduce(
    (acc, severity) => ({ ...acc, [severity]: 0 }),
    {} as AnalysisPayload['occurrencesBySeverity'],
  );

const buildZeroSignalBreakdown = (): AnalysisPayload['occurrencesBySignalType'] =>
  SIGNAL_TYPES.reduce(
    (acc, signalType) => ({ ...acc, [signalType]: 0 }),
    {} as AnalysisPayload['occurrencesBySignalType'],
  );

const buildTextHash = (value: string): string => {
  let hash = 5381;
  for (let i = 0; i < value.length; i += 1) {
    hash = (hash * 33) ^ value.charCodeAt(i);
  }
  return `${hash >>> 0}`;
};

export default defineContentScript({
  matches: ['<all_urls>'],
  main() {
    const compiledVariants = buildCompiledVariants(RISK_INDICATOR_RULES);
    const seenTextHashes = new Set<string>();
    const textHashOrder: string[] = [];
    const pendingRoots = new Set<Element>();
    let mutationTimer: ReturnType<typeof setTimeout> | null = null;

    const rememberHash = (hash: string): boolean => {
      if (seenTextHashes.has(hash)) {
        return false;
      }

      seenTextHashes.add(hash);
      textHashOrder.push(hash);

      if (textHashOrder.length > MAX_HASH_CACHE_SIZE) {
        const expired = textHashOrder.shift();
        if (expired) {
          seenTextHashes.delete(expired);
        }
      }

      return true;
    };

    const analyzeNormalizedTexts = (
      normalizedTexts: readonly string[],
      nodesScanned: number,
      source: BatchSource,
    ): AnalyzeResult => {
      const startedAt = performance.now();
      let scannedChars = 0;
      let truncated = false;
      const matches = new Map<string, MatchAccumulator>();

      for (const text of normalizedTexts) {
        scannedChars += text.length;

        if (
          scannedChars > MAX_TEXT_CHARS_PER_BATCH ||
          performance.now() - startedAt > EARLY_STOP_MS
        ) {
          truncated = true;
          break;
        }

        for (const variant of compiledVariants) {
          if (performance.now() - startedAt > EARLY_STOP_MS) {
            truncated = true;
            break;
          }

          const count = countOccurrences(
            text,
            variant.normalizedNeedle,
            variant.needsWordBoundary,
          );
          if (count <= 0) {
            continue;
          }

          const existing = matches.get(variant.rule.id);
          if (existing) {
            existing.count += count;
            continue;
          }

          matches.set(variant.rule.id, {
            rule: variant.rule,
            normalizedValue: variant.normalizedNeedle,
            count,
          });
        }
      }

      const occurrencesByCategory = buildZeroCategoryBreakdown();
      const occurrencesBySeverity = buildZeroSeverityBreakdown();
      const occurrencesBySignalType = buildZeroSignalBreakdown();
      const matchedTerms: MatchedTerm[] = [];
      const severityScoreWeights: Readonly<Record<RiskLevel, number>> = {
        LOW: 1,
        MEDIUM: 4,
        HIGH: 10,
        CRITICAL: 14,
      };

      let totalScore = 0;
      for (const match of matches.values()) {
        const severityWeight = severityScoreWeights[match.rule.baseSeverity];
        const scoreContribution =
          Math.log1p(match.count) * severityWeight * match.rule.confidence;

        occurrencesByCategory[match.rule.mappedCategory] += match.count;
        occurrencesBySeverity[match.rule.baseSeverity] += match.count;
        occurrencesBySignalType[match.rule.signalType] += match.count;
        totalScore += scoreContribution;

        matchedTerms.push({
          ruleId: match.rule.id,
          signalType: match.rule.signalType,
          matchedValue: match.rule.value,
          normalizedValue: match.normalizedValue,
          category: match.rule.mappedCategory,
          severity: match.rule.baseSeverity,
          count: match.count,
          scoreContribution,
        });
      }

      totalScore += occurrencesBySeverity.HIGH * 2;
      totalScore += occurrencesBySeverity.CRITICAL * 4;

      const riskLevel: RiskLevel =
        occurrencesBySeverity.CRITICAL > 0 || totalScore >= 16
          ? 'CRITICAL'
          : totalScore >= 10 || occurrencesBySeverity.HIGH > 0
            ? 'HIGH'
            : totalScore >= 4
              ? 'MEDIUM'
              : 'LOW';

      const payload: AnalysisPayload = {
        timestamp: new Date().toISOString(),
        url: window.location.href,
        totalScore: Number(totalScore.toFixed(3)),
        riskLevel,
        riskColor: riskLevelToColor(riskLevel),
        occurrencesByCategory,
        occurrencesBySeverity,
        occurrencesBySignalType,
        matchedTerms,
        performance: {
          durationMs: Number((performance.now() - startedAt).toFixed(3)),
          truncated,
          nodesScanned,
          textCharsScanned: scannedChars,
          batchBudgetMs: ANALYSIS_BUDGET_MS,
        },
      };

      if (payload.matchedTerms.length > 0 || source === 'initial') {
        console.debug('[risk-analyzer.payload]', payload, { source });
      }

      return { payload, truncated };
    };

    const collectTextsFromElement = (root: Element): { texts: string[]; nodesScanned: number } => {
      if (BLOCKED_TAGS.has(root.tagName)) {
        return { texts: [], nodesScanned: 0 };
      }

      const texts: string[] = [];
      let nodesScanned = 0;
      const walker = document.createTreeWalker(
        root,
        NodeFilter.SHOW_TEXT,
        {
          acceptNode(node) {
            const parentElement = node.parentElement;
            if (!parentElement || BLOCKED_TAGS.has(parentElement.tagName)) {
              return NodeFilter.FILTER_REJECT;
            }

            if (!node.textContent?.trim()) {
              return NodeFilter.FILTER_REJECT;
            }

            return NodeFilter.FILTER_ACCEPT;
          },
        },
      );

      let cursor: Node | null = walker.nextNode();
      while (cursor) {
        nodesScanned += 1;
        const normalized = normalizeText(cursor.textContent ?? '');
        if (normalized) {
          texts.push(normalized);
        }
        cursor = walker.nextNode();
      }

      return { texts, nodesScanned };
    };

    const analyzeRoots = (roots: Iterable<Element>, source: BatchSource): void => {
      const normalizedTexts: string[] = [];
      let nodesScanned = 0;

      for (const root of roots) {
        const collected = collectTextsFromElement(root);
        nodesScanned += collected.nodesScanned;

        for (const text of collected.texts) {
          const hash = buildTextHash(text);
          if (!rememberHash(hash)) {
            continue;
          }
          normalizedTexts.push(text);
        }
      }

      if (normalizedTexts.length === 0) {
        return;
      }

      analyzeNormalizedTexts(normalizedTexts, nodesScanned, source);
    };

    const flushMutations = (): void => {
      if (pendingRoots.size === 0) {
        return;
      }

      const rootsToAnalyze = Array.from(pendingRoots);
      pendingRoots.clear();
      analyzeRoots(rootsToAnalyze, 'mutation');
    };

    const scheduleMutationFlush = (): void => {
      if (mutationTimer !== null) {
        clearTimeout(mutationTimer);
      }

      mutationTimer = setTimeout(() => {
        flushMutations();
      }, DEBOUNCE_MS);
    };

    const scanInitialDocument = (): void => {
      const target = document.body;
      if (!target) {
        return;
      }

      const walker = document.createTreeWalker(
        target,
        NodeFilter.SHOW_TEXT,
        {
          acceptNode(node) {
            const parentElement = node.parentElement;
            if (!parentElement || BLOCKED_TAGS.has(parentElement.tagName)) {
              return NodeFilter.FILTER_REJECT;
            }

            if (!node.textContent?.trim()) {
              return NodeFilter.FILTER_REJECT;
            }

            return NodeFilter.FILTER_ACCEPT;
          },
        },
      );

      const runChunk = (): void => {
        const chunkStartedAt = performance.now();
        const chunkTexts: string[] = [];
        let nodesScanned = 0;
        let completed = false;

        while (!completed) {
          const node = walker.nextNode();
          if (!node) {
            completed = true;
            break;
          }

          nodesScanned += 1;
          const normalized = normalizeText(node.textContent ?? '');
          if (!normalized) {
            continue;
          }

          const hash = buildTextHash(normalized);
          if (rememberHash(hash)) {
            chunkTexts.push(normalized);
          }

          if (
            nodesScanned >= INITIAL_SCAN_MAX_TEXT_NODES_PER_CHUNK ||
            performance.now() - chunkStartedAt > EARLY_STOP_MS
          ) {
            break;
          }
        }

        if (chunkTexts.length > 0) {
          analyzeNormalizedTexts(chunkTexts, nodesScanned, 'initial');
        }

        if (!completed) {
          setTimeout(runChunk, 0);
        }
      };

      runChunk();
    };

    const observer = new MutationObserver((mutations) => {
      for (const mutation of mutations) {
        for (const node of mutation.addedNodes) {
          if (node.nodeType === Node.TEXT_NODE) {
            if (node.parentElement) {
              pendingRoots.add(node.parentElement);
            }
            continue;
          }

          if (node.nodeType === Node.ELEMENT_NODE) {
            pendingRoots.add(node as Element);
          }
        }
      }

      scheduleMutationFlush();
    });

    const target = document.body;
    if (!target) {
      return;
    }

    scanInitialDocument();
    observer.observe(target, {
      childList: true,
      subtree: true,
    });
  },
});
