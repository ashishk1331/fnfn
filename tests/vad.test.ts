import assert from 'node:assert/strict';
import test from 'node:test';

import {
  analyzeVoiceActivity,
  createWavBuffer,
  extractPcmSamples,
  isHallucinationCandidate,
} from '../src/main/vad';

function generateTone(
  freqHz: number,
  durationSec: number,
  sampleRate = 16000,
  amplitude = 0.5,
): Float32Array {
  const count = Math.round(durationSec * sampleRate);
  const samples = new Float32Array(count);
  for (let i = 0; i < count; i += 1) {
    samples[i] = amplitude * Math.sin((2 * Math.PI * freqHz * i) / sampleRate);
  }
  return samples;
}

test('analyzeVoiceActivity rejects pure silence', () => {
  const silence = new Float32Array(16000); // 1.0s of zeros
  const wav = createWavBuffer(silence, 16000);

  const result = analyzeVoiceActivity(wav);
  assert.equal(result.isSpeech, false);
  assert.equal(result.reason, 'silence');
  assert.equal(result.speechDurationMs, 0);
});

test('analyzeVoiceActivity rejects low-frequency 60Hz fan/mains rumble', () => {
  // 1.5s of 60Hz hum at significant amplitude
  const hum = generateTone(60, 1.5, 16000, 0.4);
  const wav = createWavBuffer(hum, 16000);

  const result = analyzeVoiceActivity(wav);
  assert.equal(result.isSpeech, false);
});

test('analyzeVoiceActivity rejects high-frequency 6000Hz electrical hiss', () => {
  // 1.5s of 6000Hz noise
  const hiss = generateTone(6000, 1.5, 16000, 0.3);
  const wav = createWavBuffer(hiss, 16000);

  const result = analyzeVoiceActivity(wav);
  assert.equal(result.isSpeech, false);
});

test('analyzeVoiceActivity rejects short transient clicks (<100ms)', () => {
  const samples = new Float32Array(16000); // 1.0s
  // 50ms click at 1000 Hz in the middle
  const click = generateTone(1000, 0.05, 16000, 0.5);
  samples.set(click, 8000);

  const wav = createWavBuffer(samples, 16000);
  const result = analyzeVoiceActivity(wav);
  assert.equal(result.isSpeech, false);
  assert.equal(result.reason, 'noise');
});

test('analyzeVoiceActivity detects genuine speech-like signal and trims dead air', () => {
  const totalSamples = new Float32Array(32000); // 2.0s total

  // 700ms speech-band burst (e.g. vowel formant ~800 Hz) placed at 0.5s - 1.2s
  const speech = generateTone(800, 0.7, 16000, 0.4);
  totalSamples.set(speech, 8000); // starts at 500ms

  const wav = createWavBuffer(totalSamples, 16000);
  const result = analyzeVoiceActivity(wav);

  assert.equal(result.isSpeech, true);
  assert.ok(result.speechDurationMs >= 500);
  assert.ok(result.speechStartMs >= 350 && result.speechStartMs <= 550);
  assert.ok(result.speechEndMs >= 1150 && result.speechEndMs <= 1500);
  assert.ok(result.trimmedBuffer !== undefined);

  // Trimmed buffer should be shorter than original 2.0s
  const trimmedPcm = extractPcmSamples(result.trimmedBuffer!);
  assert.ok(trimmedPcm !== null);
  assert.ok(trimmedPcm!.samples.length < totalSamples.length);
});

test('isHallucinationCandidate identifies common Whisper hallucinations', () => {
  assert.equal(isHallucinationCandidate('Thank you.'), true);
  assert.equal(isHallucinationCandidate('thanks for watching'), true);
  assert.equal(isHallucinationCandidate('Thank you very much.'), true);
  assert.equal(isHallucinationCandidate('Please subscribe.'), true);
  assert.equal(isHallucinationCandidate('Subtitles by someone'), true);
  assert.equal(isHallucinationCandidate('[Music]'), true);
  assert.equal(
    isHallucinationCandidate('Real dictated phrase about coding'),
    false,
  );
});
