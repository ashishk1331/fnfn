import { AudioLines, List, LockKeyhole, Settings2 } from 'lucide-react';

import { cn } from '@/lib/utils';
import type { View } from '@/lib/views';

const destinations: Array<{
  view: View;
  label: string;
  icon: typeof AudioLines;
}> = [
  { view: 'live', label: 'Live', icon: AudioLines },
  { view: 'events', label: 'Events', icon: List },
  { view: 'system', label: 'System', icon: Settings2 },
];

export function AppSidebar({ view }: { view: View }) {
  return (
    <aside
      id="app-sidebar"
      aria-label="Workspace"
      className="my-3 ml-3 flex w-[68px] shrink-0 flex-col items-center rounded-2xl border border-line bg-panel py-4"
    >
      <a
        href="#live"
        aria-label="fnfn, live transcription"
        title="fnfn"
        className="flex size-11 items-center justify-center rounded-xl bg-panel-2 font-mono text-[12px] font-medium tracking-[0.08em] text-ink shadow-[inset_0_1px_0_rgba(255,255,255,0.05)] outline-none transition-colors duration-200 ease-out hover:bg-panel-3 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-orange"
      >
        fn
      </a>

      <nav aria-label="Primary" className="mt-9 flex flex-col gap-2">
        {destinations.map(({ view: destination, label, icon: Icon }) => {
          const active = view === destination;
          return (
            <a
              key={destination}
              href={`#${destination}`}
              aria-current={active ? 'page' : undefined}
              aria-label={label}
              title={label}
              className={cn(
                'relative flex size-11 items-center justify-center rounded-xl outline-none transition-colors duration-200 ease-out focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-orange',
                active
                  ? 'bg-panel-3 text-orange'
                  : 'text-faint hover:bg-panel-2 hover:text-dim',
              )}
            >
              {active && (
                <span
                  aria-hidden="true"
                  className="absolute left-1 h-5 w-[3px] rounded-full bg-orange"
                />
              )}
              <Icon className="size-5" strokeWidth={1.6} aria-hidden="true" />
            </a>
          );
        })}
      </nav>

      <span
        title="Audio stays on this machine"
        className="mt-auto flex size-9 items-center justify-center text-faint"
      >
        <LockKeyhole className="size-4" strokeWidth={1.6} aria-hidden="true" />
        <span className="sr-only">Audio stays on this machine</span>
      </span>
    </aside>
  );
}
