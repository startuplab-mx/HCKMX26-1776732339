import { describe, expect, test } from 'bun:test';
import { DedupeService } from './dedupe.ts';

describe('DedupeService', () => {
  test('marks repeated fingerprint as duplicate during ttl', () => {
    const service = new DedupeService(1000);
    const now = Date.now();
    expect(service.isDuplicate('fp-1', now)).toBe(false);
    expect(service.isDuplicate('fp-1', now + 500)).toBe(true);
    expect(service.isDuplicate('fp-1', now + 1001)).toBe(false);
  });
});
