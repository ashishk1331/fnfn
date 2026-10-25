import type { ComponentProps, ReactNode } from 'react';
import {
  AudioLines,
  Box,
  Cpu,
  Keyboard,
  LoaderCircle,
  LockKeyhole,
  Mic,
  TriangleAlert,
  Type,
  type LucideIcon,
} from 'lucide-react';

import { NoteLine } from '@/components/note-line';
import { PageHeader } from '@/components/page-header';
import { Pill } from '@/components/pill';
import type { Note } from '@/hooks/use-push-to-talk';
import type { TextRulesController } from '@/hooks/use-text-rules';
import { cn } from '@/lib/utils';
import { keyLabel } from '@/shared/keycodes';
import type { TextStyle } from '@/shared/text-rules';
import type { InputStatus, SttInfo } from '@/shared/types';

interface SystemViewProps {
  status: InputStatus | null;
  sttInfo: SttInfo | null;
  startupError: string | null;
  note: Note | null;
  micReady: boolean;
  text: TextRulesController;
  onToggleLearn: () => void;
  onEnableMic: () => void;
}

const STYLE_LABELS: Record<TextStyle, string> = {
  raw: 'As spoken',
  sentence: 'Sentence case',
  lower: 'lowercase',
  upper: 'UPPERCASE',
  title: 'Title Case',
};

function Row({
  label,
  value,
  icon: Icon,
  mono = false,
  tone = 'default',
  children,
}: {
  label: string;
  value: string;
  icon: LucideIcon;
  mono?: boolean;
  tone?: 'default' | 'warn' | 'error';
  children?: ReactNode;
}) {
  return (
    <div className="flex min-h-[58px] items-center gap-3 border-b border-line/70 px-5 py-3 last:border-b-0">
      <span className="flex size-8 shrink-0 items-center justify-center rounded-xl bg-panel-3/60 text-dim">
        <Icon className="size-4" strokeWidth={1.6} aria-hidden="true" />
      </span>
      <dt className="w-[84px] shrink-0 font-mono text-[9px] font-medium tracking-[0.13em] text-faint uppercase">
        {label}
      </dt>
      <dd
        className={cn(
          'min-w-0 flex-1 text-right text-[13px] break-words text-ink',
          mono && 'font-mono text-[11px] leading-relaxed text-dim',
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
      className="inline-flex h-8 items-center gap-1.5 rounded-full border border-line-strong bg-panel-3/50 px-3 font-mono text-[9px] font-medium tracking-[0.1em] text-dim uppercase outline-none transition-colors duration-200 ease-out hover:border-orange/40 hover:text-orange focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-orange disabled:cursor-default disabled:border-line disabled:text-faint disabled:hover:border-line disabled:hover:text-faint"
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
          ? 'border-orange/25 bg-orange-soft/25'
          : 'border-danger/25 bg-danger/5',
      )}
    >
      <div
        className={cn(
          'flex items-center gap-2 text-[11.5px] font-medium',
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
        <p className="mt-1.5 text-[10.5px] leading-relaxed break-words text-dim">
          {detail}
        </p>
      )}
      {children}
    </div>
  );
}

function RuleTextarea({
  label,
  hint,
  value,
  placeholder,
  onChange,
}: {
  label: string;
  hint: string;
  value: string;
  placeholder: string;
  onChange: (value: string) => void;
}) {
  return (
    <label className="block">
      <span className="font-mono text-[9px] font-medium tracking-[0.13em] text-faint uppercase">
        {label}
      </span>
      <span className="mt-1 block text-[11px] leading-relaxed text-faint">
        {hint}
      </span>
      <textarea
        value={value}
        placeholder={placeholder}
        spellCheck={false}
        rows={3}
        onChange={(event) => onChange(event.target.value)}
        className="mt-2 w-full resize-y rounded-xl border border-line bg-panel px-3.5 py-3 font-mono text-[11px] leading-relaxed text-ink outline-none transition-colors duration-200 ease-out placeholder:text-faint focus-visible:border-orange/60 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-orange"
      />
    </label>
  );
}

