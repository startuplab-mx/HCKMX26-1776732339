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
const HERO_DRAG_GIF_PATH = '/gifs/dancinLUMI.gif' as const;
const HERO_ROT_GIF_PATH = '/gifs/rotLUMI.gif' as const;
const HERO_ROT_REVERSE_GIF_PATH = '/gifs/rotREVERSE.gif' as const;
const HERO_TALK_GREEN_GIF_PATH = '/gifs/talkGREEN.gif' as const;
const HERO_TALK_ORANGE_GIF_PATH = '/gifs/talkORANGE.gif' as const;
const HERO_TALK_RED_GIF_PATH = '/gifs/talkRED.gif' as const;
const HERO_SAD_GIF_PATH = '/gifs/sadLUMI.gif' as const;
const HERO_DANCE_GIF_PATH = '/gifs/dancinLUMI.gif' as const;

const HERO_POS_STORAGE_KEY = 'lumihover.hero.pos.v1';

const RISK_MEDIUM_GIF_PATH = '/gifs/risk-medium.gif' as const;
const RISK_HIGH_GIF_PATH = '/gifs/risk-high.gif' as const;

let onRiskSignal: ((payload: AnalysisPayload) => void) | null = null;

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
  // Default: bottom-right, but user can drag to reposition.
  root.style.left = 'auto';
  root.style.top = 'auto';
  root.style.right = '4px';
  root.style.bottom = '80px';
  root.style.zIndex = '2147483647';
  root.style.pointerEvents = 'none';

  const heroWrap = document.createElement('div');
  heroWrap.style.display = 'block';
  heroWrap.style.width = 'fit-content';
  heroWrap.style.pointerEvents = 'auto';
  heroWrap.style.userSelect = 'none';
  (heroWrap.style as any).webkitUserSelect = 'none';
  heroWrap.style.cursor = 'pointer';
  heroWrap.style.touchAction = 'none';
  heroWrap.style.position = 'relative';

  const hero = document.createElement('img');
  hero.alt = 'LumiHover';
  hero.style.width = '90px';
  hero.style.height = 'auto';
  hero.style.display = 'block';
  hero.style.pointerEvents = 'none';

  // Hover bounce (CSS-like) using WAAPI so we don't need to inject styles.
  const bounce = () =>
    heroWrap.animate(
      [
        { transform: 'translateY(0px)' },
        { transform: 'translateY(-8px)' },
        { transform: 'translateY(0px)' },
      ],
      { duration: 650, easing: 'ease-in-out', iterations: Infinity },
    );

  let hoverAnimation: Animation | null = null;
  let rotAnimation: Animation | null = null;
  let rotSwapTimer: number | null = null;
  const idleUrl = browser.runtime.getURL(HERO_IDLE_GIF_PATH as any);
  const hoverUrl = browser.runtime.getURL(HERO_HOVER_GIF_PATH as any);
  const dragUrl = browser.runtime.getURL(HERO_DRAG_GIF_PATH as any);
  const rotUrl = browser.runtime.getURL(HERO_ROT_GIF_PATH as any);
  const rotReverseUrl = browser.runtime.getURL(HERO_ROT_REVERSE_GIF_PATH as any);
  const talkGreenUrl = browser.runtime.getURL(HERO_TALK_GREEN_GIF_PATH as any);
  const talkOrangeUrl = browser.runtime.getURL(HERO_TALK_ORANGE_GIF_PATH as any);
  const talkRedUrl = browser.runtime.getURL(HERO_TALK_RED_GIF_PATH as any);
  const sadUrl = browser.runtime.getURL(HERO_SAD_GIF_PATH as any);
  const danceUrl = browser.runtime.getURL(HERO_DANCE_GIF_PATH as any);

  hero.src = idleUrl;

  let isDragging = false;
  let interactionLocked = false;

  const nudge = document.createElement('div');
  nudge.style.position = 'absolute';
  nudge.style.right = '92px';
  nudge.style.bottom = '6px';
  nudge.style.width = '260px';
  nudge.style.maxWidth = 'min(260px, calc(100vw - 140px))';
  nudge.style.padding = '10px 10px 10px';
  nudge.style.borderRadius = '14px';
  nudge.style.border = '1px solid rgba(198, 225, 227, 0.18)';
  nudge.style.background = 'rgba(11, 11, 15, 0.92)';
  (nudge.style as any).backdropFilter = 'blur(10px)';
  nudge.style.boxShadow = '0 10px 30px rgba(0,0,0,0.35)';
  nudge.style.color = '#C6E1E3';
  nudge.style.fontFamily = 'system-ui, -apple-system, Segoe UI, Roboto, sans-serif';
  nudge.style.pointerEvents = 'auto';
  nudge.style.display = 'none';

  const nudgeTitle = document.createElement('div');
  nudgeTitle.style.fontWeight = '900';
  nudgeTitle.style.fontSize = '12px';
  nudgeTitle.style.letterSpacing = '0.08em';
  nudgeTitle.style.textTransform = 'uppercase';
  nudgeTitle.style.opacity = '0.9';

  const nudgeText = document.createElement('div');
  nudgeText.style.marginTop = '6px';
  nudgeText.style.fontSize = '13px';
  nudgeText.style.lineHeight = '1.25';

  const nudgeActions = document.createElement('div');
  nudgeActions.style.display = 'flex';
  nudgeActions.style.gap = '8px';
  nudgeActions.style.marginTop = '10px';
  nudgeActions.style.justifyContent = 'flex-end';

  const mkBtn = (label: string, variant: 'primary' | 'ghost') => {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.textContent = label;
    btn.style.fontSize = '12px';
    btn.style.fontWeight = '800';
    btn.style.borderRadius = '999px';
    btn.style.padding = '8px 10px';
    btn.style.cursor = 'pointer';
    btn.style.border = variant === 'primary' ? '1px solid rgba(236,255,192,0.35)' : '1px solid rgba(198,225,227,0.22)';
    btn.style.background = variant === 'primary' ? 'rgba(236,255,192,0.14)' : 'rgba(198,225,227,0.06)';
    btn.style.color = variant === 'primary' ? '#ECFFC0' : '#C6E1E3';
    btn.style.userSelect = 'none';
    (btn.style as any).webkitUserSelect = 'none';
    return btn;
  };

  const btnOk = mkBtn('Ok entiendo', 'primary');
  const btnIgnore = mkBtn('Ignorar', 'ghost');

  nudge.appendChild(nudgeTitle);
  nudge.appendChild(nudgeText);
  nudge.appendChild(nudgeActions);
  heroWrap.appendChild(nudge);

  const prefersReducedMotion = () =>
    typeof window.matchMedia === 'function' &&
    window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  const sleep = (ms: number) => new Promise<void>((resolve) => window.setTimeout(resolve, ms));

  const cancelRot = () => {
    if (rotSwapTimer != null) {
      window.clearTimeout(rotSwapTimer);
      rotSwapTimer = null;
    }
    rotAnimation?.cancel();
    rotAnimation = null;
  };

  const rotTransition = (bridgeSrc: string, nextSrc: string) => {
    if (prefersReducedMotion()) {
      hero.src = nextSrc;
      return;
    }

    cancelRot();

    // Use a dedicated transition GIF as a "bridge"
    // between hero states.
    const transitionMs = 77;

    hero.src = bridgeSrc;
    rotAnimation = hero.animate([{ opacity: 0.85 }, { opacity: 1 }], {
      duration: transitionMs,
      easing: 'linear',
      fill: 'both',
    });

    rotSwapTimer = window.setTimeout(() => {
      hero.src = nextSrc;
    }, transitionMs);

    rotAnimation.addEventListener('finish', () => {
      cancelRot();
    });
  };

  heroWrap.addEventListener('mouseenter', () => {
    if (isDragging || interactionLocked) return;
    rotTransition(rotUrl, hoverUrl);
    hoverAnimation = bounce();
  });

  heroWrap.addEventListener('mouseleave', () => {
    if (isDragging || interactionLocked) return;
    hoverAnimation?.cancel();
    hoverAnimation = null;
    rotTransition(rotReverseUrl, idleUrl);
  });

  // Restore saved position (if any)
  try {
    const raw = localStorage.getItem(HERO_POS_STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as { left?: number; top?: number };
      if (typeof parsed.left === 'number' && typeof parsed.top === 'number') {
        root.style.left = `${parsed.left}px`;
        root.style.top = `${parsed.top}px`;
        root.style.right = 'auto';
        root.style.bottom = 'auto';
      }
    }
  } catch {
    // ignore
  }

  // Drag to reposition (pointer events)
  heroWrap.addEventListener('pointerdown', (e) => {
    if (interactionLocked) return;
    isDragging = true;
    hoverAnimation?.cancel();
    hoverAnimation = null;
    cancelRot();
    hero.src = dragUrl;
    heroWrap.setPointerCapture(e.pointerId);

    const rect = root.getBoundingClientRect();
    const startPointerX = e.clientX;
    const startPointerY = e.clientY;
    const startLeft = rect.left;
    const startTop = rect.top;

    const onMove = (ev: PointerEvent) => {
      if (!isDragging) return;
      const dx = ev.clientX - startPointerX;
      const dy = ev.clientY - startPointerY;
      const nextLeft = Math.max(0, Math.min(window.innerWidth - rect.width, startLeft + dx));
      const nextTop = Math.max(0, Math.min(window.innerHeight - rect.height, startTop + dy));

      root.style.left = `${nextLeft}px`;
      root.style.top = `${nextTop}px`;
      root.style.right = 'auto';
      root.style.bottom = 'auto';
    };

    const onUp = (ev: PointerEvent) => {
      isDragging = false;
      heroWrap.releasePointerCapture(ev.pointerId);

      const finalRect = root.getBoundingClientRect();
      try {
        localStorage.setItem(
          HERO_POS_STORAGE_KEY,
          JSON.stringify({ left: Math.round(finalRect.left), top: Math.round(finalRect.top) }),
        );
      } catch {
        // ignore
      }

      hero.src = idleUrl;
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      window.removeEventListener('pointercancel', onUp);
    };

    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
    window.addEventListener('pointercancel', onUp);
  });

  heroWrap.appendChild(hero);
  root.appendChild(heroWrap);
  document.documentElement.appendChild(root);

  // --- Risk nudges + hero choreography ---
  const NUDGE_MIN_INTERVAL_MS = 10_000;
  let lastNudgeAt = 0;
  let sequenceId = 0;

  const hideNudge = () => {
    nudge.style.display = 'none';
    nudgeActions.replaceChildren();
  };

  const showNudge = (opts: {
    title: string;
    text: string;
    color: string;
    showIgnore: boolean;
    onOk: () => void;
    onIgnore?: () => void;
  }) => {
    nudgeTitle.textContent = opts.title;
    nudgeTitle.style.color = opts.color;
    nudgeText.textContent = opts.text;
    nudgeActions.replaceChildren();
    btnOk.onclick = opts.onOk;
    nudgeActions.appendChild(btnOk);
    if (opts.showIgnore && opts.onIgnore) {
      btnIgnore.onclick = opts.onIgnore;
      nudgeActions.appendChild(btnIgnore);
    }
    nudge.style.display = 'block';
  };

  const setHero = (src: string) => {
    cancelRot();
    hero.src = src;
  };

  const formatMatchedTerms = (payload: AnalysisPayload): string => {
    const top = [...payload.matchedTerms]
      .sort((a, b) => b.scoreContribution - a.scoreContribution)
      .slice(0, 4);

    if (top.length === 0) return '';

    const lines = top.map((t) => {
      const sev = t.severity;
      const count = t.count;
      const v = t.matchedValue;
      return `- ${v} (${sev}${typeof count === 'number' ? ` ×${count}` : ''})`;
    });

    return `\n\nSeñales detectadas:\n${lines.join('\n')}`;
  };

  const runSequence = async (payload: AnalysisPayload): Promise<void> => {
    const now = Date.now();
    if (now - lastNudgeAt < NUDGE_MIN_INTERVAL_MS) return;
    lastNudgeAt = now;

    const level: RiskLevel =
      payload.riskLevel === 'CRITICAL' ? 'CRITICAL' : payload.riskLevel;
    const terms = formatMatchedTerms(payload);

    const myId = ++sequenceId;
    interactionLocked = true;
    isDragging = false;
    hoverAnimation?.cancel();
    hoverAnimation = null;
    hideNudge();

    const bailIfStale = () => myId !== sequenceId;

    const okDanceThenIdle = async () => {
      if (bailIfStale()) return;
      hideNudge();
      setHero(danceUrl);
      await sleep(2600);
      if (bailIfStale()) return;
      setHero(idleUrl);
      interactionLocked = false;
    };

    const ignoreSadThenIdle = async () => {
      if (bailIfStale()) return;
      hideNudge();
      setHero(sadUrl);
      await sleep(6200);
      if (bailIfStale()) return;
      setHero(idleUrl);
      interactionLocked = false;
    };

    if (level === 'LOW') {
      // Bounce + talkGREEN + nudge (ok/ignore)
      hoverAnimation = bounce();
      setHero(talkGreenUrl);
      showNudge({
        title: 'LOW RISK',
        color: '#ECFFC0',
        text:
          `Detecté señales de posible riesgo o información engañosa en lo que estás viendo. Te recomiendo verificar la fuente antes de actuar.${terms}`,
        showIgnore: true,
        onOk: () => void okDanceThenIdle(),
        onIgnore: () => void ignoreSadThenIdle(),
      });
      return;
    }

    if (level === 'MEDIUM') {
      // Call attention first, then talkORANGE + nudge (ok/ignore) with action copy.
      showRiskOverlay('MEDIUM');
      await sleep(1000);
      if (bailIfStale()) return;
      hoverAnimation = bounce();
      setHero(talkOrangeUrl);
      showNudge({
        title: 'MEDIUM RISK',
        color: '#F88756',
        text:
          `Esto parece más riesgoso. Considera denunciar el contenido, bloquear al remitente y evitar compartir datos personales o pagos.${terms}`,
        showIgnore: true,
        onOk: () => void okDanceThenIdle(),
        onIgnore: () => void ignoreSadThenIdle(),
      });
      return;
    }

    // HIGH / CRITICAL
    showRiskOverlay('HIGH');
    await sleep(1050);
    if (bailIfStale()) return;
    setHero(talkRedUrl);
    showNudge({
      title: level === 'CRITICAL' ? 'CRITICAL RISK' : 'HIGH RISK',
      color: '#FF4D4D',
      text:
        `Riesgo alto detectado. Detén la interacción, no compartas información sensible y reporta/bloquea de inmediato si aplica.${terms}`,
      showIgnore: false,
      onOk: () => void okDanceThenIdle(),
    });
  };

  onRiskSignal = (payload: AnalysisPayload) => {
    if (payload.matchedTerms.length <= 0) return;
    void runSequence(payload);
  };
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

      if (riskLevel === 'MEDIUM' || riskLevel === 'HIGH') {
        showRiskOverlay(riskLevel);
      }
      // CRITICAL uses the same overlay as HIGH (but handled in the nudge flow).
      maybeEscalate(payload, source);
      onRiskSignal?.(payload);

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
