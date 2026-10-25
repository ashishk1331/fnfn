import { useEffect, useState } from 'react';
import { Check, Copy, LoaderCircle, Mic, TriangleAlert } from 'lucide-react';

import { HoldBar } from '@/components/hold-bar';
import { NoteLine } from '@/components/note-line';
import { PageHeader } from '@/components/page-header';
import { Pill, StatusDot } from '@/components/pill';
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

function PhasePill({
  status,
  startupError,
  phase,
}: {
  status: InputStatus | null;
  startupError: string | null;
  phase: Phase;
}) {
  if (startupError) {
    return <Pill tone="danger">Unavailable</Pill>;
  }
  if (status?.state === 'degraded' || status?.state === 'unsupported') {
    return <Pill tone="live">Keyboard off</Pill>;
  }
  if (status?.state === 'error') {
    return <Pill tone="danger">Input error</Pill>;
  }
  if (phase === 'recording' || phase === 'pending') {
    return (
      <Pill tone="live">
        <StatusDot />
        {phase === 'recording' ? 'Listening' : 'Starting'}
      </Pill>
    );
  }
  if (phase === 'transcribing') {
    return (
      <Pill tone="neutral">
        <LoaderCircle
          className="size-3 animate-spin"
          strokeWidth={1.7}
          aria-hidden="true"
        />
        Transcribing
      </Pill>
    );
  }
  if (phase === 'error') {
    return <Pill tone="danger">Try again</Pill>;
  }
  if (!status || status.state === 'starting') {
    return <Pill tone="neutral">Starting</Pill>;
  }
  return (
    <Pill tone="success">
      <StatusDot tone="success" />
      Ready
    </Pill>
  );
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
        className="flex items-center gap-2 rounded-xl border border-danger/25 bg-danger/5 px-4 py-2.5 text-[11.5px] text-danger"
      >
        <TriangleAlert
          className="size-3.5 shrink-0"
          strokeWidth={1.7}
          aria-hidden="true"
        />
        <span>App bridge unavailable</span>
        <a
          href="#system"
          className="ml-auto rounded-full border border-danger/25 px-2.5 py-1 font-mono text-[9px] tracking-[0.1em] uppercase transition-colors hover:bg-danger/10"
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
        'flex items-center gap-2 rounded-xl border px-4 py-2.5 text-[11.5px]',
        status.state === 'error'
          ? 'border-danger/25 bg-danger/5 text-danger'
          : 'border-orange/25 bg-orange-soft/25 text-orange',
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
        className={cn(
          'ml-auto rounded-full border px-2.5 py-1 font-mono text-[9px] tracking-[0.1em] uppercase transition-colors',
          status.state === 'error'
            ? 'border-danger/25 hover:bg-danger/10'
            : 'border-orange/25 hover:bg-orange/10',
        )}
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
  const title = active
    ? 'Listening'
    : busy
      ? 'Transcribing'
      : failed
        ? 'That take failed'
        : 'Ready when you are';
  const hint = active
    ? 'Keep holding, then release to finish.'
    : busy
      ? 'The finished transcript lands here.'
      : failed
        ? 'Hold the key and try again.'
        : 'Hold the key and speak.';

  return (
    <div className="flex flex-1 items-center justify-center">
      <div className="flex flex-col items-center gap-3 text-center">
        <span
          className={cn(
            'flex size-16 items-center justify-center rounded-full border transition-colors duration-300',
            active && 'border-orange/40 bg-orange-soft/30 text-orange',
            failed && 'border-danger/35 bg-danger/5 text-danger',
            !active && !failed && 'border-line bg-panel-3/50 text-faint',
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
        </span>
        <div>
          <p className="text-[13px] font-medium text-dim">{title}</p>
          <p className="mt-1 text-[11px] text-faint">{hint}</p>
        </div>
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
    <div className="flex min-h-0 flex-1 flex-col gap-5">
      <PageHeader
        title="Live"
        description={`Hold ${key} and speak. Release to type it at your cursor.`}
        actions={
          <PhasePill
            status={status}
            startupError={startupError}
            phase={phase}
          />
        }
      />

      <InputState status={status} startupError={startupError} />

      <section
        aria-label="Transcript"
        className="surface flex min-h-0 flex-1 flex-col overflow-hidden rounded-2xl"
      >
        <div className="flex shrink-0 items-center justify-between gap-3 border-b border-line/70 px-5 py-3">
          <span className="font-mono text-[9px] tracking-[0.14em] text-faint uppercase">
            Transcript
          </span>
          {canCopy && (
            <button
              type="button"
              onClick={() => void copyTranscript()}
              title="Copy transcript"
              className="inline-flex h-8 items-center gap-1.5 rounded-full border border-line-strong bg-panel-3/50 px-3 font-mono text-[9px] font-medium tracking-[0.11em] text-dim uppercase outline-none transition-colors duration-200 ease-out hover:text-ink focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-orange"
            >
              {copied ? (
                <Check
                  className="size-3"
                  strokeWidth={1.8}
                  aria-hidden="true"
                />
              ) : copyFailed ? (
                <TriangleAlert
                  className="size-3"
                  strokeWidth={1.8}
                  aria-hidden="true"
                />
              ) : (
                <Copy className="size-3" strokeWidth={1.8} aria-hidden="true" />
              )}
              <span aria-live="polite">
                {copied ? 'Copied' : copyFailed ? 'Copy failed' : 'Copy'}
              </span>
            </button>
          )}
        </div>

        <div
          aria-live="polite"
          aria-atomic="true"
          aria-busy={phase === 'transcribing'}
          className="flex min-h-0 flex-1 flex-col overflow-y-auto px-5 py-5"
        >
          {hasText ? (
            <p
              className={cn(
                'max-w-[62ch] font-mono text-[16px] leading-[1.8] break-words whitespace-pre-wrap text-ink',
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

      <HoldBar
        keyName={key}
        phase={phase}
        progress={progress}
        onDown={onSimulateDown}
        onUp={onSimulateUp}
      />
    </div>
  );
}
