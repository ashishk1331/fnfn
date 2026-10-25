import { execFile } from 'node:child_process';
import { access, mkdir, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';

import {
  buildSearchPrompt,
  cleanSearchQuery,
  needleCall,
  parseNeedleOutput,
  type NeedleResult,
} from '../shared/search';

const execFileAsync = promisify(execFile);

const NEEDLE_TIMEOUT_MS = 45_000;
const TOOLS_FILE = 'fnfn-needle-tools.json';

const SEARCH_TOOLS = [
  {
    name: 'search_web',
    description:
      'Use this to look up any information on the internet: facts, places, people, news, definitions, prices, or current events.',
    parameters: {
      type: 'object',
      properties: {
        query: {
          type: 'string',
          description: 'A short web search query with the key words only.',
        },
      },
      required: ['query'],
    },
  },
];

export interface QueryExtraction {
  query: string;
  confidence: number;
  /** True when Needle produced no query and the transcript was used as-is. */
  fallback: boolean;
}

export interface NeedleRunnerOptions {
  cli: string;
  model: string;
  timeoutMs?: number;
}

export class NeedleRunner {
  private readonly cli: string;
  private readonly model: string;
  private readonly timeoutMs: number;
  private queue: Promise<unknown> = Promise.resolve();
  private toolsPath: Promise<string> | null = null;

  constructor(options: NeedleRunnerOptions) {
    this.cli = options.cli;
    this.model = options.model;
    this.timeoutMs = options.timeoutMs ?? NEEDLE_TIMEOUT_MS;
  }

  async isReady(): Promise<boolean> {
    try {
      await access(this.cli);
      await access(this.model);
      return true;
    } catch {
      return false;
    }
  }

  /** Extract a search query from speech. Falls back to the transcript. */
  async extractQuery(
    spoken: string,
    signal?: AbortSignal,
  ): Promise<QueryExtraction> {
    const result = await this.run(buildSearchPrompt(spoken), signal);
    const call = needleCall(result, 'search_web');
    const raw = call?.arguments.query;
    const query = typeof raw === 'string' ? cleanSearchQuery(raw) : '';

    if (!query) {
      return {
        query: cleanSearchQuery(spoken),
        confidence: result.confidence,
        fallback: true,
      };
    }

    return { query, confidence: result.confidence, fallback: false };
  }

  private toolsFile(): Promise<string> {
    this.toolsPath ??= (async () => {
      const directory = path.join(os.tmpdir(), 'fnfn-needle');
      await mkdir(directory, { recursive: true });
      const file = path.join(directory, TOOLS_FILE);
      await writeFile(
        file,
        `${JSON.stringify(SEARCH_TOOLS, null, 2)}\n`,
        'utf8',
      );
      return file;
    })();

    return this.toolsPath;
  }

  private run(prompt: string, signal?: AbortSignal): Promise<NeedleResult> {
    const task = this.queue.then(() => this.execute(prompt, signal));
    this.queue = task.catch(() => {});
    return task;
  }

  private async execute(
    prompt: string,
    signal?: AbortSignal,
  ): Promise<NeedleResult> {
    if (signal?.aborted) {
      throw new Error('Search cancelled.');
    }

    const tools = await this.toolsFile();
    let stdout = '';

    try {
      const result = await execFileAsync(
        this.cli,
        [
          '--model',
          this.model,
          '--tools',
          tools,
          '--prompt',
          prompt,
          '--max',
          '96',
        ],
        {
          timeout: this.timeoutMs,
          maxBuffer: 2 * 1024 * 1024,
          signal,
        },
      );
      stdout = result.stdout;
    } catch (error) {
      const failure = error as NodeJS.ErrnoException & {
        stderr?: string;
        killed?: boolean;
        name?: string;
      };

      if (failure.name === 'AbortError') {
        throw new Error('Search cancelled.');
      }
      if (failure.code === 'ENOENT') {
        throw new Error(
          `Needle engine not found (${this.cli}). Run npm run fetch:needle or set NEEDLE_CLI.`,
        );
      }
      if (failure.killed) {
        throw new Error(
          `Needle timed out after ${Math.round(this.timeoutMs / 1000)}s.`,
        );
      }

      throw new Error(
        `Needle failed: ${failure.stderr?.trim() || failure.message}`,
      );
    }

    const parsed = parseNeedleOutput(stdout);
    if (!parsed) {
      throw new Error(
        `Needle returned invalid JSON: ${stdout.trim().slice(0, 160)}`,
      );
    }
    if (parsed.error) {
      throw new Error(parsed.error);
    }

    return parsed;
  }
}
