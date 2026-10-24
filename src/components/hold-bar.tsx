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
        'group relative flex h-[76px] w-full shrink-0 touch-none items-center gap-3 overflow-hidden rounded-2xl border px-4 text-left outline-none transition-colors duration-200 ease-out select-none focus-visible:outline-2 focus-visible:outline-offset-3 focus-visible:outline-orange',
        active && 'border-orange/45 bg-orange-soft/35',
        failed && 'border-danger/40 bg-panel-3',
        !active && !failed && 'border-line bg-panel-3 hover:border-line-strong',
        busy && 'cursor-progress',
      )}
    >
      <span
        className={cn(
          'flex size-10 shrink-0 items-center justify-center rounded-full border transition-colors duration-200 ease-out',
          active && 'border-orange/50 bg-orange/10 text-orange',
          failed && 'border-danger/40 bg-panel-2 text-danger',
          !active && !failed && 'border-line bg-panel-2 text-dim',
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
        className="min-w-0 flex-1 truncate text-[13px] font-medium tracking-[-0.01em] text-ink"
      >
        {actionLabel[phase]}
      </span>

      <kbd
        className={cn(
          'inline-flex h-7 shrink-0 items-center justify-center rounded-md border px-2 text-[10px] font-medium tracking-[0.08em] uppercase',
          active && 'border-orange/40 bg-orange/10 text-orange',
          failed && 'border-danger/35 bg-panel-2 text-danger',
          !active && !failed && 'border-line-strong bg-panel-2 text-dim',
        )}
      >
        {keycap}
      </kbd>

      <span
        aria-hidden="true"
        className="absolute inset-x-0 bottom-0 h-px bg-line"
      >
        <span
          className="block h-full bg-orange"
          style={{ width: `${clamped * 100}%` }}
        />
      </span>
    </button>
  );
}
