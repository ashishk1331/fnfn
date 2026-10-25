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

/** What the completed hold should do. */
export type HoldMode = 'dictate' | 'search';

export type HoldReason = 'release' | 'max-duration';

export type CancelReason = 'other-key' | 'manual';

export type HoldUpdate =
  | {
      type: 'pending';
      at: number;
      key: KeyRef;
    }
  | {
      type: 'mode';
      at: number;
      key: KeyRef;
      mode: 'search';
    }
  | {
      type: 'start';
      at: number;
      key: KeyRef;
      pressedAt: number;
      heldMs: number;
      mode: HoldMode;
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
      mode: HoldMode;
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
  /** How long the chord key must overlap the hold key to switch modes. */
  chordThresholdMs?: number;
}

const DEFAULT_THRESHOLD_MS = 250;
const DEFAULT_MAX_HOLD_MS = 120_000;
const DEFAULT_CHORD_THRESHOLD_MS = 250;

export class HoldDetector {
  readonly thresholdMs: number;
  readonly maxHoldMs: number;
  readonly chordThresholdMs: number;

  private phase: HoldPhase = 'idle';
  private key: KeyRef | null = null;
  private pressedAt = 0;
  private mode: HoldMode = 'dictate';
  private chordHeld = false;
  private chordPressedAt: number | null = null;

  constructor(options: HoldDetectorOptions = {}) {
    const threshold = options.thresholdMs ?? DEFAULT_THRESHOLD_MS;
    const max = options.maxHoldMs ?? DEFAULT_MAX_HOLD_MS;
    const chord = options.chordThresholdMs ?? DEFAULT_CHORD_THRESHOLD_MS;

    if (!Number.isFinite(threshold) || threshold < 0) {
      throw new Error('thresholdMs must be a finite number >= 0');
    }
    if (!Number.isFinite(max) || max <= threshold) {
      throw new Error(
        'maxHoldMs must be a finite number greater than thresholdMs',
      );
    }
    if (!Number.isFinite(chord) || chord < 0) {
      throw new Error('chordThresholdMs must be a finite number >= 0');
    }

    this.thresholdMs = threshold;
    this.maxHoldMs = max;
    this.chordThresholdMs = chord;
  }

  /** The mode the current hold will use; `search` once the chord commits. */
  get holdMode(): HoldMode {
    return this.mode;
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
    this.mode = 'dictate';
    // The chord key may already be down; require a full overlap from here.
    if (this.chordHeld) {
      this.chordPressedAt = at;
    }

    return [{ type: 'pending', at, key }];
  }

  /**
   * The chord key (Space) went down. It never starts a hold on its own; it only
   * arms the search mode while the talk key is also down.
   */
  pressChord(at: number): HoldUpdate[] {
    this.chordHeld = true;

    if (this.phase === 'idle' || this.mode === 'search') {
      return [];
    }

    if (this.chordPressedAt === null) {
      this.chordPressedAt = at;
    }

    return [];
  }

  /**
   * The chord key came back up. Releasing it before the chord matures leaves
   * the dictation untouched; releasing it afterwards ends the search hold.
   */
  releaseChord(at: number): HoldUpdate[] {
    this.chordHeld = false;

    if (this.phase === 'idle') {
      this.chordPressedAt = null;
      return [];
    }

    if (this.mode !== 'search') {
      const updates = this.settleChord(at);
      if (this.holdMode === 'search') {
        return [...updates, ...this.finish(at, 'release', true)];
      }

      this.chordPressedAt = null;
      return updates;
    }

    return this.finish(at, 'release', true);
  }

  /** Call on a short interval while a press is pending or active. */
  tick(at: number): HoldUpdate[] {
    if (!this.key) {
      return [];
    }

    const updates = this.settleChord(at);
    const heldMs = at - this.pressedAt;

    if (this.phase === 'pending' && heldMs >= this.thresholdMs) {
      this.phase = 'active';
      updates.push({
        type: 'start',
        at,
        key: this.key,
        pressedAt: this.pressedAt,
        heldMs,
        mode: this.mode,
      });
    } else if (this.phase === 'active' && heldMs >= this.maxHoldMs) {
      updates.push(...this.finish(at, 'max-duration', true));
    }

    return updates;
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

    const updates = this.settleChord(at);
    const heldMs = at - this.pressedAt;

    if (this.phase === 'pending' && heldMs >= this.thresholdMs) {
      this.phase = 'active';
      updates.push({
        type: 'start',
        at: this.pressedAt + this.thresholdMs,
        key: this.key,
        pressedAt: this.pressedAt,
        heldMs: this.thresholdMs,
        mode: this.mode,
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

  private settleChord(at: number): HoldUpdate[] {
    if (
      !this.key ||
      this.mode === 'search' ||
      this.chordPressedAt === null ||
      at - this.chordPressedAt < this.chordThresholdMs
    ) {
      return [];
    }

    this.mode = 'search';

    // A chord that matures before the normal hold threshold starts capture
    // immediately so the search recording is not delayed.
    if (this.phase === 'pending') {
      this.phase = 'active';
      return [
        {
          type: 'start',
          at,
          key: this.key,
          pressedAt: this.pressedAt,
          heldMs: Math.max(0, at - this.pressedAt),
          mode: 'search',
        },
      ];
    }

    return [{ type: 'mode', at, key: this.key, mode: 'search' }];
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
    const mode = this.mode;
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
        mode,
      },
    ];
  }

  private reset(): void {
    this.phase = 'idle';
    this.key = null;
    this.pressedAt = 0;
    this.mode = 'dictate';
    this.chordHeld = false;
    this.chordPressedAt = null;
  }
}
