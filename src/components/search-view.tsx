import { useEffect, useState } from 'react';
import { Globe2, TriangleAlert } from 'lucide-react';

import { describeError } from '@/lib/format';
import { hostLabel } from '@/shared/search';
import type { SearchEntry } from '@/shared/types';

function formatTime(timestamp: number): string {
  const date = new Date(timestamp);
  const now = new Date();
  const sameDay = date.toDateString() === now.toDateString();

  return date.toLocaleString(
    [],
    sameDay
      ? { hour: '2-digit', minute: '2-digit' }
      : { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' },
  );
}

export function SearchView() {
  const [entries, setEntries] = useState<SearchEntry[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;

    const load = (): void => {
      if (typeof window.fnfn?.getSearches !== 'function') {
        setLoaded(true);
        return;
      }
      void window.fnfn
        .getSearches()
        .then((list) => {
          if (active) {
            setEntries(list);
            setLoaded(true);
          }
        })
        .catch((failure: unknown) => {
          if (active) {
            setError(describeError(failure));
            setLoaded(true);
          }
        });
    };

    load();
    const off = window.fnfn?.onSearchChanged?.(load);

    return () => {
      active = false;
      off?.();
    };
  }, []);

  const clearAll = async (): Promise<void> => {
    if (typeof window.fnfn?.clearSearches !== 'function') {
      return;
    }
    try {
      await window.fnfn.clearSearches();
      setEntries([]);
      setError(null);
    } catch (failure) {
      setError(describeError(failure));
    }
  };

  const openSource = async (url: string): Promise<void> => {
    if (typeof window.fnfn?.openExternal !== 'function') {
      return;
    }
    try {
      await window.fnfn.openExternal(url);
      setError(null);
    } catch (failure) {
      setError(describeError(failure));
    }
  };

  return (
    <section aria-label="Web searches" className="flex min-h-0 flex-1 flex-col">
      <div className="mb-2 flex shrink-0 items-center justify-between">
        <p className="text-[10px] tracking-[0.08em] text-faint uppercase">
          {entries.length === 0
            ? 'No searches yet'
            : `${entries.length} ${entries.length === 1 ? 'search' : 'searches'}`}
        </p>

        {entries.length > 0 && (
          <button
            type="button"
            onClick={() => void clearAll()}
            className="text-[10px] tracking-[0.08em] text-dim uppercase transition-colors hover:text-danger"
          >
            Clear all
          </button>
        )}
      </div>

      {error && (
        <div
          role="alert"
          className="mb-3 flex items-center gap-2 rounded-xl border border-danger/30 bg-panel-2 px-3 py-2 text-[10px] text-danger"
        >
          <TriangleAlert
            className="size-3.5 shrink-0"
            strokeWidth={1.7}
            aria-hidden="true"
          />
          <span className="min-w-0 break-words">{error}</span>
        </div>
      )}

      {loaded && entries.length === 0 ? (
        <div className="flex flex-1 items-center justify-center">
          <p className="max-w-[40ch] text-center text-xs leading-relaxed text-faint">
            Hold your talk key with Space, ask a question, and the answer lands
            here with its sources.
          </p>
        </div>
      ) : (
        <div className="min-h-0 flex-1 overflow-y-auto">
          {entries.map((entry) => (
            <article
              key={entry.id}
              className="border-b border-line/70 py-4 first:pt-1 last:border-b-0"
            >
              <div className="flex min-w-0 items-center gap-2 text-[10px] text-faint">
                <Globe2
                  className="size-3 shrink-0 text-accent"
                  strokeWidth={1.7}
                  aria-hidden="true"
                />
                <time className="shrink-0 tabular-nums">
                  {formatTime(entry.timestamp)}
                </time>
                <span className="min-w-0 truncate text-dim">{entry.query}</span>
              </div>

              <p className="mt-2 text-[13px] leading-relaxed break-words text-ink">
                {entry.answer}
              </p>

              <div className="mt-2.5 flex flex-wrap gap-1.5">
                {entry.sources.map((source) => (
                  <button
                    key={source.url}
                    type="button"
                    title={source.title}
                    onClick={() => void openSource(source.url)}
                    className="inline-flex max-w-[220px] items-center gap-1 truncate rounded-md border border-line bg-panel-2 px-2 py-1 text-[10px] text-dim outline-none transition-colors duration-200 ease-out hover:border-accent/50 hover:text-accent focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
                  >
                    <span className="truncate">
                      {source.site || hostLabel(source.url)}
                    </span>
                  </button>
                ))}
              </div>

              <p className="mt-2 truncate text-[10px] text-faint">
                Heard: {entry.spoken}
              </p>
            </article>
          ))}
        </div>
      )}
    </section>
  );
}
