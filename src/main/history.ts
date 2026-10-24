import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';

import type { HistoryEntry } from '../shared/types';

const HISTORY_FILE = 'fnfn-history.json';
const MAX_HISTORY_ENTRIES = 200;

export class HistoryStore {
  private readonly filePath: string;
  private entries: HistoryEntry[] | null = null;

  constructor(private readonly userDataDir: string) {
    this.filePath = path.join(userDataDir, HISTORY_FILE);
  }

  getAll(): HistoryEntry[] {
    if (this.entries === null) {
      this.entries = this.load();
    }
    return [...this.entries];
  }

  add(entry: Omit<HistoryEntry, 'id' | 'timestamp'>): HistoryEntry {
    const list = this.getAll();
    const newEntry: HistoryEntry = {
      id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      timestamp: Date.now(),
      ...entry,
    };

    this.entries = [newEntry, ...list].slice(0, MAX_HISTORY_ENTRIES);
    this.persist();
    return newEntry;
  }

  clear(): void {
    this.entries = [];
    this.persist();
  }

  private load(): HistoryEntry[] {
    try {
      if (!existsSync(this.filePath)) {
        return [];
      }
      const raw = readFileSync(this.filePath, 'utf8');
      const parsed: unknown = JSON.parse(raw);
      if (Array.isArray(parsed)) {
        return parsed.filter(
          (item): item is HistoryEntry =>
            item !== null &&
            typeof item === 'object' &&
            typeof (item as Record<string, unknown>).id === 'string' &&
            typeof (item as Record<string, unknown>).text === 'string' &&
            typeof (item as Record<string, unknown>).timestamp === 'number',
        );
      }
    } catch {
      // Fall back to empty on first run or corrupt file
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
      console.error('[history] failed to save history', error);
    }
  }
}
