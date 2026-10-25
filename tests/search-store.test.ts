import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { SearchStore } from '../src/main/search-store';
import type { SearchResult } from '../src/shared/types';

async function withTempDir(
  run: (directory: string) => Promise<void>,
): Promise<void> {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'fnfn-search-'));
  try {
    await run(directory);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}

function result(query: string): SearchResult {
  return {
    spoken: `search ${query}`,
    query,
    answer: `Answer about ${query}.`,
    sources: [
      {
        title: 'Example',
        url: 'https://example.com',
        site: 'example.com',
      },
    ],
    confidence: 0.8,
    elapsedMs: 1200,
    fallback: false,
  };
}

test('SearchStore starts empty and keeps the newest entry first', async () => {
  await withTempDir(async (dir) => {
    const store = new SearchStore(dir);
    assert.deepEqual(store.getAll(), []);

    const first = store.add(result('first'));
    const second = store.add(result('second'));

    const all = store.getAll();
    assert.equal(all.length, 2);
    assert.equal(all[0].id, second.id);
    assert.equal(all[0].query, 'second');
    assert.equal(all[1].id, first.id);
  });
});

test('SearchStore persists entries across reloads', async () => {
  await withTempDir(async (dir) => {
    const store1 = new SearchStore(dir);
    store1.add(result('capital of rome'));

    const store2 = new SearchStore(dir);
    const loaded = store2.getAll();
    assert.equal(loaded.length, 1);
    assert.equal(loaded[0].answer, 'Answer about capital of rome.');
    assert.equal(loaded[0].sources[0].url, 'https://example.com');
  });
});

test('SearchStore clears and caps entries', async () => {
  await withTempDir(async (dir) => {
    const store = new SearchStore(dir);
    for (let index = 0; index < 55; index += 1) {
      store.add(result(`query ${index}`));
    }

    assert.equal(store.getAll().length, 50);
    assert.equal(store.getAll()[0].query, 'query 54');

    store.clear();
    assert.equal(store.getAll().length, 0);
    assert.equal(new SearchStore(dir).getAll().length, 0);
  });
});

test('SearchStore ignores a corrupt file', async () => {
  await withTempDir(async (dir) => {
    await writeFile(path.join(dir, 'fnfn-searches.json'), '{not json', 'utf8');
    assert.deepEqual(new SearchStore(dir).getAll(), []);
  });
});
