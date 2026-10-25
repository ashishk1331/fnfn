import { spawn } from 'node:child_process';
import { execFile } from 'node:child_process';
import { mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';

import {
  applyTextRules,
  keywordList,
  type TextRules,
} from '../shared/text-rules';
import type { AppConfig } from './config';
import { analyzeVoiceActivity, isHallucinationCandidate } from './vad';
import type {
  SttInfo,
  TranscriptionMode,
  TranscriptionResult,
} from '../shared/types';

const execFileAsync = promisify(execFile);

const MAX_AUDIO_BYTES = 60 * 1024 * 1024;
const FFMPEG_TIMEOUT_MS = 30_000;
const CACTUS_TIMEOUT_MS = 180_000;
const SILENCE_PEAK = 0.03;
const SILENCE_RMS = 0.006;
const PREVIEW_INTERVAL_MS = 1_400;
const PREVIEW_MIN_CHUNKS = 6;

interface EngineTranscript {
  text: string;
}

interface SttEngine {
  readonly name: string;
  readonly model: string;
  transcribe(wavPath: string, keywordsPath?: string): Promise<EngineTranscript>;
  transcribeStream(
    wavPath: string,
    keywordsPath: string | undefined,
    onPartial: (text: string) => void,
    signal: AbortSignal,
  ): Promise<string>;
}

interface CactusCliPayload {
  text?: string;
  language?: string;
  error?: string;
}

export interface StreamPiece {
  text: string;
  pending: string;
}

export function parseStreamLine(line: string): StreamPiece | null {
  const trimmed = line.trim();
  if (!trimmed) {
    return null;
  }

  try {
    const parsed: unknown = JSON.parse(trimmed);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      return null;
    }
    const payload = parsed as { text?: unknown; pending?: unknown };
    return {
      text: typeof payload.text === 'string' ? payload.text : '',
      pending: typeof payload.pending === 'string' ? payload.pending : '',
    };
  } catch {
    return null;
  }
}

