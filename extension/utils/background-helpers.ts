import type { EscalationMessage } from '@shared';

/**
 * Normalizes a backend URL by removing trailing slashes.
 * @param value - The backend URL to normalize.
 * @returns The normalized backend URL or null if the value is undefined.
 */
export const normalizeBackendUrl = (value: string | undefined): string | null => {
  if (!value) {
    return null;
  }

  return value.trim().replace(/\/+$/, '') || null;
};

/**
 * Checks if a value is an escalation message.
 * @param value - The value to check.
 * @param escalationMessageType - The type of escalation message to check for.
 * @returns True if the value is an escalation message, false otherwise.
 */
export const isEscalationMessage = (
  value: unknown,
  escalationMessageType: string,
): value is EscalationMessage => {
  if (!value || typeof value !== 'object') {
    return false;
  }

  return (value as { type?: unknown }).type === escalationMessageType;
};

/**
 * Checks if a screenshot should be captured for an escalation message.
 * @param message - The escalation message to check.
 * @param screenshotMinScore - The minimum score required to capture a screenshot.
 * @returns True if a screenshot should be captured, false otherwise.
 */
export const shouldCaptureScreenshot = (
  message: EscalationMessage,
  screenshotMinScore: number,
): boolean =>
  // Capture only for higher-risk events to reduce cost and avoid unnecessary image collection.
  message.payload.totalScore >= screenshotMinScore ||
  message.payload.riskLevel === 'HIGH' ||
  message.payload.riskLevel === 'CRITICAL';
