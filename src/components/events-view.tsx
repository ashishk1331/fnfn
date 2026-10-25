import { useEffect, useState } from 'react';
import { List } from 'lucide-react';

import { PageHeader } from '@/components/page-header';
import { Pill } from '@/components/pill';
import type { HistoryEntry } from '@/shared/types';

function formatTime(timestamp: number): {
  date: string | null;
  time: string;
} {
  const date = new Date(timestamp);
  const now = new Date();
  const sameDay = date.toDateString() === now.toDateString();

  return {
    date: sameDay
      ? null
      : date.toLocaleDateString([], { month: 'short', day: 'numeric' }),
    time: date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
  };
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
    <div className="flex min-h-0 flex-1 flex-col gap-5">
      <PageHeader
        title="Events"
        description="Finished transcripts, newest first. They stay in this app on this machine."
        actions={
          history.length > 0 ? (
            <>
              <Pill>
                {history.length}{' '}
                {history.length === 1 ? 'transcript' : 'transcripts'}
              </Pill>
              <button
                type="button"
                onClick={() => void clearAll()}
                className="inline-flex h-7 items-center rounded-full px-2.5 font-mono text-[9px] tracking-[0.11em] text-faint uppercase outline-none transition-colors hover:bg-panel-2 hover:text-danger focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-orange"
              >
                Clear all
              </button>
            </>
          ) : undefined
        }
      />

      <section
        aria-label="Transcriptions"
        className="surface flex min-h-0 flex-1 flex-col overflow-hidden rounded-2xl"
      >
        {loaded && history.length === 0 ? (
          <div className="flex flex-1 items-center justify-center px-6">
            <div className="flex flex-col items-center gap-3 text-center">
              <span className="flex size-16 items-center justify-center rounded-full border border-line bg-panel-3/50 text-faint">
                <List className="size-6" strokeWidth={1.6} aria-hidden="true" />
              </span>
              <div>
                <p className="text-[13px] font-medium text-dim">
                  No transcripts yet
                </p>
                <p className="mt-1 max-w-[34ch] text-[11px] leading-relaxed text-faint">
                  Hold the key, speak, and release. Every finished take lands
                  here.
                </p>
              </div>
            </div>
          </div>
        ) : (
          <div className="min-h-0 flex-1 overflow-y-auto">
            {history.map((entry) => {
              const stamp = formatTime(entry.timestamp);
              return (
                <article
                  key={entry.id}
                  className="grid grid-cols-[88px_minmax(0,1fr)] gap-4 border-b border-line/70 px-5 py-4 transition-colors last:border-b-0 hover:bg-panel-3/25"
                >
                  <time className="pt-0.5 font-mono text-[9.5px] leading-relaxed tabular-nums text-faint">
                    {stamp.date && (
                      <span className="block text-dim">{stamp.date}</span>
                    )}
                    <span className="block">{stamp.time}</span>
                  </time>
                  <p className="min-w-0 text-[13.5px] leading-relaxed break-words text-ink">
                    {entry.text}
                  </p>
                </article>
              );
            })}
          </div>
        )}
      </section>
    </div>
  );
}
