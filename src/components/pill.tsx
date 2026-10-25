import type { ReactNode } from 'react';

import { cn } from '@/lib/utils';

type PillTone = 'neutral' | 'live' | 'success' | 'danger';

const tones: Record<PillTone, string> = {
  neutral: 'border-line-strong/80 bg-panel-3/50 text-dim',
  live: 'border-orange/30 bg-orange-soft/40 text-orange',
  success: 'border-sage/25 bg-sage/10 text-sage',
  danger: 'border-danger/30 bg-danger/10 text-danger',
};

export function Pill({
  tone = 'neutral',
  children,
  className,
}: {
  tone?: PillTone;
  children: ReactNode;
  className?: string;
}) {
  return (
    <span
      className={cn(
        'inline-flex h-7 shrink-0 items-center gap-1.5 rounded-full border px-3 font-mono text-[9px] font-medium tracking-[0.11em] uppercase',
        tones[tone],
        className,
      )}
    >
      {children}
    </span>
  );
}

export function StatusDot({ tone = 'live' }: { tone?: PillTone }) {
  return (
    <span
      aria-hidden="true"
      className={cn(
        'size-1.5 rounded-full bg-current',
        tone === 'live' && 'animate-pulse',
      )}
    />
  );
}
