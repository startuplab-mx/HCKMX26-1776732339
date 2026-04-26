import {
  ESCALATION_MESSAGE_TYPE,
  type AnalysisSource,
  type EscalationAck,
  type EscalationMessage,
  type AnalysisPayload,
  type KeywordRule,
  type MatchedTerm,
  type RiskLevel,
  RISK_INDICATOR_RULES,
  riskLevelToColor,
} from '@shared';
import {
  buildCompiledVariants,
  buildEscalationFingerprint,
  buildTextHash,
  buildZeroCategoryBreakdown,
  buildZeroSeverityBreakdown,
  buildZeroSignalBreakdown,
  countOccurrences,
  normalizeText,
} from '../utils/content-helpers';

const LUMI_OVERLAY_ID = 'lumihover-overlay-root';
const RISK_OVERLAY_ID = 'lumihover-risk-overlay-root';

const HERO_IDLE_GIF_PATH = '/gifs/hero-idle.gif' as const;
const HERO_HOVER_GIF_PATH = '/gifs/hero-hover.gif' as const;

const RISK_MEDIUM_GIF_PATH = '/gifs/risk-medium.gif' as const;
const RISK_HIGH_GIF_PATH = '/gifs/risk-high.gif' as const;

const RISK_OVERLAY_MIN_INTERVAL_MS = 8_000;
let lastRiskOverlayAt = 0;

const showRiskOverlay = (riskLevel: RiskLevel): void => {
  if (riskLevel !== 'MEDIUM' && riskLevel !== 'HIGH') {
    return;
  }

  const now = Date.now();
  if (now - lastRiskOverlayAt < RISK_OVERLAY_MIN_INTERVAL_MS) {
    return;
  }
  lastRiskOverlayAt = now;

  const existing = document.getElementById(RISK_OVERLAY_ID);
  existing?.remove();

  const root = document.createElement('div');
  root.id = RISK_OVERLAY_ID;
  root.style.position = 'fixed';
  root.style.inset = '0';
  root.style.display = 'grid';
  root.style.placeItems = 'center';
  root.style.pointerEvents = 'none';
  root.style.zIndex = '2147483647';

  const img = document.createElement('img');
  img.alt = riskLevel === 'HIGH' ? 'High risk' : 'Medium risk';
  img.style.width = '260px';
  img.style.height = 'auto';
  img.style.display = 'block';

  const srcPath = riskLevel === 'HIGH' ? RISK_HIGH_GIF_PATH : RISK_MEDIUM_GIF_PATH;
  // WXT types `getURL` to only accept known public paths.
  // We keep paths centralized above and cast here.
  img.src = browser.runtime.getURL(srcPath as any);

  root.appendChild(img);
  document.documentElement.appendChild(root);

  // Grow + fade, then remove
  const anim = img.animate(
    [
      { transform: 'scale(0.65)', opacity: 0 },
      { transform: 'scale(1.15)', opacity: 1, offset: 0.55 },
      { transform: 'scale(1.0)', opacity: 1 },
    ],
    { duration: 900, easing: 'cubic-bezier(0.2, 0.9, 0.2, 1)', fill: 'forwards' },
  );

  anim.addEventListener('finish', () => {
    window.setTimeout(() => root.remove(), 1400);
  });
};

/**
 * Mounts a floating "LumiHover" iframe in the bottom-right corner of the page.
 * The iframe toggles between still/animated assets on hover and runs a subtle bounce.
 */
const mountLumiOverlay = (): void => {
  if (document.getElementById(LUMI_OVERLAY_ID)) {
    return;
  }

  const root = document.createElement('div');
  root.id = LUMI_OVERLAY_ID;
  root.style.position = 'fixed';
  // Very tight to the viewport edge (outside the extension popup)
  root.style.right = '4px';
  root.style.bottom = '4px';
  root.style.zIndex = '2147483647';
  root.style.pointerEvents = 'none';

  const hero = document.createElement('img');
  hero.alt = 'LumiHover';
  hero.style.width = '220px';
  hero.style.height = 'auto';
  hero.style.pointerEvents = 'auto';
  hero.style.userSelect = 'none';
  hero.style.webkitUserSelect = 'none';
  hero.style.cursor = 'pointer';
  hero.style.display = 'block';

  // Hover bounce (CSS-like) using WAAPI so we don't need to inject styles.
  const bounce = () =>
    hero.animate(
      [
        { transform: 'translateY(0px)' },
        { transform: 'translateY(-8px)' },
        { transform: 'translateY(0px)' },
      ],
      { duration: 650, easing: 'ease-in-out', iterations: Infinity },
    );

  let hoverAnimation: Animation | null = null;
  const idleUrl = browser.runtime.getURL(HERO_IDLE_GIF_PATH as any);
  const hoverUrl = browser.runtime.getURL(HERO_HOVER_GIF_PATH as any);

  hero.src = idleUrl;

  hero.addEventListener('mouseenter', () => {
    hero.src = hoverUrl;
    hoverAnimation = bounce();
  });

  hero.addEventListener('mouseleave', () => {
    hoverAnimation?.cancel();
    hoverAnimation = null;
    hero.src = idleUrl;
  });

  root.appendChild(hero);
  document.documentElement.appendChild(root);
};

// Analysis settings
const ANALYSIS_BUDGET_MS = 80;
const EARLY_STOP_MS = 60;
const DEBOUNCE_MS = 180;
const INITIAL_SCAN_MAX_TEXT_NODES_PER_CHUNK = 150;
const MAX_TEXT_CHARS_PER_BATCH = 14_000;
const MAX_HASH_CACHE_SIZE = 4_000;
const MAX_ESCALATION_CACHE_SIZE = 400;
const ESCALATION_MIN_INTERVAL_MS = 15_000;
const BLOCKED_TAGS = new Set(['SCRIPT', 'STYLE', 'NOSCRIPT', 'TEMPLATE']);
const ESCALATION_LEVELS = new Set<RiskLevel>(['MEDIUM', 'HIGH', 'CRITICAL']);

