/**
 * Transport-agnostic push-to-talk state machine.
 *
 * Feed it key down/up timestamps plus a periodic tick, get hold updates back.
 * Keeping this pure means the tricky part (timing, repeat filtering, cancel
 * semantics) is unit-testable without a keyboard, Electron, or a microphone.
 */

export interface KeyRef {
  code: number;
  name: string;
  device?: string;
}

type HoldPhase = 'idle' | 'pending' | 'active';

export type HoldReason = 'release' | 'max-duration';

export type CancelReason = 'other-key' | 'manual';

export type HoldUpdate =
  | {
      type: 'pending';
      at: number;
      key: KeyRef;
    }
  | {
      type: 'start';
      at: number;
      key: KeyRef;
      pressedAt: number;
      heldMs: number;
    }
  | {
      type: 'end';
      at: number;
      key: KeyRef;
      pressedAt: number;
      heldMs: number;
      /** True when the hold reached the threshold and should be transcribed. */
      qualified: boolean;
      reason: HoldReason;
    }
  | {
      type: 'cancel';
      at: number;
      key: KeyRef;
      heldMs: number;
      reason: CancelReason;
    };

export interface HoldDetectorOptions {
  /** How long the key must stay down before it counts as a hold. */
  thresholdMs?: number;
  /** Safety stop so a stuck key cannot record forever. */
  maxHoldMs?: number;
}

const DEFAULT_THRESHOLD_MS = 250;
const DEFAULT_MAX_HOLD_MS = 120_000;

export class HoldDetector {
  readonly thresholdMs: number;
  readonly maxHoldMs: number;

  private phase: HoldPhase = 'idle';
  private key: KeyRef | null = null;
  private pressedAt = 0;

  constructor(options: HoldDetectorOptions = {}) {
    const threshold = options.thresholdMs ?? DEFAULT_THRESHOLD_MS;
    const max = options.maxHoldMs ?? DEFAULT_MAX_HOLD_MS;

    if (!Number.isFinite(threshold) || threshold < 0) {
      throw new Error('thresholdMs must be a finite number >= 0');
    }
    if (!Number.isFinite(max) || max <= threshold) {
      throw new Error(
        'maxHoldMs must be a finite number greater than thresholdMs',
      );
    }

    this.thresholdMs = threshold;
    this.maxHoldMs = max;
  }

  get isIdle(): boolean {
    return this.phase === 'idle';
  }

  /**
   * A key went down. Repeats and extra keys while a hold is already in flight
   * are ignored here; the input service decides whether an extra key cancels.
   */
  press(key: KeyRef, at: number): HoldUpdate[] {
    if (this.phase !== 'idle') {
      return [];
    }

    this.phase = 'pending';
    this.key = key;
    this.pressedAt = at;

    return [{ type: 'pending', at, key }];
  }

  /** Call on a short interval while a press is pending or active. */
  tick(at: number): HoldUpdate[] {
    if (!this.key) {
      return [];
    }

    const heldMs = at - this.pressedAt;

    if (this.phase === 'pending' && heldMs >= this.thresholdMs) {
      this.phase = 'active';
      return [
        {
          type: 'start',
          at,
          key: this.key,
          pressedAt: this.pressedAt,
          heldMs,
        },
      ];
    }

    if (this.phase === 'active' && heldMs >= this.maxHoldMs) {
      return this.finish(at, 'max-duration', true);
    }

    return [];
  }

  /**
   * The key came back up. If the ticker missed the exact threshold (for
   * example the key was released between two ticks), synthesize the start
   * event when the elapsed time still qualifies, then end the hold.
   */
  release(at: number): HoldUpdate[] {
    if (!this.key) {
      return [];
    }

    const heldMs = at - this.pressedAt;
    const updates: HoldUpdate[] = [];

    if (this.phase === 'pending' && heldMs >= this.thresholdMs) {
      this.phase = 'active';
      updates.push({
        type: 'start',
        at: this.pressedAt + this.thresholdMs,
        key: this.key,
        pressedAt: this.pressedAt,
        heldMs: this.thresholdMs,
      });
    }

    updates.push(...this.finish(at, 'release', this.phase === 'active'));
    return updates;
  }

  /** Discard a press or hold without producing a transcript. */
  cancel(at: number, reason: CancelReason = 'manual'): HoldUpdate[] {
    if (!this.key) {
      return [];
    }

    const key = this.key;
    const heldMs = Math.max(0, at - this.pressedAt);
    this.reset();

    return [{ type: 'cancel', at, key, heldMs, reason }];
  }

  private finish(
    at: number,
    reason: HoldReason,
    qualified: boolean,
  ): HoldUpdate[] {
    if (!this.key) {
      return [];
    }

    const key = this.key;
    const pressedAt = this.pressedAt;
    const heldMs = Math.max(0, at - pressedAt);
    this.reset();

    return [
      {
        type: 'end',
        at,
        key,
        pressedAt,
        heldMs,
        qualified,
        reason,
      },
    ];
  }

  private reset(): void {
    this.phase = 'idle';
    this.key = null;
    this.pressedAt = 0;
  }
}
