import type {
  AnalysisCategory,
  EscalationBackendRequest,
  RiskLevel,
} from '@emmanuelbalderasb/shared-types';

type ClassificationResult = {
  category: AnalysisCategory;
  severity: RiskLevel;
  confidence: number;
  nudge: string;
  usedFallback: boolean;
};

const OPENROUTER_URL = 'https://openrouter.ai/api/v1/chat/completions';
const DEFAULT_MODEL = 'openai/gpt-4o-mini';
const PROVIDER_TIMEOUT_MS = 3_000;

const fallbackCategoryByRiskLevel: Record<RiskLevel, AnalysisCategory> = {
  LOW: 'safe',
  MEDIUM: 'other',
  HIGH: 'threat',
  CRITICAL: 'threat',
};

const fallbackNudgesByRiskLevel: Record<RiskLevel, string> = {
  LOW: 'Todo bien por ahora. Si algo te incomoda, habla con una persona de confianza.',
  MEDIUM: 'Ten cuidado y evita compartir datos personales. Pide ayuda si algo se siente raro.',
  HIGH: 'Esto puede ser riesgoso. Pausa la conversacion y consulta con un adulto de confianza.',
  CRITICAL: 'Riesgo alto detectado. Deten la interaccion y busca ayuda inmediata de un adulto de confianza.',
};

const fallbackCategoryFor = (riskLevel: RiskLevel): AnalysisCategory =>
  fallbackCategoryByRiskLevel[riskLevel] ?? 'other';

const fallbackNudgeFor = (riskLevel: RiskLevel): string =>
  fallbackNudgesByRiskLevel[riskLevel] ??
  'Se detecto una situacion sensible. Habla con una persona adulta de confianza.';

const buildFallbackClassification = (request: EscalationBackendRequest): ClassificationResult => ({
  category: fallbackCategoryFor(request.payload.riskLevel),
  severity: request.payload.riskLevel,
  confidence: 0.5,
  nudge: fallbackNudgeFor(request.payload.riskLevel),
  usedFallback: true,
});

const parseModelResponse = (text: string, request: EscalationBackendRequest): ClassificationResult => {
  try {
    const parsed = JSON.parse(text) as Partial<ClassificationResult>;
    if (!parsed.nudge || typeof parsed.nudge !== 'string') {
      return buildFallbackClassification(request);
    }

    const category = parsed.category ?? fallbackCategoryFor(request.payload.riskLevel);
    const confidenceRaw =
      typeof parsed.confidence === 'number' && Number.isFinite(parsed.confidence)
        ? parsed.confidence
        : 0.7;

    return {
      category,
      severity: parsed.severity ?? request.payload.riskLevel,
      confidence: Math.max(0, Math.min(1, confidenceRaw)),
      nudge: parsed.nudge.trim().slice(0, 300),
      usedFallback: false,
    };
  } catch {
    return buildFallbackClassification(request);
  }
};

const buildPrompt = (request: EscalationBackendRequest): string => {
  return [
    'You are a child-safety backend classifier.',
    'Output strict JSON only with keys: category, severity, confidence, nudge.',
    'Nudge should be one short sentence in Spanish, supportive and actionable.',
    `Risk level: ${request.payload.riskLevel}`,
    `Total score: ${request.payload.totalScore}`,
    `Matched terms: ${request.payload.matchedTerms.map((item) => item.matchedValue).join(', ')}`,
  ].join('\n');
};

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

export const classifyIntervention = async (
  request: EscalationBackendRequest,
): Promise<ClassificationResult> => {
  const apiKey = Bun.env.OPENROUTER_API_KEY;
  const model = Bun.env.LLM_MODEL ?? DEFAULT_MODEL;
  if (!apiKey) {
    return buildFallbackClassification(request);
  }

  try {
    const response = await fetchWithTimeout(
      OPENROUTER_URL,
      {
        method: 'POST',
        headers: {
          authorization: `Bearer ${apiKey}`,
          'content-type': 'application/json',
        },
        body: JSON.stringify({
          model,
          temperature: 0.2,
          response_format: { type: 'json_object' },
          messages: [
            {
              role: 'user',
              content: buildPrompt(request),
            },
          ],
        }),
      },
      PROVIDER_TIMEOUT_MS,
    );

    if (!response.ok) {
      return buildFallbackClassification(request);
    }

    const data = (await response.json()) as {
      choices?: Array<{ message?: { content?: string } }>;
    };
    const content = data.choices?.[0]?.message?.content;
    if (!content) {
      return buildFallbackClassification(request);
    }

    return parseModelResponse(content, request);
  } catch {
    return buildFallbackClassification(request);
  }
};