// Analysis types
type BatchSource = AnalysisSource;

type AnalyzeResult = {
  payload: AnalysisPayload | null;
  truncated: boolean;
};

type MatchAccumulator = {
  rule: KeywordRule;
  normalizedValue: string;
  count: number;
};

export default defineContentScript({
  matches: ['<all_urls>'],
  /**
   * Initializes page scanning and mutation monitoring for risk signals.
   * Work is chunked/debounced to keep page impact low on dynamic sites.
   */
  main() {
    console.log('[risk-analyzer.init]', { url: window.location.href });
    mountLumiOverlay();
    const compiledVariants = buildCompiledVariants(RISK_INDICATOR_RULES);
    const seenTextHashes = new Set<string>();
    const textHashOrder: string[] = [];
    const pendingRoots = new Set<Element>();
    const escalationTimestamps = new Map<string, number>();
    const escalationOrder: string[] = [];
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
          // Hard cap prevents long batches from monopolizing the main thread.
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

      // Severity is based on both weighted score and explicit high-severity hits.
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
      console.debug('[risk-analyzer.summary]', {
        source,
        nodesScanned,
        matchedTerms: payload.matchedTerms.length,
        totalScore: payload.totalScore,
        riskLevel: payload.riskLevel,
        truncated,
      });

      showRiskOverlay(riskLevel);
      maybeEscalate(payload, source);

      return { payload, truncated };
    };

    const rememberEscalation = (fingerprint: string, now: number): void => {
      escalationTimestamps.set(fingerprint, now);
      escalationOrder.push(fingerprint);

      if (escalationOrder.length > MAX_ESCALATION_CACHE_SIZE) {
        const oldest = escalationOrder.shift();
        if (oldest) {
          escalationTimestamps.delete(oldest);
        }
      }
    };

    const shouldEscalate = (payload: AnalysisPayload): boolean =>
      payload.matchedTerms.length > 0 &&
      ESCALATION_LEVELS.has(payload.riskLevel);

    /**
     * Sends high-signal findings to the extension runtime.
     * Repeated near-identical escalations are throttled by a stable fingerprint.
     */
    const maybeEscalate = (
      payload: AnalysisPayload,
      source: BatchSource,
    ): void => {
      if (!shouldEscalate(payload)) {
        return;
      }

      const now = Date.now();
      const fingerprint = buildEscalationFingerprint(payload);
      const lastSentAt = escalationTimestamps.get(fingerprint);
      // Repeated DOM churn can produce the same signal burst; throttle by fingerprint+time window.
      if (lastSentAt && now - lastSentAt < ESCALATION_MIN_INTERVAL_MS) {
        console.debug('[risk-analyzer.escalation.throttled]', {
          source,
          fingerprint,
          elapsedMs: now - lastSentAt,
          minIntervalMs: ESCALATION_MIN_INTERVAL_MS,
        });
        return;
      }

      rememberEscalation(fingerprint, now);
      const message: EscalationMessage = {
        type: ESCALATION_MESSAGE_TYPE,
        payload,
        source,
        fingerprint,
        pageUrl: window.location.href,
      };
      console.log('[risk-analyzer.escalation.send]', {
        source,
        fingerprint,
        riskLevel: payload.riskLevel,
        totalScore: payload.totalScore,
      });

      void browser.runtime
        .sendMessage<EscalationMessage, EscalationAck>(message)
        .then((ack) => {
          console.debug('[risk-analyzer.escalation.ack]', {
            source,
            fingerprint,
            ok: Boolean(ack?.ok),
            status: ack?.status,
          });
          if (!ack?.ok) {
            // Fail-open: keep local scanning active even when escalation transport fails.
            console.debug('[risk-analyzer.escalation.failed]', {
              source,
              fingerprint,
              status: ack?.status,
              error: ack?.error ?? 'unknown escalation failure',
            });
          }
        })
        .catch((error: unknown) => {
          console.warn('[risk-analyzer.escalation.error]', {
            source,
            fingerprint,
            error: error instanceof Error ? error.message : String(error),
          });
        });
    };

    const collectTextsFromElement = (
      root: Element,
    ): { texts: string[]; nodesScanned: number } => {
      if (BLOCKED_TAGS.has(root.tagName)) {
        return { texts: [], nodesScanned: 0 };
      }

      const texts: string[] = [];
      let nodesScanned = 0;
      const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
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
      });

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

    const analyzeRoots = (
      roots: Iterable<Element>,
      source: BatchSource,
    ): void => {
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
      console.debug('[risk-analyzer.mutations.flush]', {
        rootsQueued: rootsToAnalyze.length,
      });
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

    /**
     * Performs an initial document pass in small chunks so first-load analysis
     * can start early without blocking long pages.
     */
    const scanInitialDocument = (): void => {
      const target = document.body;
      if (!target) {
        return;
      }

      const walker = document.createTreeWalker(target, NodeFilter.SHOW_TEXT, {
        acceptNode(node: Node): number {
          const parentElement = node.parentElement;
          if (!parentElement || BLOCKED_TAGS.has(parentElement.tagName)) {
            return NodeFilter.FILTER_REJECT;
          }

          if (!node.textContent?.trim()) {
            return NodeFilter.FILTER_REJECT;
          }

          return NodeFilter.FILTER_ACCEPT;
        },
      });

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
            // Yield frequently to keep UI responsive during startup scans.
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
