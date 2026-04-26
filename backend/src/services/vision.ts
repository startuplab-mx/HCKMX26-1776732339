type VisionSummaryResult = {
  summary?: string;
  timedOut: boolean;
};

const MAX_ACCEPTED_DATA_URL_LENGTH = 1_200_000;
const VISION_TIMEOUT_MS = 1_500;

const fetchWithTimeout = async (url: string, init: RequestInit, timeoutMs: number): Promise<Response> => {
  const controller = new AbortController();
  const timer = setTimeout(() => {
    controller.abort();
  }, timeoutMs);

  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
};

export const summarizeScreenshot = async (
  screenshotDataUrl: string | undefined,
): Promise<VisionSummaryResult> => {
  if (!screenshotDataUrl) {
    return { summary: undefined, timedOut: false };
  }

  if (!screenshotDataUrl.startsWith('data:image/')) {
    return { summary: undefined, timedOut: false };
  }

  if (screenshotDataUrl.length > MAX_ACCEPTED_DATA_URL_LENGTH) {
    return { summary: undefined, timedOut: false };
  }

  if (!Bun.env.OPENROUTER_API_KEY) {
    return { summary: 'Captura recibida para revision contextual.', timedOut: false };
  }

  try {
    const response = await fetchWithTimeout(
      'https://openrouter.ai/api/v1/chat/completions',
      {
        method: 'POST',
        headers: {
          authorization: `Bearer ${Bun.env.OPENROUTER_API_KEY}`,
          'content-type': 'application/json',
        },
        body: JSON.stringify({
          model: Bun.env.VISION_MODEL ?? Bun.env.LLM_MODEL ?? 'openai/gpt-4o-mini',
          max_tokens: 90,
          messages: [
            {
              role: 'user',
              content: [
                { type: 'text', text: 'Describe briefly any visible risk context in one sentence.' },
                { type: 'image_url', image_url: { url: screenshotDataUrl } },
              ],
            },
          ],
        }),
      },
      VISION_TIMEOUT_MS,
    );

    if (!response.ok) {
      return { summary: undefined, timedOut: false };
    }

    const data = (await response.json()) as {
      choices?: Array<{ message?: { content?: string } }>;
    };
    const summary = data.choices?.[0]?.message?.content?.trim().slice(0, 220);
    return { summary: summary || undefined, timedOut: false };
  } catch (error: unknown) {
    if (error instanceof Error && error.name === 'AbortError') {
      return { summary: undefined, timedOut: true };
    }
    return { summary: undefined, timedOut: false };
  }
};