export function SystemView({
  status,
  sttInfo,
  startupError,
  note,
  micReady,
  text,
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
    <div className="flex flex-col gap-5">
      <PageHeader
        title="System"
        description="Keyboard, microphone, engine, and how every transcript is rewritten."
        actions={
          <Pill tone="success">
            <LockKeyhole
              className="size-3"
              strokeWidth={1.8}
              aria-hidden="true"
            />
            On device
          </Pill>
        }
      />

      {startupError && (
        <Banner
          tone="error"
          title="App bridge unavailable"
          detail={startupError}
        />
      )}

      {!startupError && status?.state === 'degraded' && (
        <Banner tone="warn" title="Keyboard access off">
          <code className="mt-2 block w-fit rounded-lg border border-line bg-panel px-2.5 py-1 font-mono text-[10px] text-orange">
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

      <dl className="surface overflow-hidden rounded-2xl">
        <Row
          label="Hold key"
          value={key ? keyLabel(key.code) : '—'}
          icon={Keyboard}
        >
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

        <Row
          label="Keyboard"
          value={inputLabel}
          icon={AudioLines}
          tone={inputTone}
        />

        <Row label="Microphone" value={micReady ? 'Ready' : 'Off'} icon={Mic}>
          {!micReady && (
            <ActionButton onClick={onEnableMic}>
              <Mic className="size-3.5" aria-hidden="true" />
              Enable
            </ActionButton>
          )}
        </Row>

        <Row label="Engine" value={sttInfo?.engine ?? '—'} icon={Cpu} />

        <Row label="Model" value={sttInfo?.model ?? '—'} icon={Box} mono />
      </dl>

      <section className="surface overflow-hidden rounded-2xl">
        <div className="border-b border-line/70 px-5 py-4">
          <h2 className="text-[14px] font-semibold tracking-[-0.01em] text-ink">
            Dictation text
          </h2>
          <p className="mt-1 text-[11px] leading-relaxed text-faint">
            Applied to every transcript before it is typed.
          </p>
        </div>

        <label className="flex min-h-[58px] items-center gap-3 border-b border-line/70 px-5 py-3">
          <span className="flex size-8 shrink-0 items-center justify-center rounded-xl bg-panel-3/60 text-dim">
            <Type className="size-4" strokeWidth={1.6} aria-hidden="true" />
          </span>
          <span className="w-[84px] shrink-0 font-mono text-[9px] font-medium tracking-[0.13em] text-faint uppercase">
            Style
          </span>
          <span className="min-w-0 flex-1 text-right text-[11px] text-faint">
            Capitalisation
          </span>
          <select
            value={text.style}
            onChange={(event) => text.setStyle(event.target.value as TextStyle)}
            className="h-9 shrink-0 rounded-full border border-line-strong bg-panel-3 px-3 text-[11px] text-ink outline-none transition-colors duration-200 ease-out hover:border-line-strong focus-visible:border-orange/60 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-orange"
          >
            {(Object.keys(STYLE_LABELS) as TextStyle[]).map((style) => (
              <option key={style} value={style}>
                {STYLE_LABELS[style]}
              </option>
            ))}
          </select>
        </label>

        <div className="flex flex-col gap-4 px-5 py-5">
          <RuleTextarea
            label="Dictionary"
            hint="Correct a word the engine mishears: heard = typed."
            value={text.dictionaryText}
            placeholder="cactus whistle = Cactus Whistle"
            onChange={text.setDictionaryText}
          />
          <RuleTextarea
            label="Snippets"
            hint="Expand a spoken phrase: say = insert."
            value={text.snippetsText}
            placeholder="my email = me@example.com"
            onChange={text.setSnippetsText}
          />
        </div>

        <div className="flex items-center gap-3 border-t border-line/70 px-5 py-4">
          <button
            type="button"
            onClick={() => void text.save()}
            disabled={text.saving || !text.dirty}
            className={cn(
              'inline-flex h-9 items-center rounded-full px-4 font-mono text-[9px] font-medium tracking-[0.12em] uppercase outline-none transition-colors duration-200 ease-out focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-orange disabled:cursor-default',
              text.saving || !text.dirty
                ? 'border border-line bg-panel-2 text-faint'
                : 'bg-orange text-orange-ink hover:bg-orange/90',
            )}
          >
            {text.saving && (
              <LoaderCircle className="mr-1.5 size-3 animate-spin" />
            )}
            {text.saving ? 'Saving…' : 'Save'}
          </button>
          {text.saved && (
            <span role="status" className="text-[10.5px] text-sage">
              Saved
            </span>
          )}
          {text.error && (
            <span role="alert" className="min-w-0 text-[10.5px] text-danger">
              {text.error}
            </span>
          )}
          <span className="ml-auto hidden font-mono text-[9px] tracking-[0.1em] text-faint uppercase sm:block">
            One rule per line
          </span>
        </div>
      </section>

      {note && <NoteLine note={note} />}
    </div>
  );
}
