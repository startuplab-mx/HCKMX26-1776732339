import { describe, expect, test } from 'bun:test';
import { summarizeScreenshot } from './vision.ts';

describe('summarizeScreenshot', () => {
  test('returns empty result when screenshot is absent', async () => {
    const result = await summarizeScreenshot(undefined);
    expect(result.summary).toBeUndefined();
    expect(result.timedOut).toBe(false);
  });

  test('rejects non-image data URL payloads', async () => {
    const result = await summarizeScreenshot('data:text/plain;base64,aaaa');
    expect(result.summary).toBeUndefined();
    expect(result.timedOut).toBe(false);
  });
});
