import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';

import {
  DEFAULT_TEXT_RULES,
  normalizeTextRules,
  type TextRules,
} from '../shared/text-rules';
import type { InsertPreference } from './insert';

export interface AppConfig {
  holdKeyCode: number;
  holdThresholdMs: number;
  maxHoldMs: number;
  insertTool: InsertPreference;
  cactusCli: string;
  cactusModel: string;
  cactusLanguage: string;
  ffmpegPath: string;
  keepAudio: boolean;
  textRules: TextRules;
}

interface SettingsFile {
  holdKeyCode?: number;
  holdThresholdMs?: number;
  maxHoldMs?: number;
  insertTool?: InsertPreference;
  cactusCli?: string;
  cactusModel?: string;
  cactusLanguage?: string;
  ffmpegPath?: string;
  keepAudio?: boolean;
  textRules?: TextRules;
}

const SETTINGS_FILE = 'fnfn-settings.json';

/** The folder name Cactus publishes for this platform, if there is one. */
function needlePlatform(
  platform = process.platform,
  arch = process.arch,
): string | null {
  if (platform === 'linux') {
    if (arch === 'x64') return 'linux-x86_64';
    if (arch === 'arm64') return 'linux-arm64';
    if (arch === 'arm') return 'linux-armv7';
    if (arch === 'riscv64') return 'linux-riscv64';
  }
  if (platform === 'darwin' && arch === 'arm64') return 'macos-arm64';
  if (platform === 'win32') {
    return arch === 'arm64' ? 'windows-arm64' : 'windows-x86_64';
  }
  return null;
}

function firstExisting(candidates: string[]): string | null {
  return candidates.find((candidate) => existsSync(candidate)) ?? null;
}

function defaultCactusCli(appRoot: string): string {
  const platform = needlePlatform();

  if (!platform) {
    return 'needle';
  }

  const name = platform.startsWith('windows') ? 'needle.exe' : 'needle';
  const resources = process.resourcesPath;
  const local = path.join(appRoot, 'vendor', 'needle', platform, name);
  const candidates = [
    local,
    ...(typeof resources === 'string'
      ? [path.join(resources, 'needle', platform, name)]
      : []),
  ];

  return firstExisting(candidates) ?? local;
}

function defaultCactusModel(appRoot: string): string {
  const resources = process.resourcesPath;
  const candidates = [
    path.join(appRoot, 'vendor', 'needle', 'whistle.cact'),
    ...(typeof resources === 'string'
      ? [path.join(resources, 'needle', 'whistle.cact')]
      : []),
  ];

  return firstExisting(candidates) ?? candidates[0];
}

function defaults(appRoot: string): AppConfig {
  return {
    holdKeyCode: 100, // KEY_RIGHTALT
    holdThresholdMs: 250,
    maxHoldMs: 120_000,
    insertTool: 'auto',
    cactusCli: defaultCactusCli(appRoot),
    cactusModel: defaultCactusModel(appRoot),
    cactusLanguage: 'auto',
    ffmpegPath: 'ffmpeg',
    keepAudio: false,
    textRules: DEFAULT_TEXT_RULES,
  };
}

function readSettings(userDataDir: string): SettingsFile {
  try {
    const raw = readFileSync(path.join(userDataDir, SETTINGS_FILE), 'utf8');
    const parsed: unknown = JSON.parse(raw);
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      return parsed as SettingsFile;
    }
  } catch {
    // First run, or a corrupt file. Defaults are fine.
  }

  return {};
}

function positiveNumber(value: unknown): number | undefined {
  const number = Number(value);
  return Number.isFinite(number) && number >= 0 ? number : undefined;
}

