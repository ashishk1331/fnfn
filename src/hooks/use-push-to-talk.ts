import { useCallback, useEffect, useRef, useState } from 'react';

import type { HoldUpdate } from '@/shared/hold-detector';
import { isFnChord, isFnKey } from '@/shared/keycodes';
import type {
  InputStatus,
  InsertResult,
  LearnEvent,
  OverlayMode,
  OverlayPhase,
  OverlaySource,
  SearchEntry,
  SearchProgress,
  TranscriptionMode,
  TranscriptionResult,
} from '@/shared/types';
import { describeError } from '@/lib/format';
import { levelFromSamples, OVERLAY_BARS, pushLevel } from '@/lib/levels';

export type Phase = OverlayPhase;

export interface TranscriptView {
  text: string;
  empty: boolean;
  error: boolean;
}

export interface Note {
  text: string;
  tone: 'warn' | 'error';
}

interface SearchDisplay {
  query?: string;
  answer?: string;
  sources?: OverlaySource[];
  message?: string;
}

interface CaptureSession {
  stop: () => Promise<Blob>;
}

interface AudioMeter {
  context: AudioContext;
  analyser: AnalyserNode;
  data: Uint8Array<ArrayBuffer>;
}

function bridgeAvailable(): boolean {
  return typeof window.fnfn !== 'undefined';
}

function pickMimeType(): string {
  if (typeof MediaRecorder === 'undefined') {
    return '';
  }

  const candidates = [
    'audio/webm;codecs=opus',
    'audio/webm',
    'audio/ogg;codecs=opus',
  ];

  return (
    candidates.find((candidate) => MediaRecorder.isTypeSupported(candidate)) ??
    ''
  );
}

