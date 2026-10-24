/**
 * Voice Activity Detection (VAD) and Endpointing for 16 kHz mono WAV audio.
 *
 * Combines speech-band energy filtering (formants 300-3400 Hz), adaptive noise floor
 * tracking, zero-crossing rate analysis, and temporal hangover smoothing to reject
 * background noise, fan hum, desk thumps, and electrical hiss, cutting hallucinated
 * STT transcripts from noisy holds.
 */

interface VadResult {
  isSpeech: boolean;
  totalDurationMs: number;
  speechDurationMs: number;
  speechRatio: number;
  speechStartMs: number;
  speechEndMs: number;
  trimmedBuffer?: Buffer;
  reason?: 'silence' | 'noise' | 'too-short';
}

interface VadOptions {
  minSpeechDurationMs?: number;
  frameDurationMs?: number;
  hopDurationMs?: number;
  minEnergyThreshold?: number;
  speechBandRatioThreshold?: number;
  padLeadInMs?: number;
  padLeadOutMs?: number;
}

const DEFAULT_OPTIONS: Required<VadOptions> = {
  minSpeechDurationMs: 200,
  frameDurationMs: 30,
  hopDurationMs: 15,
  minEnergyThreshold: 0.012,
  speechBandRatioThreshold: 0.35,
  padLeadInMs: 120,
  padLeadOutMs: 180,
};

// 2nd-order Butterworth Highpass at 280 Hz, fs=16000
const HP_COEFFS = {
  b0: 0.9251913,
  b1: -1.8503826,
  b2: 0.9251913,
  a1: -1.8447784,
  a2: 0.8559868,
};

// 2nd-order Butterworth Lowpass at 3400 Hz, fs=16000
const LP_COEFFS = {
  b0: 0.227118,
  b1: 0.454236,
  b2: 0.227118,
  a1: -0.276665,
  a2: 0.185136,
};

function filterSignal(
  samples: Float32Array,
  coeffs: { b0: number; b1: number; b2: number; a1: number; a2: number },
): Float32Array {
  const out = new Float32Array(samples.length);
  let x1 = 0;
  let x2 = 0;
  let y1 = 0;
  let y2 = 0;

  for (let i = 0; i < samples.length; i += 1) {
    const x = samples[i];
    const y =
      coeffs.b0 * x +
      coeffs.b1 * x1 +
      coeffs.b2 * x2 -
      coeffs.a1 * y1 -
      coeffs.a2 * y2;
    x2 = x1;
    x1 = x;
    y2 = y1;
    y1 = y;
    out[i] = y;
  }

  return out;
}

export function extractPcmSamples(wavBuffer: Buffer): {
  samples: Float32Array;
  sampleRate: number;
} | null {
  if (
    wavBuffer.length < 44 ||
    wavBuffer.toString('ascii', 0, 4) !== 'RIFF' ||
    wavBuffer.toString('ascii', 8, 12) !== 'WAVE'
  ) {
    return null;
  }

  const sampleRate = wavBuffer.readUInt32LE(24);
  let offset = 12;

  while (offset + 8 <= wavBuffer.length) {
    const id = wavBuffer.toString('ascii', offset, offset + 4);
    const size = wavBuffer.readUInt32LE(offset + 4);
    if (id === 'data') {
      const start = offset + 8;
      const end = Math.min(wavBuffer.length, start + size);
      const count = Math.floor((end - start) / 2);
      if (count === 0) {
        return null;
      }

      const samples = new Float32Array(count);
      for (let i = 0; i < count; i += 1) {
        samples[i] = wavBuffer.readInt16LE(start + i * 2) / 32768;
      }
      return { samples, sampleRate };
    }
    offset += 8 + size + (size % 2);
  }

  return null;
}

export function createWavBuffer(
  samples: Float32Array,
  sampleRate = 16000,
): Buffer {
  const byteCount = samples.length * 2;
  const buffer = Buffer.alloc(44 + byteCount);

  buffer.write('RIFF', 0, 'ascii');
  buffer.writeUInt32LE(36 + byteCount, 4);
  buffer.write('WAVE', 8, 'ascii');
  buffer.write('fmt ', 12, 'ascii');
  buffer.writeUInt32LE(16, 16);
  buffer.writeUInt16LE(1, 20); // PCM
  buffer.writeUInt16LE(1, 22); // Mono
  buffer.writeUInt32LE(sampleRate, 24);
  buffer.writeUInt32LE(sampleRate * 2, 28); // Byte rate
  buffer.writeUInt16LE(2, 32); // Block align
  buffer.writeUInt16LE(16, 34); // Bits per sample
  buffer.write('data', 36, 'ascii');
  buffer.writeUInt32LE(byteCount, 40);

  for (let i = 0; i < samples.length; i += 1) {
    const s = Math.max(-1, Math.min(1, samples[i]));
    const intVal = s < 0 ? s * 32768 : s * 32767;
    buffer.writeInt16LE(Math.round(intVal), 44 + i * 2);
  }

  return buffer;
}

/**
 * Analyzes audio for voice activity and speech-band energy.
 */
