import assert from 'node:assert/strict';
import { chmod, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test, { after, before } from 'node:test';

import {
  insertArgs,
  insertTextAtCursor,
  isWaylandSession,
  pickInsertTool,
  type InsertPreference,
} from '../src/main/insert';

let binDir = '';
const originalPath = process.env.PATH;
const LOG_ARGS = 'printf \'%s\\n\' "$@" > "$FN_INSERT_LOG"';

before(async () => {
  binDir = await mkdtemp(path.join(os.tmpdir(), 'fnfn-insert-'));
  process.env.PATH = `${binDir}${path.delimiter}${originalPath ?? ''}`;
  process.env.FN_INSERT_LOG = path.join(binDir, 'typed.log');
  await writeFile(process.env.FN_INSERT_LOG, '', 'utf8');
});

after(async () => {
  if (originalPath === undefined) {
    delete process.env.PATH;
  } else {
    process.env.PATH = originalPath;
  }
  delete process.env.FN_INSERT_LOG;
  await rm(binDir, { recursive: true, force: true });
});

async function shim(name: string, body: string): Promise<void> {
  const file = path.join(binDir, name);
  await writeFile(file, `#!/bin/sh\n${body}\n`, 'utf8');
  await chmod(file, 0o755);
}

async function typed(): Promise<string[]> {
  const raw = await readFile(process.env.FN_INSERT_LOG as string, 'utf8');
  return raw.split('\n').slice(0, -1);
}

test('isWaylandSession detects Wayland environment variables', () => {
  assert.equal(isWaylandSession({ WAYLAND_DISPLAY: 'wayland-0' }), true);
  assert.equal(isWaylandSession({ XDG_SESSION_TYPE: 'wayland' }), true);
  assert.equal(isWaylandSession({ DISPLAY: ':0' }), false);
  assert.equal(isWaylandSession({}), false);
});

test('pickInsertTool prefers wtype then ydotool then xdotool on Wayland', () => {
  const allAvailable = () => true;
  assert.equal(pickInsertTool('auto', allAvailable, true), 'wtype');

  const noWtype = (tool: string) => tool !== 'wtype';
  assert.equal(pickInsertTool('auto', noWtype, true), 'ydotool');

  const onlyXdotool = (tool: string) => tool === 'xdotool';
  assert.equal(pickInsertTool('auto', onlyXdotool, true), 'xdotool');

  const noneAvailable = () => false;
  assert.equal(pickInsertTool('auto', noneAvailable, true), null);
});

test('pickInsertTool prefers xdotool then ydotool on X11', () => {
  const allAvailable = () => true;
  assert.equal(pickInsertTool('auto', allAvailable, false), 'xdotool');

  const noXdotool = (tool: string) => tool !== 'xdotool';
  assert.equal(pickInsertTool('auto', noXdotool, false), 'ydotool');

  const onlyWtype = (tool: string) => tool === 'wtype';
  assert.equal(pickInsertTool('auto', onlyWtype, false), null);
});

test('pickInsertTool respects explicit preferences', () => {
  const ydotoolOnly = (tool: string) => tool === 'ydotool';
  const preference: InsertPreference = 'ydotool';

  assert.equal(pickInsertTool(preference, ydotoolOnly, false), 'ydotool');
  assert.equal(pickInsertTool('xdotool', ydotoolOnly, false), null);
});

test('insertArgs safely formats arguments and prevents flag injection', () => {
  assert.deepEqual(insertArgs('xdotool', '--version'), [
    'type',
    '--clearmodifiers',
    '--delay',
    '2',
    '--',
    '--version',
  ]);

  assert.deepEqual(insertArgs('ydotool', 'hello world'), [
    'type',
    '--key-delay',
    '0',
    '--',
    'hello world',
  ]);

  assert.deepEqual(insertArgs('wtype', 'some transcript'), [
    '--',
    'some transcript',
  ]);
});

test('insertTextAtCursor handles empty or whitespace text', async () => {
  const empty = await insertTextAtCursor('');
  assert.equal(empty.success, true);
  assert.equal(empty.tool, 'none');

  const whitespace = await insertTextAtCursor('   \n  ');
  assert.equal(whitespace.success, true);
  assert.equal(whitespace.tool, 'none');
});

test('xdotool types the transcript and reports the tool used', async () => {
  await shim('xdotool', LOG_ARGS);

  const result = await insertTextAtCursor('Hello, world.', {
    tool: 'xdotool',
    delayMs: 0,
  });

  assert.deepEqual(result, { success: true, tool: 'xdotool' });
  assert.deepEqual(await typed(), [
    'type',
    '--clearmodifiers',
    '--delay',
    '2',
    '--',
    'Hello, world.',
  ]);
});

test('wtype falls back to xdotool when the compositor refuses', async () => {
  await shim('wtype', 'echo "no virtual keyboard protocol" >&2\nexit 1');
  await shim('xdotool', LOG_ARGS);

  const result = await insertTextAtCursor('hi', { tool: 'wtype', delayMs: 0 });

  assert.deepEqual(result, { success: true, tool: 'xdotool' });
  assert.equal((await typed()).at(-1), 'hi');
});

test('ydotool retries without --key-delay on older builds', async () => {
  await shim(
    'ydotool',
    'if [ "$2" = "--key-delay" ]; then\n  exit 1\nfi\n' + LOG_ARGS,
  );

  const result = await insertTextAtCursor('hi', {
    tool: 'ydotool',
    delayMs: 0,
  });

  assert.deepEqual(result, { success: true, tool: 'ydotool' });
  assert.deepEqual(await typed(), ['type', '--', 'hi']);
});

test('a failing tool returns its error and types nothing', async () => {
  await shim('xdotool', 'echo "cannot open display" >&2\nexit 1');

  const result = await insertTextAtCursor('hi', {
    tool: 'xdotool',
    delayMs: 0,
  });

  assert.equal(result.success, false);
  assert.equal(result.tool, 'xdotool');
  assert.match(result.error ?? '', /cannot open display/);
});

test('insertTextAtCursor reports error when tool is unavailable', async () => {
  const saved = process.env.PATH;
  process.env.PATH = path.join(binDir, 'empty');

  try {
    const result = await insertTextAtCursor('hello', {
      tool: 'xdotool',
      delayMs: 0,
    });

    assert.equal(result.success, false);
    assert.equal(result.tool, 'none');
    assert.ok(result.error?.includes('No typing tool found'));
  } finally {
    process.env.PATH = saved;
  }
});
