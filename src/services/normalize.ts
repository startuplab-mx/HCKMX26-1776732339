import type { EscalationBackendRequest } from '@emmanuelbalderasb/shared-types';

const MAX_SCREENSHOT_DATA_URL_LENGTH = 1_200_000;

const normalizeString = (value: string): string => value.trim().slice(0, 2_048);

export const normalizeEscalationRequest = (
  request: EscalationBackendRequest,
): EscalationBackendRequest => {
  const screenshotDataUrl = request.screenshotDataUrl?.trim();

  return {
    ...request,
    fingerprint: normalizeString(request.fingerprint),
    pageUrl: normalizeString(request.pageUrl),
    source: request.source,
    screenshotDataUrl:
      screenshotDataUrl && screenshotDataUrl.length <= MAX_SCREENSHOT_DATA_URL_LENGTH
        ? screenshotDataUrl
        : undefined,
  };
};
