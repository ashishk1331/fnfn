import { execFile } from 'node:child_process';
import { mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';

import type { AppConfig } from './config';
import { analyzeVoiceActivity, isHallucinationCandidate } from './vad';
import type { SttInfo, TranscriptionResult } from '../shared/types';

const execFileAsync = promisify(execFile);

const MAX_AUDIO_BYTES = 60 * 1024 * 1024;
const FFMPEG_TIMEOUT_MS = 30_000;
const CACTUS_TIMEOUT_MS = 180_000;
const SILENCE_PEAK = 0.03;
const SILENCE_RMS = 0.006;

interface EngineTranscript {
  text: string;
}

interface SttEngine {
  readonly name: string;
  readonly model: string;
  transcribe(wavPath: string): Promise<EngineTranscript>;
}

interface CactusCliPayload {
  text?: string;
  language?: string;
  error?: string;
}

class CactusCliEngine implements SttEngine {
  readonly name = 'Cactus Whistle';
  readonly model: string;

  constructor(
    private readonly options: {
      cli: string;
      model: string;
      language: string;
    },
  ) {
    this.model = path.basename(options.model);
  }

  async transcribe(wavPath: string): Promise<EngineTranscript> {
    try {
      await stat(this.options.model);
    } catch {
      throw new Error(
        `Whistle model not found at ${this.options.model}. Run npm run fetch:needle or set CACTUS_MODEL.`,
      );
    }

    const args = ['--model', this.options.model, '--audio', wavPath];
    if (this.options.language !== 'auto') {
      args.push('--audio-language', this.options.language);
    }

    let stdout = '';
    try {
      const result = await execFileAsync(this.options.cli, args, {
        timeout: CACTUS_TIMEOUT_MS,
        maxBuffer: 16 * 1024 * 1024,
      });
      stdout = result.stdout;
    } catch (error) {
      const failure = error as NodeJS.ErrnoException & {
        stderr?: string;
        killed?: boolean;
      };

      if (failure.code === 'ENOENT') {
        throw new Error(
          `Whistle engine not found (${this.options.cli}). Run npm run fetch:needle or set CACTUS_CLI.`,
        );
      }
      if (failure.killed) {
        throw new Error(
          `Cactus Whistle timed out after ${CACTUS_TIMEOUT_MS / 1000}s.`,
        );
      }

      throw new Error(
        `Cactus Whistle failed: ${failure.stderr?.trim() || failure.message}`,
      );
    }

    const payload = parseCactusOutput(stdout);
    if (!payload) {
      throw new Error(
        `Cactus Whistle returned invalid JSON: ${stdout.trim().slice(0, 200)}`,
      );
    }
    if (payload.error) {
      throw new Error(payload.error);
    }
    if (typeof payload.text !== 'string') {
      throw new Error('Cactus Whistle returned no transcript text.');
    }

    return { text: payload.text };
  }
}

export function parseCactusOutput(raw: string): CactusCliPayload | null {
  try {
    const parsed: unknown = JSON.parse(raw.trim());
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      return parsed as CactusCliPayload;
    }
  } catch {
    // The caller reports the invalid payload with the process stderr.
  }

  return null;
}

export function measureWavLevels(
  buffer: Buffer,
): { peak: number; rms: number } | null {
  if (
    buffer.length < 44 ||
    buffer.toString('ascii', 0, 4) !== 'RIFF' ||
    buffer.toString('ascii', 8, 12) !== 'WAVE'
  ) {
    return null;
  }

  let offset = 12;
  while (offset + 8 <= buffer.length) {
    const id = buffer.toString('ascii', offset, offset + 4);
    const size = buffer.readUInt32LE(offset + 4);
    if (id === 'data') {
      const start = offset + 8;
      const end = Math.min(buffer.length, start + size);
      const count = Math.floor((end - start) / 2);
      if (count === 0) {
        return null;
      }

      let peak = 0;
      let squares = 0;
      for (let index = 0; index < count; index += 1) {
        const sample = buffer.readInt16LE(start + index * 2) / 32768;
        const magnitude = Math.abs(sample);
        peak = Math.max(peak, magnitude);
        squares += sample * sample;
      }

      return { peak, rms: Math.sqrt(squares / count) };
    }

    offset += 8 + size + (size % 2);
  }

  return null;
}

