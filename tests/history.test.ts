import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { HistoryStore } from '../src/main/history';

async function withTempDir(
  run: (directory: string) => Promise<void>,
): Promise<void> {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'fnfn-history-'));
  try {
    await run(directory);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}

test('HistoryStore starts empty and appends entries in reverse chronological order', async () => {
  await withTempDir(async (dir) => {
    const store = new HistoryStore(dir);
    assert.deepEqual(store.getAll(), []);

    const e1 = store.add({ text: 'First dictation' });
    const e2 = store.add({ text: 'Second dictation' });

    const all = store.getAll();
    assert.equal(all.length, 2);
    assert.equal(all[0].id, e2.id);
    assert.equal(all[0].text, 'Second dictation');
    assert.equal(all[1].id, e1.id);
    assert.equal(all[1].text, 'First dictation');
  });
});

test('HistoryStore persists entries across store reloads', async () => {
  await withTempDir(async (dir) => {
    const store1 = new HistoryStore(dir);
    store1.add({ text: 'Persistent entry' });

    const store2 = new HistoryStore(dir);
    const loaded = store2.getAll();
    assert.equal(loaded.length, 1);
    assert.equal(loaded[0].text, 'Persistent entry');
  });
});

test('HistoryStore clears all entries', async () => {
  await withTempDir(async (dir) => {
    const store = new HistoryStore(dir);
    store.add({ text: 'Item 1' });
    store.add({ text: 'Item 2' });

    assert.equal(store.getAll().length, 2);

    store.clear();
    assert.equal(store.getAll().length, 0);

    const reloaded = new HistoryStore(dir);
    assert.equal(reloaded.getAll().length, 0);
  });
});
