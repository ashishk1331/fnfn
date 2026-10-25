import type { HoldUpdate, KeyRef } from '../shared/hold-detector';
import { HoldDetector } from '../shared/hold-detector';
import { keyLabel, keyName } from '../shared/keycodes';
import type { InputState, InputStatus, LearnEvent } from '../shared/types';
import { EvdevSource, type EvdevStartResult, type RawKeyEvent } from './evdev';

interface InputServiceOptions {
  holdKey: KeyRef;
  thresholdMs: number;
  maxHoldMs: number;
  onHoldKeyChange?: (key: KeyRef) => void;
}

const LEARN_TIMEOUT_MS = 8_000;
const TICK_MS = 10;
const KEY_SPACE = 57;

type StatusListener = (status: InputStatus) => void;
type UpdateListener = (update: HoldUpdate) => void;
type LearnListener = (event: LearnEvent) => void;

export class InputService {
  private readonly detector: HoldDetector;
  private readonly source = new EvdevSource();
  private readonly statusListeners = new Set<StatusListener>();
  private readonly updateListeners = new Set<UpdateListener>();
  private readonly learnListeners = new Set<LearnListener>();

  private holdKey: KeyRef;
  private reading: string[] = [];
  private denied: string[] = [];
  private state: InputState = 'starting';
  private message = 'Starting input listener…';
  private learning = false;
  private simulatedHeld = false;
  private learnTimer: NodeJS.Timeout | null = null;
  private ticker: NodeJS.Timeout | null = null;

  constructor(private readonly options: InputServiceOptions) {
    this.holdKey = options.holdKey;
    this.detector = new HoldDetector({
      thresholdMs: options.thresholdMs,
      maxHoldMs: options.maxHoldMs,
    });
  }

  get status(): InputStatus {
    return {
      state: this.state,
      message: this.message,
      holdKey: this.holdKey,
      thresholdMs: this.detector.thresholdMs,
      learning: this.learning,
      reading: this.reading,
    };
  }

  onStatus(listener: StatusListener): () => void {
    this.statusListeners.add(listener);
    return () => this.statusListeners.delete(listener);
  }

  onUpdate(listener: UpdateListener): () => void {
    this.updateListeners.add(listener);
    return () => this.updateListeners.delete(listener);
  }

  onLearn(listener: LearnListener): () => void {
    this.learnListeners.add(listener);
    return () => this.learnListeners.delete(listener);
  }

  async start(): Promise<InputStatus> {
    if (process.platform !== 'linux') {
      this.state = 'unsupported';
      this.message =
        'Global key capture is wired for Linux evdev. Use the simulator on this OS until a native helper is added.';
      this.emitStatus();
      return this.status;
    }

    this.source.onKey = (event) => this.handleKey(event);
    this.source.onDeviceError = (path, error) => {
      console.warn(`[input] ${path}: ${error}`);
      this.reading = this.source.reading;
      this.denied = this.denied.filter(
        (deniedPath) => !this.reading.includes(deniedPath),
      );
      this.state = this.reading.length > 0 ? 'ready' : 'degraded';
      this.message = `Input device error on ${path}: ${error}`;
      this.emitStatus();
    };

    let result: EvdevStartResult;
    try {
      result = await this.source.start();
    } catch (error) {
      this.state = 'error';
      this.message = `Input capture failed: ${
        error instanceof Error ? error.message : String(error)
      }`;
      this.emitStatus();
      return this.status;
    }

    this.reading = result.reading;
    this.denied = result.denied;

    const keyboards = result.devices.filter((device) => device.isKeyboard);
    const fnKeyboards = result.devices.filter((device) => device.hasFn);

    if (result.reading.length > 0) {
      this.state = 'ready';
      this.message = `Listening to ${result.reading.length} input device${
        result.reading.length === 1 ? '' : 's'
      }.`;
    } else if (keyboards.length > 0) {
      this.state = 'degraded';
      this.message =
        'Keyboard devices exist but are not readable. Add your user to the input group, then log out and back in.';
    } else {
      this.state = 'error';
      this.message = 'No keyboard-like input devices found under /dev/input.';
    }

    console.info(
      `[input] state=${this.state} devices=${result.devices.length} reading=${result.reading.length} denied=${result.denied.length} fn=${fnKeyboards.length}`,
    );
    this.emitStatus();
    return this.status;
  }

  stop(): void {
    this.simulatedHeld = false;
    this.clearLearnTimer();
    this.stopTicker();
    this.detector.cancel(Date.now(), 'manual');
    this.source.stop();
  }

  setLearning(on: boolean): InputStatus {
    if (process.platform !== 'linux') {
      this.emitLearn({
        type: 'timeout',
        message:
          'Global key capture needs a native helper on this OS. Use the simulator for now.',
      });
      return this.status;
    }

    if (!on) {
      this.learning = false;
      this.simulatedHeld = false;
      this.clearLearnTimer();
      this.message = 'Key learning cancelled.';
      this.emitStatus();
      return this.status;
    }

    if (this.reading.length === 0) {
      this.learning = false;
      this.clearLearnTimer();
      this.message =
        'No readable keyboard. Add your user to the input group, then restart the app.';
      this.emitLearn({ type: 'timeout', message: this.message });
      this.emitStatus();
      return this.status;
    }

    this.simulatedHeld = false;
    this.emitUpdates(this.detector.cancel(Date.now(), 'manual'));
    this.stopTicker();

    this.learning = true;
    this.message =
      'Press the key you want to hold. Fn alone may not produce an event.';
    this.clearLearnTimer();
    this.learnTimer = setTimeout(() => {
      this.learning = false;
      this.learnTimer = null;
      this.message =
        'No key event arrived. Fn alone is often invisible; try Fn + another key, or a normal key.';
      this.emitLearn({
        type: 'timeout',
        message: this.message,
      });
      this.emitStatus();
    }, LEARN_TIMEOUT_MS);
    this.learnTimer.unref?.();

    this.emitStatus();
    return this.status;
  }

