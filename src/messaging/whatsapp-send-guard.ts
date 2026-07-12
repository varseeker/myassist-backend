import { Logger } from '@nestjs/common';

export interface WhatsAppGuardConfig {
  minIntervalMs: number;
  jitterMs: number;
  perRecipientCooldownMs: number;
  maxPerHour: number;
  maxPerDay: number;
}

export type GuardDecision =
  | { allow: true; waitMs: number }
  | { allow: false; reason: string };

/**
 * Serializes WhatsApp sends and enforces spacing / caps to reduce ban risk.
 */
export class WhatsAppSendGuard {
  private readonly logger = new Logger(WhatsAppSendGuard.name);
  private chain: Promise<void> = Promise.resolve();
  private lastSendAt = 0;
  private readonly recipientLastSend = new Map<string, number>();
  private readonly hourBucket: number[] = [];
  private readonly dayBucket: number[] = [];

  constructor(private readonly config: WhatsAppGuardConfig) {}

  /** Run `fn` exclusively on the send queue after rate-limit checks. */
  enqueue<T>(
    recipientKey: string,
    fn: () => Promise<T>,
  ): Promise<{ skipped?: string; result?: T }> {
    const run = this.chain.then(async () => {
      const decision = this.evaluate(recipientKey);
      if (!decision.allow) {
        this.logger.warn(`WhatsApp skip: ${decision.reason}`);
        return { skipped: decision.reason };
      }

      if (decision.waitMs > 0) {
        this.logger.debug(`WhatsApp delay ${decision.waitMs}ms before send`);
        await sleep(decision.waitMs);
      }

      const result = await fn();
      this.markSent(recipientKey);
      return { result };
    });

    // Keep queue alive even if one send fails
    this.chain = run.then(
      () => undefined,
      () => undefined,
    );

    return run;
  }

  private evaluate(recipientKey: string): GuardDecision {
    const now = Date.now();
    this.prune(now);

    if (this.hourBucket.length >= this.config.maxPerHour) {
      return {
        allow: false,
        reason: `Batas jam terlampaui (${this.config.maxPerHour}/jam). Coba lagi nanti.`,
      };
    }

    if (this.dayBucket.length >= this.config.maxPerDay) {
      return {
        allow: false,
        reason: `Batas harian terlampaui (${this.config.maxPerDay}/hari). Coba lagi besok.`,
      };
    }

    const lastRecipient = this.recipientLastSend.get(recipientKey) ?? 0;
    const sinceRecipient = now - lastRecipient;
    if (sinceRecipient < this.config.perRecipientCooldownMs) {
      return {
        allow: false,
        reason: `Cooldown penerima aktif (${Math.ceil(
          (this.config.perRecipientCooldownMs - sinceRecipient) / 1000,
        )}s). Hindari spam ke nomor yang sama.`,
      };
    }

    const sinceLast = now - this.lastSendAt;
    const jitter =
      this.config.jitterMs > 0
        ? Math.floor(Math.random() * this.config.jitterMs)
        : 0;
    const waitMs = Math.max(0, this.config.minIntervalMs + jitter - sinceLast);

    return { allow: true, waitMs };
  }

  private markSent(recipientKey: string): void {
    const now = Date.now();
    this.lastSendAt = now;
    this.recipientLastSend.set(recipientKey, now);
    this.hourBucket.push(now);
    this.dayBucket.push(now);
  }

  private prune(now: number): void {
    const hourAgo = now - 60 * 60 * 1000;
    const dayAgo = now - 24 * 60 * 60 * 1000;
    while (this.hourBucket.length && this.hourBucket[0] < hourAgo) {
      this.hourBucket.shift();
    }
    while (this.dayBucket.length && this.dayBucket[0] < dayAgo) {
      this.dayBucket.shift();
    }
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
