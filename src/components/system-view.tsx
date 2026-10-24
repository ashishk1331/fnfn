import type { ComponentProps, ReactNode } from 'react';
import { Keyboard, LoaderCircle, Mic, TriangleAlert } from 'lucide-react';

import { NoteLine } from '@/components/note-line';
import type { Note } from '@/hooks/use-push-to-talk';
import { cn } from '@/lib/utils';
import { keyLabel } from '@/shared/keycodes';
import type { InputStatus, SttInfo } from '@/shared/types';

interface SystemViewProps {
  status: InputStatus | null;
  sttInfo: SttInfo | null;
  startupError: string | null;
  note: Note | null;
  micReady: boolean;
  onToggleLearn: () => void;
  onEnableMic: () => void;
}

function Row({
  label,
  value,
  mono = false,
  tone = 'default',
  children,
}: {
  label: string;
  value: string;
  mono?: boolean;
  tone?: 'default' | 'warn' | 'error';
  children?: ReactNode;
}) {
  return (
    <div className="flex min-h-[52px] items-center gap-4 border-b border-line/80 px-4 py-3 last:border-b-0">
      <dt className="w-20 shrink-0 text-[9px] font-medium tracking-[0.13em] text-faint uppercase">
        {label}
      </dt>
      <dd
        className={cn(
          'min-w-0 flex-1 text-right text-xs break-words text-ink',
          mono && 'font-mono text-[10px] leading-relaxed text-dim',
          tone === 'warn' && 'text-orange',
          tone === 'error' && 'text-danger',
        )}
      >
        {value}
      </dd>
      {children && <div className="shrink-0">{children}</div>}
    </div>
  );
}

function ActionButton({ children, ...props }: ComponentProps<'button'>) {
  return (
    <button
      type="button"
      {...props}
      className="inline-flex h-9 items-center gap-1.5 rounded-lg border border-line-strong bg-panel-3 px-3 text-[10px] font-medium tracking-[0.1em] text-dim uppercase outline-none transition-colors duration-200 ease-out hover:border-orange/50 hover:text-orange focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-orange disabled:cursor-default disabled:border-line disabled:text-faint disabled:hover:border-line disabled:hover:text-faint"
    >
      {children}
    </button>
  );
}

function Banner({
  tone,
  title,
  detail,
  children,
}: {
  tone: 'warn' | 'error';
  title: string;
  detail?: string;
  children?: ReactNode;
}) {
  return (
    <div
      role="alert"
      className={cn(
        'rounded-2xl border px-4 py-3',
        tone === 'warn'
          ? 'border-orange/30 bg-orange-soft/40'
          : 'border-danger/30 bg-panel-2',
      )}
    >
      <div
        className={cn(
          'flex items-center gap-2 text-[11px] font-medium',
          tone === 'warn' ? 'text-orange' : 'text-danger',
        )}
      >
        <TriangleAlert
          className="size-3.5 shrink-0"
          strokeWidth={1.7}
          aria-hidden="true"
        />
        {title}
      </div>
      {detail && (
        <p className="mt-1.5 text-[10px] leading-relaxed break-words text-dim">
          {detail}
        </p>
      )}
      {children}
    </div>
  );
}

export function SystemView({
  status,
  sttInfo,
  startupError,
  note,
  micReady,
  onToggleLearn,
  onEnableMic,
}: SystemViewProps) {
  const key = status?.holdKey;
  const learning = Boolean(status?.learning);
  const canLearn = (status?.reading.length ?? 0) > 0;
  const inputLabel =
    status?.state === 'ready'
      ? 'Ready'
      : status?.state === 'degraded'
        ? 'No access'
        : status?.state === 'unsupported'
          ? 'Unavailable'
          : status?.state === 'error'
            ? 'Error'
            : 'Starting';
  const inputTone =
    status?.state === 'degraded' || status?.state === 'unsupported'
      ? 'warn'
      : status?.state === 'error'
        ? 'error'
        : 'default';
  return (
    <div className="flex flex-col gap-4">
      {startupError && (
        <Banner
          tone="error"
          title="App bridge unavailable"
          detail={startupError}
        />
      )}

      {!startupError && status?.state === 'degraded' && (
        <Banner tone="warn" title="Keyboard access off">
          <code className="mt-2 block w-fit rounded-md border border-line bg-panel px-2 py-1 font-mono text-[10px] text-orange">
            sudo usermod -aG input $USER
          </code>
        </Banner>
      )}

      {!startupError && status?.state === 'unsupported' && (
        <Banner tone="warn" title="Global key off" />
      )}

      {!startupError && status?.state === 'error' && (
        <Banner tone="error" title="Input error" detail={status.message} />
      )}

      <dl className="overflow-hidden rounded-2xl border border-line bg-panel-2">
        <Row label="Hold key" value={key ? keyLabel(key.code) : '—'}>
          <ActionButton
            onClick={onToggleLearn}
            disabled={
              !learning && (!canLearn || status?.state === 'unsupported')
            }
            title={
              learning
                ? 'Cancel'
                : !canLearn
                  ? 'No readable keyboard'
                  : 'Change hold key'
            }
          >
            {learning ? (
              <LoaderCircle
                className="size-3.5 animate-spin"
                aria-hidden="true"
              />
            ) : (
              <Keyboard className="size-3.5" aria-hidden="true" />
            )}
            {learning ? 'Press a key…' : 'Change'}
          </ActionButton>
        </Row>

        <Row label="Keyboard" value={inputLabel} tone={inputTone} />

        <Row label="Microphone" value={micReady ? 'Ready' : 'Off'}>
          {!micReady && (
            <ActionButton onClick={onEnableMic}>
              <Mic className="size-3.5" aria-hidden="true" />
              Enable
            </ActionButton>
          )}
        </Row>

        <Row label="Engine" value={sttInfo?.engine ?? '—'} />

        <Row label="Model" value={sttInfo?.model ?? '—'} mono />
      </dl>

      {note && <NoteLine note={note} />}
    </div>
  );
}