  setHoldKey(key: KeyRef): InputStatus {
    if (key.code === KEY_SPACE) {
      this.message =
        'Space is reserved for the search chord. Hold your talk key plus Space to search.';
      this.emitStatus();
      return this.status;
    }

    this.simulatedHeld = false;
    this.emitUpdates(this.detector.cancel(Date.now(), 'manual'));
    this.stopTicker();
    this.holdKey = key;
    this.learning = false;
    this.clearLearnTimer();
    this.message = `Hold key set to ${keyLabel(key.code)} (${keyName(
      key.code,
    )}).`;
    this.options.onHoldKeyChange?.(key);
    this.emitStatus();
    return this.status;
  }

  simulate(phase: 'down' | 'up'): void {
    const now = Date.now();
    const key: KeyRef = {
      code: this.holdKey.code,
      name: `Simulated ${keyLabel(this.holdKey.code)}`,
    };

    if (phase === 'down') {
      if (this.simulatedHeld || !this.detector.isIdle) {
        return;
      }

      this.simulatedHeld = true;
      const updates = this.detector.press(key, now);
      this.emitUpdates(updates);
      if (updates.length > 0) {
        this.startTicker();
      }
      return;
    }

    if (!this.simulatedHeld) {
      return;
    }

    this.simulatedHeld = false;
    const updates = this.detector.release(now);
    this.emitUpdates(updates);
    this.stopTickerIfIdle();
  }

  private handleKey(event: RawKeyEvent): void {
    if (this.learning) {
      if (event.value !== 1) {
        return;
      }

      if (event.code === KEY_SPACE) {
        this.message =
          'Space is reserved for the search chord. Press a different key.';
        this.emitStatus();
        return;
      }

      const key: KeyRef = {
        code: event.code,
        name: keyName(event.code),
      };

      this.learning = false;
      this.clearLearnTimer();
      this.message = `Learned ${keyLabel(event.code)} from ${
        event.deviceName
      }. Hold it to talk.`;
      this.holdKey = key;
      this.options.onHoldKeyChange?.(key);
      this.emitLearn({
        type: 'key',
        key,
        device: event.deviceName,
      });
      this.emitStatus();
      return;
    }

    // value 2 is an autorepeat, not a new press.
    if (event.value === 2) {
      return;
    }

    // Space only matters as half of the search chord. It must never cancel a
    // dictation, otherwise Alt+Space would discard the hold before it starts.
    if (event.code === KEY_SPACE) {
      if (event.value === 1) {
        this.detector.pressChord(event.at);
      } else {
        const updates = this.detector.releaseChord(event.at);
        this.emitUpdates(updates);
        this.stopTickerIfIdle();
      }
      return;
    }

    if (event.code === this.holdKey.code) {
      if (event.value === 1) {
        const updates = this.detector.press(
          {
            ...this.holdKey,
            device: event.deviceName,
          },
          event.at,
        );
        this.emitUpdates(updates);
        if (updates.length > 0) {
          this.startTicker();
        }
      } else {
        const updates = this.detector.release(event.at);
        this.emitUpdates(updates);
        this.stopTickerIfIdle();
      }
      return;
    }

    // Pressing another key while holding the talk key is a chord, not a
    // dictation. Cancel and discard so the user can use shortcuts normally.
    if (event.value === 1 && !this.detector.isIdle) {
      const updates = this.detector.cancel(event.at, 'other-key');
      this.emitUpdates(updates);
      this.stopTickerIfIdle();
    }
  }

  private startTicker(): void {
    if (this.ticker) {
      return;
    }

    this.ticker = setInterval(() => {
      const updates = this.detector.tick(Date.now());
      this.emitUpdates(updates);
      this.stopTickerIfIdle();
    }, TICK_MS);
    this.ticker.unref?.();
  }

  private stopTickerIfIdle(): void {
    if (!this.detector.isIdle || !this.ticker) {
      return;
    }

    clearInterval(this.ticker);
    this.ticker = null;
  }

  private stopTicker(): void {
    if (!this.ticker) {
      return;
    }

    clearInterval(this.ticker);
    this.ticker = null;
  }

  private clearLearnTimer(): void {
    if (!this.learnTimer) {
      return;
    }

    clearTimeout(this.learnTimer);
    this.learnTimer = null;
  }

  private emitStatus(): void {
    const status = this.status;
    for (const listener of this.statusListeners) {
      listener(status);
    }
  }

  private emitUpdates(updates: HoldUpdate[]): void {
    if (updates.length === 0) {
      return;
    }

    for (const update of updates) {
      for (const listener of this.updateListeners) {
        listener(update);
      }
    }
  }

  private emitLearn(event: LearnEvent): void {
    for (const listener of this.learnListeners) {
      listener(event);
    }
  }
}
