const DEFAULT_DEDUPE_TTL_MS = 15_000;

export class DedupeService {
  private readonly fingerprintExpiries = new Map<string, number>();

  constructor(private readonly ttlMs: number = DEFAULT_DEDUPE_TTL_MS) {}

  isDuplicate(fingerprint: string, nowMs: number = Date.now()): boolean {
    const expiry = this.fingerprintExpiries.get(fingerprint);
    if (expiry && expiry > nowMs) {
      return true;
    }

    this.fingerprintExpiries.set(fingerprint, nowMs + this.ttlMs);
    this.cleanup(nowMs);
    return false;
  }

  private cleanup(nowMs: number): void {
    if (this.fingerprintExpiries.size < 5_000) {
      return;
    }

    for (const [fingerprint, expiry] of this.fingerprintExpiries.entries()) {
      if (expiry <= nowMs) {
        this.fingerprintExpiries.delete(fingerprint);
      }
    }
  }
}

export const dedupeService = new DedupeService();
