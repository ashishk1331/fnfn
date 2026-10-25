import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test, { after } from 'node:test';

import { loadConfig, saveSettings } from '../src/main/config';

const ENV_KEYS = [
  'FN_HOLD_KEY',
  'FN_HOLD_MS',
  'FN_MAX_MS',
  'CACTUS_CLI',
  'CACTUS_MODEL',
  'CACTUS_LANG',
  'NEEDLE_CLI',
  'NEEDLE_MODEL',
  'TINYFISH_API_KEY',
  'FFMPEG_PATH',
  'FN_KEEP_AUDIO',
  'FN_INSERT_TOOL',
];

const originalEnv = Object.fromEntries(
  ENV_KEYS.map((key) => [key, process.env[key]]),
);

for (const key of ENV_KEYS) {
  delete process.env[key];
}

after(() => {
  for (const key of ENV_KEYS) {
    const value = originalEnv[key];
    if (value === undefined) {
      delete process.env[key];
    } else {
      process.env[key] = value;
    }
  }
});

async function withTempDir(
  run: (directory: string) => Promise<void>,
): Promise<void> {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'fnfn-config-'));
  try {
    await run(directory);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}

test('the default hold key is Right Alt', async () => {
  await withTempDir(async (directory) => {
    const config = loadConfig(directory, '/opt/fnfn');

    assert.equal(config.holdKeyCode, 100);
    assert.equal(config.holdThresholdMs, 250);
    assert.equal(config.maxHoldMs, 120_000);
    assert.equal(config.cactusLanguage, 'auto');
    assert.ok(config.cactusModel.endsWith('whistle.cact'));
    assert.equal(config.needleCli, config.cactusCli);
    assert.ok(config.needleModel.endsWith('needle3.cact'));
    assert.equal(config.tinyfishApiKey, '');
    assert.equal(config.insertTool, 'auto');
    assert.equal(config.keepAudio, false);
  });
});

test('the Needle and TinyFish settings can be overridden', async () => {
  await withTempDir(async (directory) => {
    process.env.NEEDLE_CLI = '/tmp/needle3';
    process.env.NEEDLE_MODEL = '/tmp/models/needle3.cact';
    process.env.TINYFISH_API_KEY = 'tf_test_key';

    try {
      const config = loadConfig(directory, '/opt/fnfn');
      assert.equal(config.needleCli, '/tmp/needle3');
      assert.equal(config.needleModel, '/tmp/models/needle3.cact');
      assert.equal(config.tinyfishApiKey, 'tf_test_key');
    } finally {
      delete process.env.NEEDLE_CLI;
      delete process.env.NEEDLE_MODEL;
      delete process.env.TINYFISH_API_KEY;
    }
  });
});

test('a saved TinyFish key is trimmed and the Space key is rejected', async () => {
  await withTempDir(async (directory) => {
    saveSettings(directory, {
      tinyfishApiKey: '  tf_saved  ',
      holdKeyCode: 57,
    });

    const config = loadConfig(directory, '/opt/fnfn');
    assert.equal(config.tinyfishApiKey, 'tf_saved');
    assert.equal(config.holdKeyCode, 100);
  });
});

test('the Whistle engine paths can be overridden', async () => {
  await withTempDir(async (directory) => {
    process.env.CACTUS_CLI = '/tmp/needle';
    process.env.CACTUS_MODEL = '/tmp/whistle.cact';
    process.env.CACTUS_LANG = 'en';

    try {
      const config = loadConfig(directory, '/opt/fnfn');
      assert.equal(config.cactusCli, '/tmp/needle');
      assert.equal(config.cactusModel, '/tmp/whistle.cact');
      assert.equal(config.cactusLanguage, 'en');
    } finally {
      delete process.env.CACTUS_CLI;
      delete process.env.CACTUS_MODEL;
      delete process.env.CACTUS_LANG;
    }
  });
});

test('the insert tool can be forced from the environment', async () => {
  await withTempDir(async (directory) => {
    process.env.FN_INSERT_TOOL = 'ydotool';

    try {
      const config = loadConfig(directory, '/opt/fnfn');
      assert.equal(config.insertTool, 'ydotool');
    } finally {
      delete process.env.FN_INSERT_TOOL;
    }
  });
});

test('an unknown insert tool falls back to auto', async () => {
  await withTempDir(async (directory) => {
    saveSettings(directory, { insertTool: 'not-a-tool' as never });

    const config = loadConfig(directory, '/opt/fnfn');
    assert.equal(config.insertTool, 'auto');
  });
});

test('a learned key is persisted across reloads', async () => {
  await withTempDir(async (directory) => {
    saveSettings(directory, { holdKeyCode: 88 });

    const config = loadConfig(directory, '/opt/fnfn');
    assert.equal(config.holdKeyCode, 88);
  });
});

test('environment overrides win over saved settings', async () => {
  await withTempDir(async (directory) => {
    saveSettings(directory, { holdKeyCode: 88 });
    process.env.FN_HOLD_KEY = '100';

    try {
      const config = loadConfig(directory, '/opt/fnfn');
      assert.equal(config.holdKeyCode, 100);
    } finally {
      delete process.env.FN_HOLD_KEY;
    }
  });
});
