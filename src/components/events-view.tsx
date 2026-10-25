import { useEffect, useState } from 'react';

import type { HistoryEntry } from '@/shared/types';

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

export function EventsView() {
  const [history, setHistory] = useState<HistoryEntry[]>([]);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    let active = true;

    const load = (): void => {
      if (typeof window.fnfn?.getHistory !== 'function') {
        setLoaded(true);
        return;
      }
      void window.fnfn
        .getHistory()
        .then((list) => {
          if (active) {
            setHistory(list);
            setLoaded(true);
          }
        })
        .catch(() => {
          if (active) {
            setLoaded(true);
          }
        });
    };

    load();
    const off = window.fnfn?.onHistoryChange?.(load);

    return () => {
      active = false;
      off?.();
    };
  }, []);

  const clearAll = async (): Promise<void> => {
    if (typeof window.fnfn?.clearHistory !== 'function') {
      return;
    }
    await window.fnfn.clearHistory();
    setHistory([]);
  };

  return (
    <section
      aria-label="Transcriptions"
      className="flex min-h-0 flex-1 flex-col"
    >
      <div className="mb-2 flex shrink-0 items-center justify-between">
        <p className="text-[10px] tracking-[0.08em] text-faint uppercase">
          {history.length === 0
            ? 'No transcriptions yet'
            : `${history.length} ${history.length === 1 ? 'transcription' : 'transcriptions'}`}
        </p>

        {history.length > 0 && (
          <button
            type="button"
            onClick={() => void clearAll()}
            className="text-[10px] tracking-[0.08em] text-dim uppercase transition-colors hover:text-danger"
          >
            Clear all
          </button>
        )}
      </div>

      {loaded && history.length === 0 ? (
        <div className="flex flex-1 items-center justify-center">
          <p className="text-xs text-faint">
            Hold the key, speak, and release. Every transcript lands here.
          </p>
        </div>
      ) : (
        <div className="min-h-0 flex-1 overflow-y-auto">
          {history.map((entry) => (
            <div
              key={entry.id}
              className="grid grid-cols-[76px_minmax(0,1fr)] gap-3 border-b border-line/70 py-3 last:border-b-0"
            >
              <time className="pt-0.5 text-[10px] tabular-nums text-faint">
                {formatTime(entry.timestamp)}
              </time>
              <p className="min-w-0 text-xs leading-relaxed break-words text-ink">
                {entry.text}
              </p>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}
