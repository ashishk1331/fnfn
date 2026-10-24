import { TriangleAlert } from 'lucide-react';

import type { Note } from '@/hooks/use-push-to-talk';
import { cn } from '@/lib/utils';

export function NoteLine({ note }: { note: Note }) {
  return (
    <div
      role={note.tone === 'error' ? 'alert' : 'status'}
      className={cn(
        'flex items-start gap-2 text-[11px] leading-relaxed',
        note.tone === 'error' ? 'text-danger' : 'text-orange',
      )}
    >
      <TriangleAlert
        className="mt-0.5 size-3.5 shrink-0"
        strokeWidth={1.7}
        aria-hidden="true"
      />
      <p className="min-w-0">{note.text}</p>
    </div>
  );
}
