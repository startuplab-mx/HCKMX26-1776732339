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
      screenshotDataUrl,
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

  const backendUrl = normalizeBackendUrl(import.meta.env.VITE_BACKEND_URL);
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

    return {
      ok: true,
      status: response.status,
    };
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

export default defineBackground(() => {
  console.log('Background ready', { id: browser.runtime.id });

  browser.runtime.onMessage.addListener((message: unknown, sender) => {
    if (!isEscalationMessage(message, ESCALATION_MESSAGE_TYPE)) {
      return undefined;
    }

    return sendEscalationToBackend(message, sender);
  });
});
