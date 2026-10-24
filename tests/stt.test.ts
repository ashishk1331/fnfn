import assert from 'node:assert/strict';
import test from 'node:test';

import { measureWavLevels, parseCactusOutput } from '../src/main/stt';

function wav(samples: number[]): Buffer {
  const buffer = Buffer.alloc(44 + samples.length * 2);
  buffer.write('RIFF', 0, 'ascii');
  buffer.writeUInt32LE(36 + samples.length * 2, 4);
  buffer.write('WAVE', 8, 'ascii');
  buffer.write('fmt ', 12, 'ascii');
  buffer.writeUInt32LE(16, 16);
  buffer.writeUInt16LE(1, 20);
  buffer.writeUInt16LE(1, 22);
  buffer.writeUInt32LE(16_000, 24);
  buffer.writeUInt32LE(32_000, 28);
  buffer.writeUInt16LE(2, 32);
  buffer.writeUInt16LE(16, 34);
  buffer.write('data', 36, 'ascii');
  buffer.writeUInt32LE(samples.length * 2, 40);

  samples.forEach((sample, index) => {
    buffer.writeInt16LE(sample, 44 + index * 2);
  });

  return buffer;
}

test('WAV levels distinguish silence from speech', () => {
  const silence = measureWavLevels(wav([0, 0, 0, 0]));
  const speech = measureWavLevels(wav([0, 16_384, -16_384, 32_767]));

  assert.ok(silence);
  assert.ok(speech);
  assert.equal(silence.peak, 0);
  assert.equal(silence.rms, 0);
  assert.ok(speech.peak > 0.99);
  assert.ok(speech.rms > 0.6);
});

test('non-WAV buffers are ignored', () => {
  assert.equal(measureWavLevels(Buffer.from('not a wav')), null);
});

test('Cactus CLI output is read as text and language', () => {
  const payload = parseCactusOutput(
    '{"text":"turn off the kitchen lights","language":"en","ttft_ms":11.1,"decode_tps":1319.0}',
  );

  assert.equal(payload?.text, 'turn off the kitchen lights');
  assert.equal(payload?.language, 'en');
});

test('Cactus CLI silence and malformed output stay distinguishable', () => {
  assert.equal(parseCactusOutput('{"text":"","language":""}')?.text, '');
  assert.equal(parseCactusOutput('not json'), null);
  assert.equal(parseCactusOutput('[]'), null);
});
