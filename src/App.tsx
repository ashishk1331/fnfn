import { useEffect, useState } from 'react';

import { AppSidebar } from '@/components/app-sidebar';
import { EventsView } from '@/components/events-view';
import { LiveView } from '@/components/live-view';
import { SearchView } from '@/components/search-view';
import { SystemView } from '@/components/system-view';
import { usePushToTalk } from '@/hooks/use-push-to-talk';
import { useTextRules } from '@/hooks/use-text-rules';
import { describeError } from '@/lib/format';
import { viewFromHash, type View } from '@/lib/views';
import type { InputStatus, SttInfo } from '@/shared/types';

export default function App() {
  const [inputStatus, setInputStatus] = useState<InputStatus | null>(null);
  const [sttInfo, setSttInfo] = useState<SttInfo | null>(null);
  const [startupError, setStartupError] = useState<string | null>(null);
  const [view, setView] = useState<View>(() =>
    viewFromHash(window.location.hash),
  );
  const ptt = usePushToTalk(inputStatus);
  const text = useTextRules();

  useEffect(() => {
    if (!window.location.hash) {
      window.history.replaceState(null, '', '#live');
    }

    const syncView = (): void => setView(viewFromHash(window.location.hash));
    window.addEventListener('hashchange', syncView);
    return () => window.removeEventListener('hashchange', syncView);
  }, []);

  useEffect(() => {
    document.title = 'fnfn';
  }, []);

  useEffect(() => {
    if (typeof window.fnfn === 'undefined') {
      setStartupError('The preload bridge is missing. Rebuild the app.');
      return;
    }

    let active = true;
    const off = window.fnfn.onStatus((status) => {
      if (active) {
        setInputStatus(status);
      }
    });

    void Promise.all([window.fnfn.getInputStatus(), window.fnfn.getSttInfo()])
      .then(([status, info]) => {
        if (active) {
          setInputStatus(status);
          setSttInfo(info);
        }
      })
      .catch((error: unknown) => {
        if (active) {
          setStartupError(describeError(error));
        }
      });

    return () => {
      active = false;
      off();
    };
  }, []);

  const focusMain = (): void => {
    document.getElementById('main')?.focus();
  };

  return (
    <div className="flex h-dvh overflow-hidden bg-shell text-ink">
      <button type="button" className="skip" onClick={focusMain}>
        Skip to content
      </button>

      <AppSidebar view={view} />

      <main
        id="main"
        tabIndex={-1}
        className="min-w-0 flex-1 overflow-y-auto outline-none"
      >
        <div className="mx-auto flex min-h-full w-full max-w-[760px] flex-col px-6 py-6">
          {view === 'live' && (
            <LiveView
              status={inputStatus}
              startupError={startupError}
              phase={ptt.phase}
              progress={ptt.progress}
              note={ptt.note}
              transcript={ptt.transcript}
              search={ptt.search}
              onSimulateDown={ptt.simulateDown}
              onSimulateUp={ptt.simulateUp}
            />
          )}

          {view === 'events' && <EventsView />}

          {view === 'search' && <SearchView />}

          {view === 'system' && (
            <SystemView
              status={inputStatus}
              sttInfo={sttInfo}
              startupError={startupError}
              note={ptt.note}
              micReady={ptt.micReady}
              text={text}
              onToggleLearn={() => void ptt.toggleLearn()}
              onEnableMic={() => void ptt.enableMic()}
            />
          )}
        </div>
      </main>
    </div>
  );
}