export function usePushToTalk(inputStatus: InputStatus | null) {
  const [phase, setPhaseState] = useState<Phase>('idle');
  const [progress, setProgress] = useState(0);
  const [transcript, setTranscript] = useState<TranscriptView>({
    text: '',
    empty: true,
    error: false,
  });
  const [note, setNote] = useState<Note | null>(null);
  const [micReady, setMicReady] = useState(false);
  const [mode, setModeState] = useState<OverlayMode>('dictate');
  const [search, setSearch] = useState<SearchEntry | null>(null);
  const [display, setDisplay] = useState<SearchDisplay>({});

  const statusRef = useRef(inputStatus);
  const phaseRef = useRef<Phase>('idle');
  const modeRef = useRef<OverlayMode>('dictate');
  const displayRef = useRef<SearchDisplay>({});
  const searchGenerationRef = useRef(0);
  const searchingRef = useRef(false);
  const rafRef = useRef(0);
  const captureRef = useRef<Promise<CaptureSession | null> | null>(null);
  const generationRef = useRef(0);
  const queueRef = useRef<Promise<void>>(Promise.resolve());
  const micRef = useRef<MediaStream | null>(null);
  const meterRef = useRef<AudioMeter | null>(null);
  const levelsRef = useRef<number[]>(
    Array.from({ length: OVERLAY_BARS }, () => 0),
  );
  const simulatingRef = useRef(false);
  const transcriptRef = useRef(transcript);
  const previousTranscriptRef = useRef<TranscriptView>(transcript);

  useEffect(() => {
    transcriptRef.current = transcript;
  }, [transcript]);

  useEffect(() => {
    statusRef.current = inputStatus;
  }, [inputStatus]);

  useEffect(() => {
    if (!bridgeAvailable() || typeof window.fnfn?.getHistory !== 'function') {
      return;
    }
    void window.fnfn.getHistory().then((history) => {
      if (history.length > 0 && phaseRef.current === 'idle') {
        const latest = history[0];
        const next = { text: latest.text, empty: false, error: false };
        previousTranscriptRef.current = next;
        setTranscript((prev) => (prev.empty ? next : prev));
      }
    });
  }, []);

  useEffect(() => {
    return () => {
      cancelAnimationFrame(rafRef.current);
      generationRef.current += 1;
      window.fnfn?.stopPreview?.();
      micRef.current?.getTracks().forEach((track) => track.stop());
      void meterRef.current?.context.close();
      meterRef.current = null;
    };
  }, []);

  useEffect(() => {
    if (!bridgeAvailable()) {
      return;
    }
    return window.fnfn.onPartial((text) => {
      const trimmed = text.trim();
      if (
        !trimmed ||
        phaseRef.current === 'idle' ||
        phaseRef.current === 'error'
      ) {
        return;
      }
      setTranscript({ text: trimmed, empty: false, error: false });
    });
  }, []);

  const setPhase = useCallback((next: Phase) => {
    phaseRef.current = next;
    setPhaseState(next);
  }, []);

  const setMode = useCallback((next: OverlayMode) => {
    modeRef.current = next;
    setModeState(next);
  }, []);

  const updateDisplay = useCallback((patch: SearchDisplay) => {
    displayRef.current = { ...displayRef.current, ...patch };
    setDisplay(displayRef.current);
  }, []);

  const clearSearch = useCallback(() => {
    searchGenerationRef.current += 1;
    searchingRef.current = false;
    setSearch(null);
    displayRef.current = {};
    setDisplay({});
  }, []);

  const startProgress = useCallback((pressedAt: number) => {
    cancelAnimationFrame(rafRef.current);
    const threshold = statusRef.current?.thresholdMs ?? 250;

    const step = (): void => {
      const next = Math.min(1, (Date.now() - pressedAt) / threshold);
      setProgress(next);

      if (
        next < 1 &&
        (phaseRef.current === 'pending' || phaseRef.current === 'recording')
      ) {
        rafRef.current = requestAnimationFrame(step);
      }
    };

    step();
  }, []);

  const resetProgress = useCallback(() => {
    cancelAnimationFrame(rafRef.current);
    setProgress(0);
  }, []);

  const ensureMic = useCallback(async (): Promise<MediaStream | null> => {
    if (micRef.current?.active) {
      return micRef.current;
    }

    if (!navigator.mediaDevices?.getUserMedia) {
      setNote({
        text: 'This build has no microphone API available.',
        tone: 'error',
      });
      return null;
    }

    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          channelCount: 1,
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
        },
      });

      micRef.current = stream;
      setMicReady(true);

      if (!meterRef.current) {
        try {
          const context = new AudioContext();
          const analyser = context.createAnalyser();
          analyser.fftSize = 1024;
          analyser.smoothingTimeConstant = 0.5;
          context.createMediaStreamSource(stream).connect(analyser);
          void context.resume();
          meterRef.current = {
            context,
            analyser,
            data: new Uint8Array(analyser.fftSize),
          };
        } catch {
          // The waveform is optional; recording still works without it.
        }
      }

      const track = stream.getAudioTracks()[0];
      track?.addEventListener('ended', () => {
        micRef.current = null;
        setMicReady(false);
        void meterRef.current?.context.close();
        meterRef.current = null;
      });

      return stream;
    } catch (error) {
      const message = describeError(error);
      setMicReady(false);
      setNote({ text: `Microphone unavailable: ${message}`, tone: 'error' });
      return null;
    }
  }, []);

  const createCaptureSession = useCallback(
    async (generation: number): Promise<CaptureSession | null> => {
      const stream = await ensureMic();

      // The key may have been released while the permission prompt was open.
      if (!stream || generation !== generationRef.current) {
        return null;
      }

      try {
        const mimeType = pickMimeType();
        const recorder = new MediaRecorder(
          stream,
          mimeType ? { mimeType } : undefined,
        );
        const chunks: Blob[] = [];

        recorder.addEventListener('dataavailable', (event: BlobEvent) => {
          if (event.data.size > 0) {
            chunks.push(event.data);
            const chunk = event.data;
            void chunk
              .arrayBuffer()
              .then((buffer) => {
                if (generation === generationRef.current) {
                  window.fnfn?.pushPreviewAudio?.(buffer);
                }
              })
              .catch(() => {
                // A preview is optional; the final blob still transcribes.
              });
          }
        });

        const stopped = new Promise<Blob>((resolve, reject) => {
          recorder.addEventListener('stop', () => {
            resolve(
              new Blob(chunks, {
                type: recorder.mimeType || mimeType || 'audio/webm',
              }),
            );
          });
          recorder.addEventListener('error', () => {
            reject(new Error('MediaRecorder failed.'));
          });
        });

        window.fnfn?.startPreview?.();
        recorder.start(100);

        return {
          stop: async () => {
            if (recorder.state !== 'inactive') {
              recorder.stop();
            }
            return stopped;
          },
        };
      } catch (error) {
        setNote({
          text: `Recorder failed: ${describeError(error)}`,
          tone: 'error',
        });
        return null;
      }
    },
    [ensureMic],
  );

  const beginCapture = useCallback(() => {
    generationRef.current += 1;
    const generation = generationRef.current;
    captureRef.current = createCaptureSession(generation);
  }, [createCaptureSession]);

  const renderResult = useCallback((result: TranscriptionResult) => {
    if (!result.skipped && result.text) {
      const next = { text: result.text, empty: false, error: false };
      previousTranscriptRef.current = next;
      setTranscript(next);
      return;
    }

    // Silence or a failed pass: keep the last real transcript instead of
    // leaving the view blank after a preview replaced it.
    setTranscript(previousTranscriptRef.current);
  }, []);

  /**
   * Type the transcript into the focused app. A failed insert leaves the text on
   * the clipboard so the Copy button is not the only way out.
   */
  const insertTranscript = useCallback(
    async (text: string): Promise<InsertResult | null> => {
      if (typeof window.fnfn?.insertText !== 'function') {
        return null;
      }

      let failure = 'the typing tool failed';

      try {
        const result = await window.fnfn.insertText(text);
        if (result.success) {
          return result;
        }
        failure = result.error ?? failure;
      } catch (error) {
        failure = describeError(error);
      }

      try {
        await window.fnfn.copyText(text);
      } catch {
        // Copy is still available by hand.
      }

      return { success: false, tool: 'none', error: failure };
    },
    [],
  );

  const runSearchFlow = useCallback(
    async (text: string) => {
      const generation = searchGenerationRef.current + 1;
      searchGenerationRef.current = generation;
      searchingRef.current = true;
      setMode('search');
      setSearch(null);
      updateDisplay({
        query: text,
        answer: undefined,
        sources: undefined,
        message: undefined,
      });
      setPhase('searching');

      try {
        if (
          !bridgeAvailable() ||
          typeof window.fnfn?.runSearch !== 'function'
        ) {
          throw new Error('The main process bridge is missing.');
        }

        const entry = await window.fnfn.runSearch(text);
        if (searchGenerationRef.current !== generation) {
          return;
        }

        setSearch(entry);
        updateDisplay({
          query: entry.query,
          answer: entry.answer,
          sources: entry.sources.map(({ title, url }) => ({ title, url })),
          message: undefined,
        });
        setPhase('done');
        setNote(null);
      } catch (error) {
        if (searchGenerationRef.current !== generation) {
          return;
        }
        const message = describeError(error);
        updateDisplay({ message });
        setPhase('error');
        setNote({ text: `Search failed: ${message}`, tone: 'error' });
      } finally {
        if (searchGenerationRef.current === generation) {
          searchingRef.current = false;
        }
      }
    },
    [setMode, setPhase, updateDisplay],
  );

  const enqueueTranscription = useCallback(
    (blob: Blob, heldMs: number, mode: TranscriptionMode) => {
      queueRef.current = queueRef.current
        .then(async () => {
          if (phaseRef.current === 'idle') {
            setPhase('transcribing');
          }

          try {
            if (!bridgeAvailable()) {
              throw new Error('The main process bridge is missing.');
            }

            const result = await window.fnfn.transcribe(
              await blob.arrayBuffer(),
              heldMs,
              mode,
            );
            renderResult(result);

            if (mode === 'search') {
              if (!result.text || result.skipped) {
                const message =
                  result.skipped === 'silence'
                    ? 'No speech detected.'
                    : 'That hold was too short to search.';
                updateDisplay({ message });
                setPhase('error');
                setNote({
                  text: `${message} Hold the talk key with Space and ask again.`,
                  tone: 'warn',
                });
                return;
              }

              void runSearchFlow(result.text);
              return;
            }

            const insertion = result.text
              ? await insertTranscript(result.text)
              : null;

            if (phaseRef.current === 'transcribing') {
              if (result.skipped === 'silence') {
                setNote({
                  text: 'No speech detected. Hold the key and speak a little louder.',
                  tone: 'warn',
                });
              } else if (result.skipped) {
                setNote({
                  text: 'That hold was too short to transcribe.',
                  tone: 'warn',
                });
              } else if (!result.text) {
                setNote({
                  text: 'No speech detected. Try again, or use a larger model.',
                  tone: 'warn',
                });
              } else if (insertion && !insertion.success) {
                const reason =
                  insertion.error?.replace(/\.$/, '') ?? 'typing failed';
                setNote({
                  text: `Could not insert: ${reason}. The transcript is on the clipboard.`,
                  tone: 'warn',
                });
              } else {
                setNote(null);
              }
            }
          } catch (error) {
            const message = describeError(error);

            if (mode === 'search') {
              updateDisplay({ message });
              setPhase('error');
              setNote({ text: `Search failed: ${message}`, tone: 'error' });
              return;
            }

            setTranscript({
              text: `Transcription failed: ${message}`,
              empty: false,
              error: true,
            });
            if (phaseRef.current === 'transcribing') {
              setNote(null);
            }
          } finally {
            if (mode === 'dictate' && phaseRef.current === 'transcribing') {
              setPhase('idle');
            }
          }
        })
        .catch(() => {
          // Keep the queue alive even if a render step throws.
        });
    },
    [insertTranscript, renderResult, runSearchFlow, setPhase, updateDisplay],
  );

  const finishCapture = useCallback(
    (
      qualified: boolean,
      heldMs: number,
      captureMode: TranscriptionMode = 'dictate',
    ) => {
      generationRef.current += 1;
      window.fnfn?.stopPreview?.();
      const pending = captureRef.current;
      captureRef.current = null;

      if (!pending) {
        if (phaseRef.current === 'transcribing') {
          setPhase('idle');
        }
        return;
      }

      void pending
        .then(async (session) => {
          if (!session) {
            if (qualified && phaseRef.current === 'transcribing') {
              setNote({
                text: 'The microphone was still starting. Hold the key again to record.',
                tone: 'warn',
              });
              setPhase('idle');
            }
            return;
          }

          let blob: Blob | null = null;
          try {
            blob = await session.stop();
          } catch (error) {
            setNote({
              text: `Recorder error: ${describeError(error)}`,
              tone: 'error',
            });
          }

          if (!qualified) {
            if (phaseRef.current === 'transcribing') {
              setPhase('idle');
            }
            return;
          }

          if (!blob || blob.size === 0) {
            if (phaseRef.current === 'transcribing') {
              setPhase('error');
              setNote({
                text: 'The recorder produced no audio. Try again.',
                tone: 'error',
              });
            }
            return;
          }

          enqueueTranscription(blob, heldMs, captureMode);
        })
        .catch((error: unknown) => {
          if (phaseRef.current === 'transcribing') {
            setPhase('error');
            setNote({
              text: `Recorder error: ${describeError(error)}`,
              tone: 'error',
            });
          }
        });
    },
    [enqueueTranscription, setPhase],
  );

  const handleHold = useCallback(
    (update: HoldUpdate) => {
      switch (update.type) {
        case 'pending': {
          clearSearch();
          setMode('dictate');
          setPhase('pending');
          startProgress(update.at);
          previousTranscriptRef.current = transcriptRef.current;
          setTranscript({ text: '', empty: true, error: false });
          beginCapture();
          setNote(null);
          break;
        }

        case 'start': {
          cancelAnimationFrame(rafRef.current);
          setProgress(1);
          setMode(update.mode);
          setPhase('recording');
          setNote(null);
          break;
        }

        case 'mode': {
          setMode('search');
          setNote(null);
          break;
        }

        case 'end': {
          resetProgress();

          if (update.qualified) {
            setPhase('transcribing');
            setNote(null);
          } else {
            setPhase('idle');
            setTranscript(previousTranscriptRef.current);
            setNote({
              text: `Tap ignored (${Math.round(
                update.heldMs,
              )}ms). Hold for at least ${statusRef.current?.thresholdMs ?? 250}ms.`,
              tone: 'warn',
            });
          }

          finishCapture(update.qualified, update.heldMs, update.mode);
          break;
        }

        case 'cancel': {
          resetProgress();
          clearSearch();
          setMode('dictate');
          setPhase('idle');
          setTranscript(previousTranscriptRef.current);
          setNote({
            text:
              update.reason === 'other-key'
                ? 'Cancelled: another key was pressed.'
                : 'Cancelled.',
            tone: 'warn',
          });
          finishCapture(false, update.heldMs);
          break;
        }
      }
    },
    [
      beginCapture,
      clearSearch,
      finishCapture,
      resetProgress,
      setMode,
      setPhase,
      startProgress,
    ],
  );

  const handleLearn = useCallback((event: LearnEvent) => {
    if (event.type === 'timeout') {
      setNote({ text: event.message, tone: 'warn' });
      return;
    }

    const { code } = event.key;
    let advice: string | null = null;

    if (isFnKey(code)) {
      advice =
        'This keyboard exposes KEY_FN. You can bind Fn directly. Hardware wins.';
    } else if (isFnChord(code)) {
      advice =
        'That is Fn + Esc, not Fn alone. Holding it may toggle Fn lock on some laptops.';
    } else if (code === 248) {
      advice =
        'That is Mic Mute. Holding it may mute your microphone at the hardware level.';
    } else if (code === 100) {
      advice =
        'Right Alt is the default. If it conflicts with Alt shortcuts, bind a spare key instead.';
    } else if (code === 97) {
      advice =
        'Right Ctrl works alone, but it still acts as Ctrl in shortcuts. A dedicated key feels better.';
    }

    setNote(advice ? { text: advice, tone: 'warn' } : null);
  }, []);

  useEffect(() => {
    if (!bridgeAvailable()) {
      return;
    }
    return window.fnfn.onHoldUpdate(handleHold);
  }, [handleHold]);

  const sendOverlay = useCallback((next: Phase) => {
    if (typeof window.fnfn?.setOverlayState !== 'function') {
      return;
    }

    let level = 0;
    const meter = meterRef.current;
    if (meter && next === 'recording') {
      meter.analyser.getByteTimeDomainData(meter.data);
      level = levelFromSamples(meter.data);
    }

    levelsRef.current = pushLevel(levelsRef.current, level);

    // Dictation failures surface in the main window's note. The HUD's error
    // state is a search result card, so a dictate error just dismisses it.
    const overlayPhase =
      next === 'error' && modeRef.current !== 'search' ? 'idle' : next;

    window.fnfn.setOverlayState({
      phase: overlayPhase,
      mode: modeRef.current,
      levels: levelsRef.current,
      ...displayRef.current,
    });
  }, []);

  useEffect(() => {
    if (!bridgeAvailable()) {
      return;
    }

    sendOverlay(phase);
    if (phase !== 'recording') {
      return;
    }

    const timer = window.setInterval(() => sendOverlay('recording'), 50);
    return () => window.clearInterval(timer);
  }, [display, mode, phase, sendOverlay]);

  useEffect(() => {
    if (
      !bridgeAvailable() ||
      typeof window.fnfn?.onSearchProgress !== 'function'
    ) {
      return;
    }

    return window.fnfn.onSearchProgress((progress: SearchProgress) => {
      if (!searchingRef.current) {
        return;
      }
      updateDisplay({
        ...(progress.query ? { query: progress.query } : {}),
        message: progress.message,
      });
      setPhase(progress.phase === 'query' ? 'searching' : progress.phase);
    });
  }, [setPhase, updateDisplay]);

  useEffect(() => {
    if (!bridgeAvailable()) {
      return;
    }
    return window.fnfn.onLearn(handleLearn);
  }, [handleLearn]);

  const simulateDown = useCallback(() => {
    if (simulatingRef.current) {
      return;
    }
    if (!bridgeAvailable()) {
      setNote({
        text: 'The main process bridge is missing. Rebuild the app.',
        tone: 'error',
      });
      return;
    }
    simulatingRef.current = true;
    window.fnfn.simulate('down');
  }, []);

  const simulateUp = useCallback(() => {
    if (!simulatingRef.current) {
      return;
    }
    simulatingRef.current = false;
    if (!bridgeAvailable()) {
      return;
    }
    window.fnfn.simulate('up');
  }, []);

  useEffect(() => {
    const stopSimulation = (): void => simulateUp();
    window.addEventListener('blur', stopSimulation);
    return () => window.removeEventListener('blur', stopSimulation);
  }, [simulateUp]);

  const toggleLearn = useCallback(async () => {
    if (!bridgeAvailable()) {
      setNote({
        text: 'The main process bridge is missing. Rebuild the app.',
        tone: 'error',
      });
      return;
    }

    if ((statusRef.current?.reading.length ?? 0) === 0) {
      setNote({
        text: 'No readable keyboard yet. Add your user to the input group, then restart the app.',
        tone: 'warn',
      });
      return;
    }

    const next = !(statusRef.current?.learning ?? false);

    if (next) {
      setNote({
        text: 'Press the key you want to hold. Fn alone often sends nothing — try Fn + another key too.',
        tone: 'warn',
      });
    }

    try {
      await window.fnfn.setLearning(next);
    } catch (error) {
      setNote({ text: describeError(error), tone: 'error' });
    }
  }, []);

  const enableMic = useCallback(async () => {
    await ensureMic();
  }, [ensureMic]);

  return {
    phase,
    mode,
    search,
    progress,
    transcript,
    note,
    micReady,
    simulateDown,
    simulateUp,
    toggleLearn,
    enableMic,
  };
}
