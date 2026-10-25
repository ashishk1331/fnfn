import type { ReactNode } from 'react';

export function PageHeader({
  title,
  description,
  actions,
}: {
  title: string;
  description: string;
  actions?: ReactNode;
}) {
  return (
    <header className="flex shrink-0 items-start justify-between gap-4">
      <div className="min-w-0">
        <h1 className="text-[26px] leading-[1.1] font-semibold tracking-[-0.02em] text-ink">
          {title}
        </h1>
        <p className="mt-2 max-w-[56ch] text-[12px] leading-relaxed text-dim">
          {description}
        </p>
      </div>
      {actions && (
        <div className="flex shrink-0 items-center gap-2 pt-0.5">{actions}</div>
      )}
    </header>
  );
}
