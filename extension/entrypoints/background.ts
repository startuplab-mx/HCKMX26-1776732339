import {
  ESCALATION_MESSAGE_TYPE,
  type EscalationAck,
  type EscalationBackendRequest,
  type EscalationMessage,
} from '@shared';
import {
  isEscalationMessage,
  normalizeBackendUrl,
  shouldCaptureScreenshot,
} from '../utils/background-helpers';

const BACKEND_ANALYZE_PATH = '/analyze';
const SCREENSHOT_QUALITY = 60;
const SCREENSHOT_MIN_SCORE = 10;
const ENABLE_BACKEND_NUDGE = import.meta.env.VITE_ENABLE_BACKEND_NUDGE === 'true';
type RuntimeMessageListener = Parameters<
  typeof browser.runtime.onMessage.addListener
>[0];
type MessageSender = Parameters<RuntimeMessageListener>[1];

const maybeCaptureScreenshot = async (
  sender: MessageSender,
): Promise<string | undefined> => {
  const windowId = sender.tab?.windowId;
  if (windowId === undefined) {
    return undefined;
  }

  try {
    const screenshotDataUrl = await browser.tabs.captureVisibleTab(windowId, {
      format: 'jpeg',
      quality: SCREENSHOT_QUALITY,
    });
    console.debug('[escalation.capture.success]', {
      tabId: sender.tab?.id,
      screenshotSize: screenshotDataUrl.length,
    });
    return screenshotDataUrl;
  } catch (error: unknown) {
    console.warn('[escalation.capture.failed]', {
      tabId: sender.tab?.id,
      error: error instanceof Error ? error.message : String(error),
    });
    return undefined;
  }
};

const sendEscalationToBackend = async (
  message: EscalationMessage,
  sender: MessageSender,
): Promise<EscalationAck> => {
  console.log('[escalation.receive]', {
    tabId: sender.tab?.id,
    source: message.source,
    fingerprint: message.fingerprint,
    riskLevel: message.payload.riskLevel,
    totalScore: message.payload.totalScore,
  });

  const backendUrl = normalizeBackendUrl("https://amusing-contentment-production-4473.up.railway.app");
  if (!backendUrl) {
    console.warn('[escalation.config.missing]', {
      key: 'VITE_BACKEND_URL',
    });
    return {
      ok: false,
      error: 'VITE_BACKEND_URL is not configured',
    };
  }

  const captureScreenshot = shouldCaptureScreenshot(message, SCREENSHOT_MIN_SCORE);
  console.debug('[escalation.capture.decision]', {
    fingerprint: message.fingerprint,
    captureScreenshot,
  });
  const screenshotDataUrl = captureScreenshot
    ? await maybeCaptureScreenshot(sender)
    : undefined;

  const requestBody: EscalationBackendRequest = {
    payload: message.payload,
    source: message.source,
    fingerprint: message.fingerprint,
    pageUrl: message.pageUrl,
    screenshotDataUrl,
  };

  try {
    // Background is the only place that performs outbound API calls from the extension.
    console.log('[escalation.request.start]', {
      endpoint: `${backendUrl}${BACKEND_ANALYZE_PATH}`,
      fingerprint: message.fingerprint,
      hasScreenshot: Boolean(screenshotDataUrl),
    });
    const response = await fetch(`${backendUrl}${BACKEND_ANALYZE_PATH}`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
      },
      body: JSON.stringify(requestBody),
    });
    console.log('[escalation.request.finish]', {
      fingerprint: message.fingerprint,
      status: response.status,
      ok: response.ok,
    });

    if (!response.ok) {
      const responseBody = await response.text().catch(() => '');
      return {
        ok: false,
        status: response.status,
        error:
          responseBody.slice(0, 180) || `Backend returned ${response.status}`,
      };
    }

    const responseJson = (await response.json().catch(() => null)) as
      | Partial<EscalationAck>
      | null;

    const ack: EscalationAck = {
      ok: true,
      status: response.status,
      traceId: typeof responseJson?.traceId === 'string' ? responseJson.traceId : undefined,
      pipelineVersion:
        typeof responseJson?.pipelineVersion === 'string'
          ? responseJson.pipelineVersion
          : undefined,
      analysis: ENABLE_BACKEND_NUDGE ? responseJson?.analysis : undefined,
    };

    if (ENABLE_BACKEND_NUDGE && ack.analysis?.nudge) {
      console.info('[escalation.nudge.received]', {
        fingerprint: message.fingerprint,
        category: ack.analysis.category,
        severity: ack.analysis.severity,
        traceId: ack.traceId,
      });
    }

    return ack;
  } catch (error: unknown) {
    console.error('[escalation.request.error]', {
      fingerprint: message.fingerprint,
      error: error instanceof Error ? error.message : String(error),
    });
    return {
      ok: false,
      error: error instanceof Error ? error.message : String(error),
    };
  }
};