function normalize(
  base: AppConfig,
  candidate: SettingsFile,
  appRoot: string,
): AppConfig {
  const threshold =
    positiveNumber(candidate.holdThresholdMs) ?? base.holdThresholdMs;
  const max = positiveNumber(candidate.maxHoldMs) ?? base.maxHoldMs;
  const safeThreshold = threshold > 0 ? threshold : base.holdThresholdMs;
  const safeMax =
    max > safeThreshold ? max : Math.max(base.maxHoldMs, safeThreshold + 1);
  const key = positiveNumber(candidate.holdKeyCode);
  const insertTool =
    candidate.insertTool === 'xdotool' ||
    candidate.insertTool === 'ydotool' ||
    candidate.insertTool === 'wtype' ||
    candidate.insertTool === 'auto'
      ? candidate.insertTool
      : base.insertTool;

  return {
    ...base,
    holdKeyCode: key !== undefined && key <= 0x2ff ? key : base.holdKeyCode,
    holdThresholdMs: safeThreshold,
    maxHoldMs: safeMax,
    insertTool,
    cactusCli:
      typeof candidate.cactusCli === 'string' && candidate.cactusCli.trim()
        ? candidate.cactusCli.trim()
        : base.cactusCli,
    cactusModel:
      typeof candidate.cactusModel === 'string' && candidate.cactusModel.trim()
        ? path.resolve(appRoot, candidate.cactusModel.trim())
        : base.cactusModel,
    cactusLanguage:
      typeof candidate.cactusLanguage === 'string' &&
      candidate.cactusLanguage.trim()
        ? candidate.cactusLanguage.trim()
        : base.cactusLanguage,
    ffmpegPath:
      typeof candidate.ffmpegPath === 'string' && candidate.ffmpegPath.trim()
        ? candidate.ffmpegPath.trim()
        : base.ffmpegPath,
    keepAudio:
      typeof candidate.keepAudio === 'boolean'
        ? candidate.keepAudio
        : base.keepAudio,
    textRules:
      candidate.textRules === undefined
        ? base.textRules
        : normalizeTextRules(candidate.textRules),
  };
}

function environmentOverrides(appRoot: string): SettingsFile {
  const overrides: SettingsFile = {};

  if (process.env.FN_HOLD_KEY) {
    overrides.holdKeyCode = positiveNumber(process.env.FN_HOLD_KEY);
  }
  if (process.env.FN_HOLD_MS) {
    overrides.holdThresholdMs = positiveNumber(process.env.FN_HOLD_MS);
  }
  if (process.env.FN_MAX_MS) {
    overrides.maxHoldMs = positiveNumber(process.env.FN_MAX_MS);
  }
  if (process.env.CACTUS_CLI) {
    overrides.cactusCli = process.env.CACTUS_CLI;
  }
  if (process.env.CACTUS_MODEL) {
    overrides.cactusModel = path.resolve(appRoot, process.env.CACTUS_MODEL);
  }
  if (process.env.CACTUS_LANG) {
    overrides.cactusLanguage = process.env.CACTUS_LANG;
  }
  if (process.env.FFMPEG_PATH) {
    overrides.ffmpegPath = process.env.FFMPEG_PATH;
  }
  if (
    process.env.FN_INSERT_TOOL === 'auto' ||
    process.env.FN_INSERT_TOOL === 'xdotool' ||
    process.env.FN_INSERT_TOOL === 'ydotool' ||
    process.env.FN_INSERT_TOOL === 'wtype'
  ) {
    overrides.insertTool = process.env.FN_INSERT_TOOL;
  }
  if (process.env.FN_KEEP_AUDIO === '1') {
    overrides.keepAudio = true;
  }

  return overrides;
}

export function loadConfig(userDataDir: string, appRoot: string): AppConfig {
  const base = defaults(appRoot);
  const fromDisk = normalize(base, readSettings(userDataDir), appRoot);
  return normalize(fromDisk, environmentOverrides(appRoot), appRoot);
}

export function saveSettings(userDataDir: string, patch: SettingsFile): void {
  const next = {
    ...readSettings(userDataDir),
    ...patch,
  };

  try {
    mkdirSync(userDataDir, { recursive: true });
    writeFileSync(
      path.join(userDataDir, SETTINGS_FILE),
      `${JSON.stringify(next, null, 2)}\n`,
      'utf8',
    );
  } catch (error) {
    console.error('[config] failed to save settings', error);
  }
}
