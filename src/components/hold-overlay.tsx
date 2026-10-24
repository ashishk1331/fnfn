import { useEffect, useState } from 'react';

import { OVERLAY_BARS } from '@/lib/levels';
import type { OverlayPhase, OverlayState } from '@/shared/types';

const INITIAL: OverlayState = {
  phase: 'idle',
  levels: Array.from({ length: OVERLAY_BARS }, () => 0),
};

const label: Record<OverlayPhase, string> = {
  idle: 'Ready',
  pending: 'Hold',
  recording: 'Listening',
  transcribing: 'Writing',
};

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

  const listening = state.phase === 'recording' || state.phase === 'pending';
  const lastIndex = state.levels.length - 1;

  return (
    <div
      role="status"
      aria-live="polite"
      aria-label={`Dictation ${label[state.phase].toLowerCase()}`}
      className="overlay-card flex h-dvh items-center gap-2.5 px-3"
    >
      <span
        aria-hidden="true"
        className={
          listening
            ? 'overlay-dot overlay-dot-live'
            : state.phase === 'transcribing'
              ? 'overlay-dot overlay-dot-busy'
              : 'overlay-dot'
        }
      />

      <span className="w-[60px] shrink-0 text-[9px] font-medium tracking-[0.12em] text-dim uppercase">
        {label[state.phase]}
      </span>

      <div
        aria-hidden="true"
        className="flex h-5 flex-1 items-center justify-end gap-[2px] overflow-hidden"
      >
        {state.levels.map((level, index) => (
          <span
            key={index}
            className={
              index === lastIndex
                ? 'overlay-bar overlay-bar-head'
                : 'overlay-bar'
            }
            style={{ height: `${3 + Math.round(level * 16)}px` }}
          />
        ))}
      </div>
    </div>
  );
}