function cleanTranscript(text: string): string {
  return text
    .replace(/\[(BLANK_AUDIO|SILENCE|MUSIC|SOUND)\]/gi, '')
    .replace(/<\|[^|]+\|>/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

async function convertToWav(
  ffmpegPath: string,
  input: string,
  output: string,
): Promise<void> {
  const args = [
    '-hide_banner',
    '-loglevel',
    'error',
    '-y',
    '-i',
    input,
    '-ar',
    '16000',
    '-ac',
    '1',
    '-c:a',
    'pcm_s16le',
    output,
  ];

  try {
    await execFileAsync(ffmpegPath, args, {
      timeout: FFMPEG_TIMEOUT_MS,
      maxBuffer: 4 * 1024 * 1024,
    });
  } catch (error) {
    const failure = error as NodeJS.ErrnoException & {
      stderr?: string;
      killed?: boolean;
    };

    if (failure.code === 'ENOENT') {
      throw new Error(
        `ffmpeg not found (${ffmpegPath}). Install it or set FFMPEG_PATH.`,
      );
    }

    throw new Error(
      `ffmpeg could not convert the recording: ${
        failure.stderr?.trim() || failure.message
      }`,
    );
  }
}

export class SttService {
  private readonly engine: SttEngine;

  constructor(private readonly config: AppConfig) {
    this.engine = new CactusCliEngine({
      cli: config.cactusCli,
      model: config.cactusModel,
      language: config.cactusLanguage,
    });
  }

  get info(): SttInfo {
    return {
      engine: this.engine.name,
      model: this.engine.model,
    };
  }

  async transcribe(
    audio: ArrayBuffer,
    durationMs: number,
  ): Promise<TranscriptionResult> {
    if (audio.byteLength === 0) {
      throw new Error('The recorder sent an empty buffer.');
    }
    if (audio.byteLength > MAX_AUDIO_BYTES) {
      throw new Error(
        `Recording is too large (${Math.round(
          audio.byteLength / 1024 / 1024,
        )} MB).`,
      );
    }

    if (durationMs < 50) {
      return {
        text: '',
        timings: { convertMs: 0, sttMs: 0, totalMs: 0 },
        skipped: 'too-short',
      };
    }

    const startedAt = Date.now();
    const workDir = await mkdtemp(path.join(os.tmpdir(), 'fnfn-'));
    const sourcePath = path.join(workDir, 'capture.webm');
    const wavPath = path.join(workDir, 'capture.wav');

    try {
      await writeFile(sourcePath, Buffer.from(new Uint8Array(audio)));
      await convertToWav(this.config.ffmpegPath, sourcePath, wavPath);
      const convertedAt = Date.now();

      const rawWavBuffer = await readFile(wavPath);
      const levels = measureWavLevels(rawWavBuffer);
      if (levels && levels.peak < SILENCE_PEAK && levels.rms < SILENCE_RMS) {
        return {
          text: '',
          timings: {
            convertMs: convertedAt - startedAt,
            sttMs: 0,
            totalMs: convertedAt - startedAt,
          },
          skipped: 'silence',
        };
      }

      const vad = analyzeVoiceActivity(rawWavBuffer);
      if (!vad.isSpeech) {
        return {
          text: '',
          timings: {
            convertMs: convertedAt - startedAt,
            sttMs: 0,
            totalMs: convertedAt - startedAt,
          },
          skipped: 'silence',
        };
      }

      if (vad.trimmedBuffer) {
        await writeFile(wavPath, vad.trimmedBuffer);
      }

      const result = await this.engine.transcribe(wavPath);
      const finishedAt = Date.now();
      const cleaned = cleanTranscript(result.text);

      if (isHallucinationCandidate(cleaned) && vad.speechDurationMs < 500) {
        return {
          text: '',
          timings: {
            convertMs: convertedAt - startedAt,
            sttMs: finishedAt - convertedAt,
            totalMs: finishedAt - startedAt,
          },
          skipped: 'silence',
        };
      }

      return {
        text: cleaned,
        timings: {
          convertMs: convertedAt - startedAt,
          sttMs: finishedAt - convertedAt,
          totalMs: finishedAt - startedAt,
        },
      };
    } finally {
      if (this.config.keepAudio) {
        console.info(`[stt] kept audio in ${workDir}`);
      } else {
        await rm(workDir, { recursive: true, force: true });
      }
    }
  }
}