export function analyzeVoiceActivity(
  wavBuffer: Buffer,
  customOptions?: VadOptions,
): VadResult {
  const options = { ...DEFAULT_OPTIONS, ...customOptions };
  const pcm = extractPcmSamples(wavBuffer);

  if (!pcm || pcm.samples.length === 0) {
    return {
      isSpeech: false,
      totalDurationMs: 0,
      speechDurationMs: 0,
      speechRatio: 0,
      speechStartMs: 0,
      speechEndMs: 0,
      reason: 'silence',
    };
  }

  const { samples, sampleRate } = pcm;
  const totalDurationMs = Math.round((samples.length / sampleRate) * 1000);

  // Bandpass filter to isolate 280 Hz - 3400 Hz speech formant frequencies
  const hpFiltered = filterSignal(samples, HP_COEFFS);
  const speechBand = filterSignal(hpFiltered, LP_COEFFS);

  const frameSize = Math.round((options.frameDurationMs * sampleRate) / 1000);
  const hopSize = Math.round((options.hopDurationMs * sampleRate) / 1000);
  const numFrames = Math.max(
    0,
    Math.floor((samples.length - frameSize) / hopSize) + 1,
  );

  if (numFrames === 0) {
    return {
      isSpeech: false,
      totalDurationMs,
      speechDurationMs: 0,
      speechRatio: 0,
      speechStartMs: 0,
      speechEndMs: 0,
      reason: 'too-short',
    };
  }

  const frameEnergies = new Float32Array(numFrames);
  const speechEnergies = new Float32Array(numFrames);
  const zcrValues = new Int32Array(numFrames);

  let noiseFloorEstimate = 1.0;

  for (let f = 0; f < numFrames; f += 1) {
    const start = f * hopSize;
    let sumRawSq = 0;
    let sumSpeechSq = 0;
    let zcr = 0;

    for (let i = 0; i < frameSize; i += 1) {
      const s = samples[start + i];
      const sb = speechBand[start + i];
      sumRawSq += s * s;
      sumSpeechSq += sb * sb;

      if (i > 0) {
        const prev = samples[start + i - 1];
        if ((s >= 0 && prev < 0) || (s < 0 && prev >= 0)) {
          zcr += 1;
        }
      }
    }

    const frameRms = Math.sqrt(sumRawSq / frameSize);
    const speechRms = Math.sqrt(sumSpeechSq / frameSize);

    frameEnergies[f] = frameRms;
    speechEnergies[f] = speechRms;
    zcrValues[f] = zcr;

    if (f < 8) {
      noiseFloorEstimate = Math.min(noiseFloorEstimate, frameRms);
    }
  }

  // Identify voiced speech frames
  const voicedFrames = new Uint8Array(numFrames);
  let activeFrameCount = 0;
  let firstSpeechFrame = -1;
  let lastSpeechFrame = -1;

  for (let f = 0; f < numFrames; f += 1) {
    const rawRms = frameEnergies[f];
    const spRms = speechEnergies[f];
    const zcr = zcrValues[f];
    const ratio = spRms / (rawRms + 1e-6);

    const aboveFloor =
      rawRms >= options.minEnergyThreshold &&
      rawRms >= 1.5 * noiseFloorEstimate;
    const isSpeechBand = ratio >= options.speechBandRatioThreshold;
    const isHumanZcr = zcr >= 6 && zcr <= 140;

    if (aboveFloor && isSpeechBand && isHumanZcr) {
      voicedFrames[f] = 1;
      activeFrameCount += 1;
      if (firstSpeechFrame === -1) {
        firstSpeechFrame = f;
      }
      lastSpeechFrame = f;
    }
  }

  const speechDurationMs = Math.round(activeFrameCount * options.hopDurationMs);
  const speechRatio = numFrames > 0 ? activeFrameCount / numFrames : 0;

  const isSpeech =
    speechDurationMs >= options.minSpeechDurationMs && activeFrameCount >= 6;

  if (!isSpeech) {
    return {
      isSpeech: false,
      totalDurationMs,
      speechDurationMs,
      speechRatio,
      speechStartMs: 0,
      speechEndMs: 0,
      reason: speechDurationMs === 0 ? 'silence' : 'noise',
    };
  }

  // Calculate endpoint boundaries with lead-in and lead-out padding
  const leadInFrames = Math.round(options.padLeadInMs / options.hopDurationMs);
  const leadOutFrames = Math.round(
    options.padLeadOutMs / options.hopDurationMs,
  );

  const startFrame = Math.max(0, firstSpeechFrame - leadInFrames);
  const endFrame = Math.min(numFrames - 1, lastSpeechFrame + leadOutFrames);

  const startSample = startFrame * hopSize;
  const endSample = Math.min(samples.length, endFrame * hopSize + frameSize);

  const speechStartMs = Math.round((startSample / sampleRate) * 1000);
  const speechEndMs = Math.round((endSample / sampleRate) * 1000);

  // Trim samples if speech is bounded within clip
  let trimmedBuffer: Buffer | undefined;
  if (startSample > 0 || endSample < samples.length) {
    const trimmedSamples = samples.subarray(startSample, endSample);
    trimmedBuffer = createWavBuffer(trimmedSamples, sampleRate);
  }

  return {
    isSpeech: true,
    totalDurationMs,
    speechDurationMs,
    speechRatio,
    speechStartMs,
    speechEndMs,
    trimmedBuffer,
  };
}

const COMMON_HALLUCINATIONS = new Set([
  'thank you.',
  'thank you',
  'thank you very much.',
  'thank you very much',
  'thanks for watching.',
  'thanks for watching',
  'thank you for watching.',
  'thank you for watching',
  'please subscribe.',
  'please subscribe',
  'subtitles by',
  'bye.',
  'bye',
  'you',
  '[music]',
  '[applause]',
]);

/**
 * Checks if a transcript is a known Whisper/Whistle noise hallucination.
 */
export function isHallucinationCandidate(text: string): boolean {
  const normalized = text.trim().toLowerCase();
  if (COMMON_HALLUCINATIONS.has(normalized)) {
    return true;
  }
  return (
    normalized.startsWith('subtitles by') ||
    normalized.startsWith('transcript:')
  );
}
