import { AudioLines, Globe2, List, Settings2 } from 'lucide-react';

import bareIcon from '../../assets/icons/bare-icon.svg';
import { cn } from '@/lib/utils';
import type { View } from '@/lib/views';

const destinations: Array<{
  view: View;
  label: string;
  icon: typeof AudioLines;
}> = [
  { view: 'live', label: 'Live', icon: AudioLines },
  { view: 'events', label: 'Events', icon: List },
  { view: 'search', label: 'Search', icon: Globe2 },
  { view: 'system', label: 'System', icon: Settings2 },
];

export function AppSidebar({ view }: { view: View }) {
  return (
    <aside
      id="app-sidebar"
      aria-label="Workspace"
      className="flex h-dvh w-16 shrink-0 flex-col items-center border-r border-line/60 py-5"
    >
      <a
        href="#live"
        aria-label="fnfn, live transcription"
        title="fnfn"
        className="flex size-9 items-center justify-center rounded-xl outline-none transition-colors duration-200 ease-out focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
      >
        <img src={bareIcon} alt="" className="size-8" draggable={false} />
      </a>

      <nav aria-label="Primary" className="mt-8 flex flex-col gap-1.5">
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
                'relative flex size-11 items-center justify-center rounded-xl outline-none transition-colors duration-200 ease-out focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent',
                active
                  ? 'bg-panel-3 text-accent'
                  : 'text-faint hover:bg-panel-2 hover:text-ink',
              )}
            >
              {active && (
                <span
                  aria-hidden="true"
                  className="absolute -left-2.5 h-5 w-0.5 rounded-full bg-accent"
                />
              )}
              <Icon className="size-5" strokeWidth={1.6} aria-hidden="true" />
            </a>
          );
        })}
      </nav>
    </aside>
  );
}
