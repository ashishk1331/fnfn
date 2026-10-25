import { LoaderCircle, Mic, TriangleAlert } from 'lucide-react';

import type { Phase } from '@/hooks/use-push-to-talk';
import { cn } from '@/lib/utils';

const actionLabel: Record<Phase, string> = {
  idle: 'Hold to talk',
  pending: 'Keep holding',
  recording: 'Listening',
  transcribing: 'Transcribing',
  error: 'Try again',
};

const spokenLabel: Record<Phase, string> = {
  idle: 'Hold to talk',
  pending: 'Keep holding to start',
  recording: 'Listening, release to transcribe',
  transcribing: 'Transcribing',
  error: 'That take failed, try again',
};

interface HoldBarProps {
  keyName: string;
  phase: Phase;
  progress: number;
  onDown: () => void;
  onUp: () => void;
}

export function HoldBar({
  keyName,
  phase,
  progress,
  onDown,
  onUp,
}: HoldBarProps) {
  const clamped = Math.max(0, Math.min(1, progress));
  const active = phase === 'pending' || phase === 'recording';
  const busy = phase === 'transcribing';
  const failed = phase === 'error';
  const keycap =
    phase === 'recording'
      ? 'Release'
      : phase === 'transcribing'
        ? 'Wait'
        : keyName;
  const Icon = busy ? LoaderCircle : failed ? TriangleAlert : Mic;

  return (
    <button
      type="button"
      aria-label={`${spokenLabel[phase]} with ${keyName}`}
      aria-busy={busy}
      onPointerDown={(event) => {
        if (event.pointerType === 'mouse' && event.button !== 0) {
          return;
        }
        event.preventDefault();
        event.currentTarget.setPointerCapture(event.pointerId);
        onDown();
      }}
      onPointerUp={onUp}
      onPointerCancel={onUp}
      onLostPointerCapture={onUp}
      onBlur={onUp}
      onKeyDown={(event) => {
        if ((event.key === ' ' || event.key === 'Enter') && !event.repeat) {
          event.preventDefault();
          onDown();
        }
      }}
      onKeyUp={(event) => {
        if (event.key === ' ' || event.key === 'Enter') {
          event.preventDefault();
          onUp();
        }
      }}
      className={cn(
        'surface group relative flex h-[80px] w-full shrink-0 touch-none items-center gap-3.5 overflow-hidden rounded-2xl px-4 text-left outline-none transition-colors duration-200 ease-out select-none focus-visible:outline-2 focus-visible:outline-offset-3 focus-visible:outline-orange',
        active && 'border-orange/40 bg-orange-soft/25',
        failed && 'border-danger/35 bg-panel-3',
        !active && !failed && 'hover:border-line-strong',
        busy && 'cursor-progress',
      )}
    >
      <span
        className={cn(
          'flex size-11 shrink-0 items-center justify-center rounded-full border transition-colors duration-200 ease-out',
          active && 'border-orange/40 bg-orange/10 text-orange',
          failed && 'border-danger/35 bg-panel-2 text-danger',
          !active && !failed && 'border-line bg-panel text-dim',
        )}
      >
        <Icon
          className={cn('size-[18px]', busy && 'animate-spin')}
          strokeWidth={1.7}
          aria-hidden="true"
        />
      </span>

      <span
        aria-live="polite"
        className="min-w-0 flex-1 truncate text-[13.5px] font-medium tracking-[-0.01em] text-ink"
      >
        {actionLabel[phase]}
      </span>

      <kbd
        className={cn(
          'inline-flex h-8 shrink-0 items-center justify-center rounded-full border px-3 font-mono text-[9px] font-medium tracking-[0.11em] uppercase',
          active && 'border-orange/35 bg-orange/10 text-orange',
          failed && 'border-danger/30 bg-panel-2 text-danger',
          !active && !failed && 'border-line-strong bg-panel text-dim',
        )}
      >
        {keycap}
      </kbd>

      <span
        aria-hidden="true"
        className="absolute inset-x-0 bottom-0 h-[2px] bg-line"
      >
        <span
          className="block h-full bg-orange"
          style={{ width: `${clamped * 100}%` }}
        />
      </span>
    </button>
  );
}
