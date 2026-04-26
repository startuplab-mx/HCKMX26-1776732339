import { describe, expect, test } from 'bun:test';
import { handleHealthRoute } from './health.ts';

describe('handleHealthRoute', () => {
  test('returns healthy payload', async () => {
    const response = handleHealthRoute();
    const body = (await response.json()) as { ok: boolean; status?: string };
    expect(response.status).toBe(200);
    expect(body.ok).toBe(true);
    expect(body.status).toBe('healthy');
  });
});