function joinWords(first: string, second: string): string {
  return `${first} ${second}`.replace(/\s+/g, ' ').trim();
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

  private args(wavPath: string, keywordsPath?: string): string[] {
    const args = ['--model', this.options.model, '--audio', wavPath];
    if (this.options.language !== 'auto') {
      args.push('--audio-language', this.options.language);
    }
    if (keywordsPath) {
      args.push('--audio-keywords', keywordsPath);
    }
    return args;
  }

  private async ensureModel(): Promise<void> {
    try {
      await stat(this.options.model);
    } catch {
      throw new Error(
        `Whistle model not found at ${this.options.model}. Run npm run fetch:needle or set CACTUS_MODEL.`,
      );
    }
  }

  async transcribe(
    wavPath: string,
    keywordsPath?: string,
  ): Promise<EngineTranscript> {
    await this.ensureModel();

    let stdout = '';
    try {
      const result = await execFileAsync(
        this.options.cli,
        this.args(wavPath, keywordsPath),
        {
          timeout: CACTUS_TIMEOUT_MS,
          maxBuffer: 16 * 1024 * 1024,
        },
      );
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

  /**
   * Each pass reads the clip from the start, so it is not one long-lived
   * stream. The engine still commits words chunk by chunk, which is what makes
   * the running preview stable instead of rewriting itself on every pass.
   */
  async transcribeStream(
    wavPath: string,
    keywordsPath: string | undefined,
    onPartial: (text: string) => void,
    signal: AbortSignal,
  ): Promise<string> {
    await this.ensureModel();

    const args = this.args(wavPath, keywordsPath);
    args.push('--audio-stream', '--audio-chunk', '1');

    return new Promise<string>((resolve, reject) => {
      const child = spawn(this.options.cli, args, {
        stdio: ['ignore', 'pipe', 'pipe'],
      });

      let stdout = '';
      let stderr = '';
      let committed = '';
      let pending = '';
      let settled = false;
      let timer: ReturnType<typeof setTimeout> | null = null;

      const finish = (error?: Error): void => {
        if (settled) {
          return;
        }
        settled = true;
        if (timer) {
          clearTimeout(timer);
        }
        signal.removeEventListener('abort', abort);
        if (error) {
          reject(error);
        } else {
          resolve(joinWords(committed, pending));
        }
      };

      const abort = (): void => {
        child.kill('SIGTERM');
        finish(new Error('Transcription aborted.'));
      };

      timer = setTimeout(() => {
        child.kill('SIGTERM');
        finish(
          new Error(
            `Cactus Whistle timed out after ${CACTUS_TIMEOUT_MS / 1000}s.`,
          ),
        );
      }, CACTUS_TIMEOUT_MS);

      if (signal.aborted) {
        abort();
      } else {
        signal.addEventListener('abort', abort, { once: true });
      }

      const consumeLine = (line: string): void => {
        const piece = parseStreamLine(line);
        if (!piece) {
          return;
        }
        if (piece.text) {
          committed = joinWords(committed, piece.text);
        }
        pending = piece.pending;
        onPartial(joinWords(committed, pending));
      };

      child.stdout.setEncoding('utf8');
      child.stdout.on('data', (chunk: string) => {
        stdout += chunk;
        let newline = stdout.indexOf('\n');
        while (newline >= 0) {
          consumeLine(stdout.slice(0, newline));
          stdout = stdout.slice(newline + 1);
          newline = stdout.indexOf('\n');
        }
      });

      child.stderr.setEncoding('utf8');
      child.stderr.on('data', (chunk: string) => {
        stderr += chunk;
      });

      child.on('error', (error: NodeJS.ErrnoException) => {
        if (error.code === 'ENOENT') {
          finish(
            new Error(
              `Whistle engine not found (${this.options.cli}). Run npm run fetch:needle or set CACTUS_CLI.`,
            ),
          );
          return;
        }
        finish(error);
      });

      child.on('close', (code) => {
        if (settled) {
          return;
        }
        if (code !== 0) {
          finish(
            new Error(
              `Cactus Whistle failed: ${stderr.trim() || `exit code ${code}`}`,
            ),
          );
          return;
        }
        if (stdout.trim()) {
          consumeLine(stdout);
        }
        finish();
      });
    });
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

interface PreviewSession {
  dir: string | null;
  chunks: Buffer[];
  bytes: number;
  lastBytes: number;
  timer: ReturnType<typeof setInterval> | null;
  running: boolean;
  aborted: boolean;
  controller: AbortController | null;
  current: Promise<void> | null;
}

export interface SttServiceOptions {
  onPartial?: (text: string) => void;
  getTextRules?: () => TextRules;
}

export class SttService {
  private readonly engine: SttEngine;
  private readonly onPartial: (text: string) => void;
  private readonly getTextRules: () => TextRules;
  private preview: PreviewSession | null = null;

  constructor(
    private readonly config: AppConfig,
    options: SttServiceOptions = {},
  ) {
    this.engine = new CactusCliEngine({
      cli: config.cactusCli,
      model: config.cactusModel,
      language: config.cactusLanguage,
    });
    this.onPartial = options.onPartial ?? (() => {});
    this.getTextRules = options.getTextRules ?? (() => config.textRules);
  }

  get info(): SttInfo {
    return {
      engine: this.engine.name,
      model: this.engine.model,
    };
  }

  private async writeKeywords(
    directory: string,
    rules: TextRules,
  ): Promise<string | undefined> {
    const words = keywordList(rules);
    if (words.length === 0) {
      return undefined;
    }

    const file = path.join(directory, 'keywords.txt');
    await writeFile(file, `${words.join('\n')}\n`, 'utf8');
    return file;
  }

  /** Begin a preview session. Audio can be pushed before the temp dir exists. */
  startPreview(): void {
    void this.stopPreview();
    const session: PreviewSession = {
      dir: null,
      chunks: [],
      bytes: 0,
      lastBytes: -1,
      timer: null,
      running: false,
      aborted: false,
      controller: null,
      current: null,
    };

    session.timer = setInterval(() => {
      void this.runPreviewPass(session);
    }, PREVIEW_INTERVAL_MS);

    this.preview = session;
  }

  pushPreviewAudio(chunk: ArrayBuffer): void {
    const session = this.preview;
    if (!session || session.aborted) {
      return;
    }
    if (session.bytes + chunk.byteLength > MAX_AUDIO_BYTES) {
      return;
    }

    session.chunks.push(Buffer.from(chunk));
    session.bytes += chunk.byteLength;
  }

  async stopPreview(): Promise<void> {
    const session = this.preview;
    if (!session) {
      return;
    }

    this.preview = null;
    session.aborted = true;
    if (session.timer) {
      clearInterval(session.timer);
      session.timer = null;
    }
    session.controller?.abort();

    if (session.current) {
      await session.current.catch(() => {});
    }
    if (session.dir) {
      await rm(session.dir, { recursive: true, force: true }).catch(() => {});
    }
  }

  private async runPreviewPass(session: PreviewSession): Promise<void> {
    if (this.preview !== session || session.aborted || session.running) {
      return;
    }
    if (
      session.chunks.length < PREVIEW_MIN_CHUNKS ||
      session.bytes === session.lastBytes
    ) {
      return;
    }

    session.running = true;
    session.lastBytes = session.bytes;

    const run = (async () => {
      try {
        session.dir ??= await mkdtemp(path.join(os.tmpdir(), 'fnfn-preview-'));
        const webmPath = path.join(session.dir, 'preview.webm');
        const wavPath = path.join(session.dir, 'preview.wav');
        await writeFile(webmPath, Buffer.concat(session.chunks));
        await convertToWav(this.config.ffmpegPath, webmPath, wavPath);
        if (session.aborted || this.preview !== session) {
          return;
        }

        const rawWav = await readFile(wavPath);
        const levels = measureWavLevels(rawWav);
        if (levels && levels.peak < SILENCE_PEAK && levels.rms < SILENCE_RMS) {
          return;
        }

        const vad = analyzeVoiceActivity(rawWav);
        if (!vad.isSpeech) {
          return;
        }
        if (vad.trimmedBuffer) {
          await writeFile(wavPath, vad.trimmedBuffer);
        }

        const rules = this.getTextRules();
        const keywords = await this.writeKeywords(session.dir, rules);
        const controller = new AbortController();
        session.controller = controller;
        let emitted = '';

        await this.engine.transcribeStream(
          wavPath,
          keywords,
          (text) => {
            if (session.aborted || this.preview !== session) {
              return;
            }
            const cleaned = applyTextRules(cleanTranscript(text), rules, {
              snippets: false,
            });
            if (cleaned && cleaned !== emitted) {
              emitted = cleaned;
              this.onPartial(cleaned);
            }
          },
          controller.signal,
        );
      } catch (error) {
        if (!session.aborted) {
          console.warn('[stt] preview failed', error);
        }
      } finally {
        session.running = false;
        session.controller = null;
        session.current = null;
      }
    })();

    session.current = run;
  }

  async transcribe(
    audio: ArrayBuffer,
    durationMs: number,
    mode: TranscriptionMode = 'dictate',
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

      const rules = this.getTextRules();
      const keywords = await this.writeKeywords(workDir, rules);
      const result = await this.engine.transcribe(wavPath, keywords);
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
        text: applyTextRules(
          cleaned,
          rules,
          mode === 'search' ? { snippets: false, style: false } : {},
        ),
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
