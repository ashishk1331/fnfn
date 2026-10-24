import assert from 'node:assert/strict';
import test from 'node:test';

import { HoldDetector } from '../src/shared/hold-detector';

const key = { code: 100, name: 'KEY_RIGHTALT' };

test('a tap shorter than the threshold is discarded', () => {
  const detector = new HoldDetector({
    thresholdMs: 250,
    maxHoldMs: 120_000,
  });

  assert.deepEqual(detector.press(key, 1_000), [
    { type: 'pending', at: 1_000, key },
  ]);

  const updates = detector.release(1_120);
  assert.equal(updates.length, 1);

  const [end] = updates;
  assert.equal(end?.type, 'end');
  if (end?.type !== 'end') {
    return;
  }

  assert.equal(end.qualified, false);
  assert.equal(end.heldMs, 120);
  assert.equal(detector.isIdle, true);
});

test('a tick promotes the press to a recording hold', () => {
  const detector = new HoldDetector({
    thresholdMs: 250,
    maxHoldMs: 120_000,
  });

  detector.press(key, 0);
  assert.deepEqual(detector.tick(249), []);

  const [start] = detector.tick(250);
  assert.equal(start?.type, 'start');
  if (start?.type !== 'start') {
    return;
  }

  assert.equal(start.heldMs, 250);

  const updates = detector.release(600);
  assert.equal(updates.length, 1);

  const [end] = updates;
  assert.equal(end?.type, 'end');
  if (end?.type !== 'end') {
    return;
  }

  assert.equal(end.qualified, true);
  assert.equal(end.reason, 'release');
  assert.equal(end.heldMs, 600);
});

test('release between ticks synthesizes start then end', () => {
  const detector = new HoldDetector({
    thresholdMs: 250,
    maxHoldMs: 120_000,
  });

  detector.press(key, 0);
  const updates = detector.release(400);

  assert.deepEqual(
    updates.map((update) => update.type),
    ['start', 'end'],
  );

  const [start, end] = updates;
  assert.equal(start?.type, 'start');
  assert.equal(end?.type, 'end');

  if (start?.type !== 'start' || end?.type !== 'end') {
    return;
  }

  assert.equal(start.heldMs, 250);
  assert.equal(end.qualified, true);
  assert.equal(end.heldMs, 400);
});

test('a second press is ignored while a hold is in flight', () => {
  const detector = new HoldDetector({
    thresholdMs: 250,
    maxHoldMs: 120_000,
  });

  detector.press(key, 0);
  assert.deepEqual(detector.press({ code: 30, name: 'KEY_A' }, 50), []);

  const [start] = detector.tick(250);
  assert.equal(start?.type, 'start');

  const [end] = detector.release(500);
  assert.equal(end?.type, 'end');
  if (end?.type !== 'end') {
    return;
  }

  assert.equal(end.key.code, 100);
  assert.equal(end.qualified, true);
});

test('the max duration ends a hold even if the key is still down', () => {
  const detector = new HoldDetector({
    thresholdMs: 100,
    maxHoldMs: 500,
  });

  detector.press(key, 0);
  assert.equal(detector.tick(100)[0]?.type, 'start');
  assert.deepEqual(detector.tick(499), []);

  const [end] = detector.tick(500);
  assert.equal(end?.type, 'end');
  if (end?.type !== 'end') {
    return;
  }

  assert.equal(end.reason, 'max-duration');
  assert.equal(end.qualified, true);
  assert.equal(end.heldMs, 500);
  assert.equal(detector.isIdle, true);
});

test('cancel discards the hold and resets the state machine', () => {
  const detector = new HoldDetector({
    thresholdMs: 100,
    maxHoldMs: 120_000,
  });

  detector.press(key, 0);
  detector.tick(300);

  const [cancel] = detector.cancel(400, 'other-key');
  assert.equal(cancel?.type, 'cancel');
  if (cancel?.type !== 'cancel') {
    return;
  }

  assert.equal(cancel.reason, 'other-key');
  assert.equal(cancel.heldMs, 400);
  assert.equal(detector.isIdle, true);
  assert.deepEqual(detector.release(500), []);
});

test('the constructor rejects impossible timing bounds', () => {
  assert.throws(
    () => new HoldDetector({ thresholdMs: 500, maxHoldMs: 500 }),
    /greater than thresholdMs/,
  );
  assert.throws(
    () => new HoldDetector({ thresholdMs: -1 }),
    /thresholdMs must be a finite number/,
  );
});

test('a zero threshold starts on the first tick', () => {
  const detector = new HoldDetector({
    thresholdMs: 0,
    maxHoldMs: 1_000,
  });

  detector.press(key, 10);
  const [start] = detector.tick(10);

  assert.equal(start?.type, 'start');
  if (start?.type !== 'start') {
    return;
  }

  assert.equal(start.heldMs, 0);
});