type SeverityKey = 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';

type DashboardState = {
  todayOccurrences: number;
  weekOccurrences: number;
  avgPerDay: number;
  onlineMinutesToday: number;
  limitHours: number;
  activeAlerts: number;
  needReview: number;
  occurrencesBySeverity: Record<SeverityKey, number>;
  recentAlerts: Array<{ ts: string; url: string; risk: SeverityKey; totalScore: number }>;
  recentSites: Array<{ host: string; count: number }>;
  recentUsers: Array<{ label: string; count: number }>;
  // internal
  _daily: Record<string, number>;
  _sites: Record<string, number>;
};

const DASHBOARD_KEY = 'lumihover.dashboard.v1';

const isoDate = (d = new Date()): string => d.toISOString().slice(0, 10);

const last7Days = (): string[] => {
  const days: string[] = [];
  const now = new Date();
  for (let i = 0; i < 7; i += 1) {
    const d = new Date(now);
    d.setDate(now.getDate() - i);
    days.push(isoDate(d));
  }
  return days;
};

const defaultDashboardState = (): DashboardState => ({
  todayOccurrences: 0,
  weekOccurrences: 0,
  avgPerDay: 0,
  onlineMinutesToday: 0,
  limitHours: 2,
  activeAlerts: 0,
  needReview: 0,
  occurrencesBySeverity: { LOW: 0, MEDIUM: 0, HIGH: 0, CRITICAL: 0 },
  recentAlerts: [],
  recentSites: [],
  recentUsers: [],
  _daily: {},
  _sites: {},
});

const updateDashboardFromEscalation = async (message: EscalationMessage): Promise<void> => {
  const stored = await browser.storage.local.get(DASHBOARD_KEY);
  const state: DashboardState = (stored[DASHBOARD_KEY] as DashboardState) ?? defaultDashboardState();

  const dayKey = isoDate(new Date(message.payload.timestamp));
  state._daily[dayKey] = (state._daily[dayKey] ?? 0) + 1;

  const url = message.payload.url || message.pageUrl;
  let host = '';
  try {
    host = new URL(url).host;
  } catch {
    host = url.slice(0, 80);
  }
  if (host) {
    state._sites[host] = (state._sites[host] ?? 0) + 1;
  }

  const risk = message.payload.riskLevel as SeverityKey;
  if (risk in state.occurrencesBySeverity) {
    state.occurrencesBySeverity[risk] += 1;
  }

  // Recent alerts list (keep only 20)
  state.recentAlerts.unshift({
    ts: message.payload.timestamp,
    url,
    risk,
    totalScore: message.payload.totalScore,
  });
  state.recentAlerts = state.recentAlerts.slice(0, 20);

  // Derived KPIs
  const todayKey = isoDate();
  state.todayOccurrences = state._daily[todayKey] ?? 0;

  const weekKeys = last7Days();
  state.weekOccurrences = weekKeys.reduce((acc, k) => acc + (state._daily[k] ?? 0), 0);
  state.avgPerDay = Math.round(state.weekOccurrences / 7);

  state.activeAlerts = state.recentAlerts.filter((a) => a.risk === 'HIGH' || a.risk === 'CRITICAL').length;
  state.needReview = state.recentAlerts.filter((a) => a.risk === 'MEDIUM' || a.risk === 'HIGH' || a.risk === 'CRITICAL').length;

  // Recent sites (top counts)
  state.recentSites = Object.entries(state._sites)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 12)
    .map(([h, c]) => ({ host: h, count: c }));

  // v0 placeholder from keywords (top matched terms shown as "users")
  // This is intentionally rough until we add real "interaction" extraction.
  const topTerms = message.payload.matchedTerms
    .slice()
    .sort((a, b) => b.count - a.count)
    .slice(0, 5)
    .map((t) => t.matchedValue);
  if (topTerms.length) {
    const merged = new Map(state.recentUsers.map((u) => [u.label, u.count]));
    for (const term of topTerms) {
      merged.set(term, (merged.get(term) ?? 0) + 1);
    }
    state.recentUsers = Array.from(merged.entries())
      .sort((a, b) => b[1] - a[1])
      .slice(0, 12)
      .map(([label, count]) => ({ label, count }));
  }

  await browser.storage.local.set({ [DASHBOARD_KEY]: state });
};

export default defineBackground(() => {
  console.log('Background ready', { id: browser.runtime.id });

  browser.runtime.onMessage.addListener((message: unknown, sender) => {
    if (!isEscalationMessage(message, ESCALATION_MESSAGE_TYPE)) {
      return undefined;
    }

    void updateDashboardFromEscalation(message);
    return sendEscalationToBackend(message, sender);
  });
});
