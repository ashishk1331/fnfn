import { execFile } from 'node:child_process';
import { accessSync, constants } from 'node:fs';
import path from 'node:path';
import { promisify } from 'node:util';

import type { InsertResult, InsertTool } from '../shared/types';

const execFileAsync = promisify(execFile);

export type InsertPreference = 'auto' | InsertTool;

interface InsertOptions {
  tool?: InsertPreference;
  delayMs?: number;
}

const INSERT_TIMEOUT_MS = 10_000;

/**
 * wtype talks to the compositor's virtual-keyboard protocol, ydotool writes to
 * /dev/uinput, and xdotool only reaches X11 (and Xwayland) windows.
 */
const WAYLAND_ORDER: InsertTool[] = ['wtype', 'ydotool', 'xdotool'];
const X11_ORDER: InsertTool[] = ['xdotool', 'ydotool'];

export function isWaylandSession(env = process.env): boolean {
  return Boolean(env.WAYLAND_DISPLAY) || env.XDG_SESSION_TYPE === 'wayland';
}

function isOnPath(command: string, env = process.env): boolean {
  for (const directory of (env.PATH ?? '').split(path.delimiter)) {
    if (!directory) {
      continue;
    }
    try {
      accessSync(path.join(directory, command), constants.X_OK);
      return true;
    } catch {
      // Try the next directory.
    }
  }

  return false;
}

export function pickInsertTool(
  preference: InsertPreference,
  available: (tool: InsertTool) => boolean,
  wayland: boolean,
): InsertTool | null {
  if (preference !== 'auto') {
    return available(preference) ? preference : null;
  }

  return (wayland ? WAYLAND_ORDER : X11_ORDER).find(available) ?? null;
}

function detectInsertTool(
  preference: InsertPreference = 'auto',
): InsertTool | null {
  return pickInsertTool(
    preference,
    (tool) => isOnPath(tool),
    isWaylandSession(),
  );
}

/**
 * Arguments for the typing tool. `--` keeps transcripts that start with a dash
 * from being read as options.
 */
export function insertArgs(tool: InsertTool, text: string): string[] {
  switch (tool) {
    case 'xdotool':
      return ['type', '--clearmodifiers', '--delay', '2', '--', text];
    case 'ydotool':
      return ['type', '--key-delay', '0', '--', text];
    case 'wtype':
      return ['--', text];
  }
}

async function run(command: string, args: string[]): Promise<void> {
  await execFileAsync(command, args, {
    timeout: INSERT_TIMEOUT_MS,
    maxBuffer: 4 * 1024 * 1024,
  });
}

async function typeWith(tool: InsertTool, text: string): Promise<InsertTool> {
  if (tool === 'ydotool') {
    try {
      await run('ydotool', insertArgs('ydotool', text));
      return 'ydotool';
    } catch {
      // Older ydotool builds do not accept --key-delay.
      await run('ydotool', ['type', '--', text]);
      return 'ydotool';
    }
  }

  if (tool === 'wtype') {
    try {
      await run('wtype', insertArgs('wtype', text));
      return 'wtype';
    } catch (error) {
      // Some compositors expose no virtual-keyboard protocol. Xwayland apps
      // still accept xdotool when it is installed.
      if (!isOnPath('xdotool')) {
        throw error;
      }
      await run('xdotool', insertArgs('xdotool', text));
      return 'xdotool';
    }
  }

  await run('xdotool', insertArgs('xdotool', text));
  return 'xdotool';
}

/**
 * Types text into whatever application has keyboard focus.
 */
export async function insertTextAtCursor(
  text: string,
  options: InsertOptions = {},
): Promise<InsertResult> {
  if (!text.trim()) {
    return { success: true, tool: 'none' };
  }

  const tool = detectInsertTool(options.tool ?? 'auto');
  if (!tool) {
    return {
      success: false,
      tool: 'none',
      error:
        'No typing tool found. Install xdotool for X11, or wtype/ydotool for Wayland.',
    };
  }

  // Give the hold key a moment to finish releasing before typing.
  const delay = options.delayMs ?? 60;
  if (delay > 0) {
    await new Promise((resolve) => setTimeout(resolve, delay));
  }

  try {
    return { success: true, tool: await typeWith(tool, text) };
  } catch (error) {
    const failure = error as NodeJS.ErrnoException & { stderr?: string };
    const message =
      failure.code === 'ENOENT'
        ? `${tool} is not installed any more.`
        : failure.stderr?.trim() || failure.message;

    return {
      success: false,
      tool,
      error: `${tool} could not type the transcript: ${message}`,
    };
  }
}
