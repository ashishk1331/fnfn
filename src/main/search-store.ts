import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';

import type { SearchEntry, SearchResult } from '../shared/types';

const SEARCH_FILE = 'fnfn-searches.json';
const MAX_SEARCH_ENTRIES = 50;

function isSearchEntry(value: unknown): value is SearchEntry {
  if (!value || typeof value !== 'object') {
    return false;
  }

  const entry = value as Record<string, unknown>;
  return (
    typeof entry.id === 'string' &&
    typeof entry.timestamp === 'number' &&
    typeof entry.spoken === 'string' &&
    typeof entry.query === 'string' &&
    typeof entry.answer === 'string' &&
    typeof entry.confidence === 'number' &&
    typeof entry.elapsedMs === 'number' &&
    typeof entry.fallback === 'boolean' &&
    Array.isArray(entry.sources) &&
    entry.sources.every(
      (source) =>
        source !== null &&
        typeof source === 'object' &&
        typeof (source as Record<string, unknown>).title === 'string' &&
        typeof (source as Record<string, unknown>).url === 'string' &&
        typeof (source as Record<string, unknown>).site === 'string',
    )
  );
}

export class SearchStore {
  private readonly filePath: string;
  private entries: SearchEntry[] | null = null;

  constructor(private readonly userDataDir: string) {
    this.filePath = path.join(userDataDir, SEARCH_FILE);
  }

  getAll(): SearchEntry[] {
    if (this.entries === null) {
      this.entries = this.load();
    }
    return [...this.entries];
  }

  add(result: SearchResult): SearchEntry {
    const list = this.getAll();
    const entry: SearchEntry = {
      id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      timestamp: Date.now(),
      ...result,
    };

    this.entries = [entry, ...list].slice(0, MAX_SEARCH_ENTRIES);
    this.persist();
    return entry;
  }

  clear(): void {
    this.entries = [];
    this.persist();
  }

  private load(): SearchEntry[] {
    try {
      if (!existsSync(this.filePath)) {
        return [];
      }
      const parsed: unknown = JSON.parse(readFileSync(this.filePath, 'utf8'));
      if (Array.isArray(parsed)) {
        return parsed.filter(isSearchEntry);
      }
    } catch {
      // First run or a corrupt file: start empty.
    }
    return [];
  }

  private persist(): void {
    try {
      mkdirSync(this.userDataDir, { recursive: true });
      writeFileSync(
        this.filePath,
        `${JSON.stringify(this.entries ?? [], null, 2)}\n`,
        'utf8',
      );
    } catch (error) {
      console.error('[search] failed to save searches', error);
    }
  }
}
