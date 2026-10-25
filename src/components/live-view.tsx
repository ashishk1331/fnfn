import { useEffect, useState } from 'react';
import { Check, Copy, LoaderCircle, Mic, TriangleAlert } from 'lucide-react';

import { HoldBar } from '@/components/hold-bar';
import { NoteLine } from '@/components/note-line';
import type { Note, Phase, TranscriptView } from '@/hooks/use-push-to-talk';
import { cn } from '@/lib/utils';
import { keyLabel } from '@/shared/keycodes';
import type { InputStatus } from '@/shared/types';

interface LiveViewProps {
  status: InputStatus | null;
  startupError: string | null;
  phase: Phase;
  progress: number;
  note: Note | null;
  transcript: TranscriptView;
  onSimulateDown: () => void;
  onSimulateUp: () => void;
}

function InputState({
  status,
  startupError,
}: {
  status: InputStatus | null;
  startupError: string | null;
}) {
  if (startupError) {
    return (
      <div
        role="alert"
        className="mb-4 flex items-center gap-2 text-[11px] text-danger"
      >
        <TriangleAlert
          className="size-3.5 shrink-0"
          strokeWidth={1.7}
          aria-hidden="true"
        />
        <span>App bridge unavailable</span>
        <a
          href="#system"
          className="ml-auto text-dim underline decoration-line-strong underline-offset-4 hover:text-ink"
        >
          System
        </a>
      </div>
    );
  }

  if (!status || status.state === 'ready' || status.state === 'starting') {
    return null;
  }

  const label =
    status.state === 'degraded'
      ? 'Keyboard access off'
      : status.state === 'unsupported'
        ? 'Global key off'
        : 'Input error';

  return (
    <div
      role="status"
      className={cn(
        'mb-4 flex items-center gap-2 text-[11px]',
        status.state === 'error' ? 'text-danger' : 'text-warn',
      )}
    >
      <TriangleAlert
        className="size-3.5 shrink-0"
        strokeWidth={1.7}
        aria-hidden="true"
      />
      <span>{label}</span>
      <a
        href="#system"
        className="ml-auto text-dim underline decoration-line-strong underline-offset-4 hover:text-ink"
      >
        System
      </a>
    </div>
  );
}

function EmptyState({ phase }: { phase: Phase }) {
  const active = phase === 'pending' || phase === 'recording';
  const busy = phase === 'transcribing';
  const failed = phase === 'error';

  return (
    <div className="flex flex-1 items-center justify-center">
      <div
        className={cn(
          'flex size-[68px] items-center justify-center rounded-full border transition-colors duration-300',
          active && 'border-rec/45 bg-rec-soft/35 text-rec',
          failed && 'border-danger/40 bg-panel-2 text-danger',
          !active && !failed && 'border-line bg-panel-2 text-faint',
        )}
      >
        {busy ? (
          <LoaderCircle
            className="size-6 animate-spin"
            strokeWidth={1.6}
            aria-hidden="true"
          />
        ) : failed ? (
          <TriangleAlert
            className="size-6"
            strokeWidth={1.6}
            aria-hidden="true"
          />
        ) : (
          <Mic className="size-6" strokeWidth={1.6} aria-hidden="true" />
        )}
      </div>
    </div>
  );
}

export function LiveView({
  status,
  startupError,
  phase,
  progress,
  note,
  transcript,
  onSimulateDown,
  onSimulateUp,
}: LiveViewProps) {
  const [copied, setCopied] = useState(false);
  const [copyFailed, setCopyFailed] = useState(false);
  const keyCode = status?.holdKey.code ?? 100;
  const key = keyLabel(keyCode);
  const trimmed = transcript.text.trim();
  const hasText = !transcript.empty && Boolean(trimmed);
  const canCopy = Boolean(
    transcript.text && !transcript.empty && !transcript.error,
  );

  useEffect(() => {
    if (!copied && !copyFailed) {
      return;
    }

    const timer = window.setTimeout(() => {
      setCopied(false);
      setCopyFailed(false);
    }, 2500);
    return () => window.clearTimeout(timer);
  }, [copied, copyFailed]);

  const copyTranscript = async (): Promise<void> => {
    if (!canCopy) {
      return;
    }

    const write = async (): Promise<void> => {
      if (typeof window.fnfn?.copyText === 'function') {
        await window.fnfn.copyText(transcript.text);
        return;
      }
      await navigator.clipboard.writeText(transcript.text);
    };

    try {
      await write();
      setCopyFailed(false);
      setCopied(true);
    } catch {
      try {
        await navigator.clipboard.writeText(transcript.text);
        setCopyFailed(false);
        setCopied(true);
      } catch {
        setCopied(false);
        setCopyFailed(true);
      }
    }
  };

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <InputState status={status} startupError={startupError} />

      <section
        aria-label="Transcript"
        className="flex min-h-0 flex-1 flex-col overflow-hidden"
      >
        {canCopy && (
          <div className="flex shrink-0 justify-end pb-4">
            <button
              type="button"
              onClick={() => void copyTranscript()}
              title="Copy transcript"
              className="inline-flex h-10 items-center gap-2 rounded-lg border border-line bg-panel-2 px-3.5 text-[10px] font-medium tracking-[0.1em] text-dim uppercase outline-none transition-colors duration-200 ease-out hover:border-line-strong hover:text-ink focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
            >
              {copied ? (
                <Check
                  className="size-3.5"
                  strokeWidth={1.7}
                  aria-hidden="true"
                />
              ) : copyFailed ? (
                <TriangleAlert
                  className="size-3.5"
                  strokeWidth={1.7}
                  aria-hidden="true"
                />
              ) : (
                <Copy
                  className="size-3.5"
                  strokeWidth={1.7}
                  aria-hidden="true"
                />
              )}
              <span aria-live="polite">
                {copied ? 'Copied' : copyFailed ? 'Copy failed' : 'Copy'}
              </span>
            </button>
          </div>
        )}

        <div
          aria-live="polite"
          aria-atomic="true"
          aria-busy={phase === 'transcribing'}
          className="flex min-h-0 flex-1 flex-col overflow-y-auto pr-1"
        >
          {hasText ? (
            <p
              className={cn(
                'max-w-[62ch] text-[17px] leading-[1.7] break-words whitespace-pre-wrap text-ink',
                transcript.error && 'text-danger',
              )}
            >
              {transcript.text}
            </p>
          ) : (
            <EmptyState phase={phase} />
          )}
        </div>
      </section>

      {note && <NoteLine note={note} />}

      <div className="mt-4 shrink-0">
        <HoldBar
          keyName={key}
          phase={phase}
          progress={progress}
          onDown={onSimulateDown}
          onUp={onSimulateUp}
        />
      </div>
    </div>
  );
}
