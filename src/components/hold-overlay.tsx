import { useEffect, useState } from 'react';
import { Globe2, TriangleAlert } from 'lucide-react';

import { OVERLAY_BARS } from '@/lib/levels';
import { hostLabel } from '@/shared/search';
import type { OverlayPhase, OverlayState } from '@/shared/types';

const INITIAL: OverlayState = {
  phase: 'idle',
  mode: 'dictate',
  levels: Array.from({ length: OVERLAY_BARS }, () => 0),
};

const label: Record<OverlayPhase, string> = {
  idle: 'Ready',
  pending: 'Hold',
  recording: 'Listening',
  transcribing: 'Writing',
  searching: 'Searching',
  reading: 'Reading',
  answering: 'Answering',
  done: 'Answer',
  error: 'Problem',
};

function Waveform({ levels }: { levels: number[] }) {
  const lastIndex = levels.length - 1;

  return (
    <div
      aria-hidden="true"
      className="flex h-5 flex-1 items-center justify-end gap-[2px] overflow-hidden"
    >
      {levels.map((level, index) => (
        <span
          key={index}
          className={
            index === lastIndex ? 'overlay-bar overlay-bar-head' : 'overlay-bar'
          }
          style={{ height: `${3 + Math.round(level * 16)}px` }}
        />
      ))}
    </div>
  );
}

function ResultCard({ state }: { state: OverlayState }) {
  const failed = state.phase === 'error';
  const sources = (state.sources ?? []).slice(0, 3);

  return (
    <div
      role="status"
      aria-live="polite"
      className="overlay-card flex h-dvh flex-col gap-1.5 px-4 py-3"
    >
      <div className="flex items-center gap-2">
        {failed ? (
          <TriangleAlert
            className="size-3.5 shrink-0 text-danger"
            strokeWidth={1.7}
            aria-hidden="true"
          />
        ) : (
          <Globe2
            className="size-3.5 shrink-0 text-accent"
            strokeWidth={1.7}
            aria-hidden="true"
          />
        )}
        <span className="text-[9px] font-medium tracking-[0.14em] text-dim uppercase">
          {failed ? 'Search failed' : 'Web answer'}
        </span>
        <span className="ml-auto max-w-[180px] truncate text-[9px] text-faint">
          {sources[0] ? hostLabel(sources[0].url) : ''}
        </span>
      </div>

      {state.query && (
        <p className="truncate text-[10px] leading-none text-dim">
          {state.query}
        </p>
      )}

      <p
        className={
          failed
            ? 'overlay-answer text-[12px] leading-[1.5] text-danger'
            : 'overlay-answer text-[13px] leading-[1.5] text-ink'
        }
      >
        {state.answer ?? state.message ?? 'No answer was found.'}
      </p>

      <div className="mt-auto flex min-h-0 items-center gap-1.5 overflow-hidden border-t border-white/10 pt-1.5">
        {sources.map((source) => (
          <span
            key={source.url}
            title={source.title}
            className="max-w-[130px] truncate rounded border border-white/10 px-1.5 py-0.5 text-[9px] text-dim"
          >
            {hostLabel(source.url)}
          </span>
        ))}
        <span className="ml-auto shrink-0 text-[9px] tracking-[0.1em] text-faint uppercase">
          fnfn
        </span>
      </div>
    </div>
  );
}

export function HoldOverlay() {
  const [state, setState] = useState<OverlayState>(INITIAL);

  useEffect(() => {
    const root = document.documentElement;
    root.classList.add('overlay-surface');
    return () => root.classList.remove('overlay-surface');
  }, []);

  useEffect(() => {
    if (typeof window.fnfn?.onOverlayUpdate !== 'function') {
      return;
    }
    return window.fnfn.onOverlayUpdate(setState);
  }, []);

  if (state.phase === 'done' || state.phase === 'error') {
    return <ResultCard state={state} />;
  }

  const recording = state.phase === 'recording' || state.phase === 'pending';
  const search = state.mode === 'search';
  const searching =
    state.phase === 'searching' ||
    state.phase === 'reading' ||
    state.phase === 'answering';

  if (search && !recording) {
    return (
      <div
        role="status"
        aria-live="polite"
        aria-label={`Web search, ${label[state.phase].toLowerCase()}`}
        className="overlay-card flex h-dvh items-center gap-2.5 px-3"
      >
        <span
          aria-hidden="true"
          className={searching ? 'overlay-dot overlay-dot-busy' : 'overlay-dot'}
        />
        <span className="w-[68px] shrink-0 text-[9px] font-medium tracking-[0.12em] text-dim uppercase">
          {label[state.phase]}
        </span>
        <span className="min-w-0 flex-1 truncate text-[10px] text-faint">
          {state.message ?? state.query ?? 'Searching the web…'}
        </span>
        <span className="shrink-0 rounded border border-accent/35 px-1.5 py-0.5 text-[8px] font-medium tracking-[0.12em] text-accent uppercase">
          Web
        </span>
      </div>
    );
  }

  return (
    <div
      role="status"
      aria-live="polite"
      aria-label={`${search ? 'Web search' : 'Dictation'} ${label[
        state.phase
      ].toLowerCase()}`}
      className="overlay-card flex h-dvh items-center gap-2.5 px-3"
    >
      <span
        aria-hidden="true"
        className={
          recording
            ? 'overlay-dot overlay-dot-live'
            : state.phase === 'transcribing'
              ? 'overlay-dot overlay-dot-busy'
              : 'overlay-dot'
        }
      />

      <span className="w-[60px] shrink-0 text-[9px] font-medium tracking-[0.12em] text-dim uppercase">
        {label[state.phase]}
      </span>

      <Waveform levels={state.levels} />

      {search && (
        <span className="shrink-0 rounded border border-accent/35 px-1.5 py-0.5 text-[8px] font-medium tracking-[0.12em] text-accent uppercase">
          Web
        </span>
      )}
    </div>
  );
}
