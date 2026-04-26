import type { EscalationMessage } from '@shared';

export const normalizeBackendUrl = (value: string | undefined): string | null => {
  if (!value) {
    return null;
  }

  return value.trim().replace(/\/+$/, '') || null;
};

export const isEscalationMessage = (
  value: unknown,
  escalationMessageType: string,
): value is EscalationMessage => {
  if (!value || typeof value !== 'object') {
    return false;
  }

  return (value as { type?: unknown }).type === escalationMessageType;
};

export const shouldCaptureScreenshot = (
  message: EscalationMessage,
  screenshotMinScore: number,
): boolean =>
  // Capture only for higher-risk events to reduce cost and avoid unnecessary image collection.
  message.payload.totalScore >= screenshotMinScore ||
  message.payload.riskLevel === 'HIGH' ||
  message.payload.riskLevel === 'CRITICAL';
