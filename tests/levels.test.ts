import assert from 'node:assert/strict';
import test from 'node:test';

import { levelFromSamples, OVERLAY_BARS, pushLevel } from '../src/lib/levels';

function samples(value: number, count = 64): Uint8Array {
  return new Uint8Array(count).fill(value);
}

test('silence stays at zero and loud audio clamps to one', () => {
  assert.equal(levelFromSamples(samples(128)), 0);
  assert.equal(levelFromSamples(samples(0)), 1);
  assert.equal(levelFromSamples(samples(255)), 1);
  assert.equal(levelFromSamples(new Uint8Array(0)), 0);
});

test('ordinary speech lands between silence and clipping', () => {
  const level = levelFromSamples(
    Uint8Array.from([128, 150, 106, 160, 96, 140, 116, 128]),
  );

  assert.ok(level > 0);
  assert.ok(level < 1);
});

test('the waveform keeps a fixed width and drops the oldest level', () => {
  const start = Array.from({ length: OVERLAY_BARS }, (_, index) => index);
  const next = pushLevel(start, 2);

  assert.equal(next.length, OVERLAY_BARS);
  assert.equal(next.at(-1), 2);
  assert.equal(next[0], 1);
});
