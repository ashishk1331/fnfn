# Architecture

fnfn is a small Electron app with a strict split: the renderer owns the UI and
microphone, and the main process owns every OS-level operation. Nothing in the
renderer can read a device, spawn a process, or touch the filesystem directly.

## Runtime diagram

A hold passes through five stages: kernel, main process, renderer, main process
again, then the focused app. The legend marks who owns each stage.

```text
LEGEND  [R] renderer   [M] main process   [X] outside fnfn

key-down / key-up
        |
        v
[X] /dev/input/event* --read--> [M] EvdevSource --> [M] InputService
                                                          |
                                                          v
                                                    [M] HoldDetector
                                                     (pure, 250 ms)
                                                          |
                                             input:update (IPC event)
                                                          |
                                                          v
                                                    [R] usePushToTalk
                                                          |
                                              start MediaRecorder
                                                          v
                                                  [R] MediaRecorder
                                                   WebM/Opus blob
                                                          |
                                             stt:transcribe (IPC)
                                                          |
                                                          v
                                                   [M] SttService
                                            ffmpeg -> VAD -> Whistle
                                                          |
                                             transcript (IPC reply)
                                                          |
                                                          v
                                                    [R] usePushToTalk
                                                          |
                                             insert:text (IPC)
                                                          |
                                                          v
                                                   [M] InsertService
                                            xdotool / ydotool / wtype
                                                          |
                                                          v
                                                   [X] focused app
```

The key events travel one way only. The transcript comes back to the renderer
as the reply to `stt:transcribe`, and the renderer then asks main to type it.

## Live preview

While the key is held, the same recorder streams chunks to main:

```text
[R] MediaRecorder --stt:preview-chunk (IPC)--> [M] SttService
                                                     | every 1.4 s
                                        ffmpeg -> VAD -> Whistle
                                         (--audio-stream pass)
                                                     |
                                         stt:partial (IPC event)
                                                     |
                                                     v
                                             [R] Live text
```

Each pass converts the accumulated WebM, drops silence, and runs the engine in
streaming mode over the whole clip. Partial text replaces the previous preview;
it is never inserted, added to history, or put on the clipboard. Releasing the
key sends `stt:preview-stop`, which aborts the running pass and removes its temp
directory, then `stt:transcribe` runs one final pass. The final reply replaces
the preview and is the only text that gets typed.

Preview passes apply the dictionary and style but skip snippets, so a
half-spoken trigger cannot expand early.

## Web answer loop

A search hold uses the same capture path, but the transcript goes to the research
service instead of the typing service:

```text
[R] usePushToTalk --stt:transcribe (mode=search)--> [M] SttService
                                                          |
                                            Whistle -> cleanup + dictionary
                                                          |
                                                  search:run (IPC)
                                                          v
                                                   [M] ResearchService
                                                          |
                                                    Needle3 (local)
                                                          |
                                                "Web search: ..." query
                                                          |
                                                   TinyFish search
                                                          |
                                             deterministic scoring
                                                          |
                                          weak? TinyFish fetch top 2 pages
                                                          |
                                              search:progress (IPC event)
                                                          |
                                                          v
                                         [R] HUD result card + Search view
                                                          ^
                                            search:changed (IPC event)
                                                          |
                                                  [M] SearchStore
```

Needle does one job: extract the query. The answer is an extractive quote from
the results, chosen by keyword overlap, phrase match, result rank, and sentence
length, with a penalty for boilerplate. There is no second model call and no
multi-step agent loop. The service fetches pages only when the snippet score is
below a fixed threshold.

## HUD side channel

The floating HUD is not part of the transcript path. It is a one-way feed from
the same renderer that owns the microphone:

```text
[R] usePushToTalk --overlay:state (IPC)--> [M] main process
                                                  |
                                     overlay:update (IPC event)
                                                  |
                                                  v
                                          [R] HUD page (#overlay)
                                   208x40, 380x46, or 540x232
                                        click-through
```

While a hold is active, the renderer samples the analyser every 50 ms and sends
the phase, mode, and its rolling level history. Main clamps the payload, sizes
the window for the phase, shows it with `showInactive()`, and hides it 700 ms
after the phase goes idle or twelve seconds after a result.

## Window and process layout

```text
+---------------------------------------------------------------+
| renderer process (Chromium)                                   |
|                                                               |
|  main BrowserWindow  840x600                                  |
|    React: Live / Events / Search / System                     |
|  overlay BrowserWindow  208x40, 380x46, or 540x232            |
|    HUD: waveform, search status, or answer card               |
|    frameless, transparent, always-on-top, click-through       |
|                                                               |
| preload   contextBridge   window.fnfn                         |
| the only renderer -> main surface                             |
|                                                               |
| main process (Node)                                           |
| evdev, hold detector, STT, insertion, research, config        |
+---------------------------------------------------------------+
```

## Why these choices

| Choice                        | Reason                                                                                                                                                                                                |
| ----------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Electron                      | One app can host a React UI, a separate always-on-top HUD window, microphone capture, and Node-side device and subprocess access.                                                                     |
| Main process owns OS work     | evdev, ffmpeg, Whistle, typing tools, and settings all need Node; keeping them out of the renderer leaves it sandboxed and replaceable.                                                               |
| `contextIsolation` + preload  | The renderer gets a small typed `window.fnfn` API instead of `nodeIntegration`, so a compromised page cannot open devices or spawn tools.                                                             |
| Periodic preview passes       | Whistle cannot read a FIFO or a growing file, so each 1.4 s preview converts the clip so far and streams it. The final pass still starts clean.                                                       |
| Text rules in `shared/`       | Cleanup, dictionary, snippet, style, and context logic is pure and unit-tested; main applies it to final text, and the same module builds engine keywords.                                            |
| Extractive search answers     | A 121M tool-calling model reliably picks a query but not an answer. Quoting the best evidence sentence keeps the result grounded, and makes the loop one local model call plus one or two HTTP calls. |
| Search history separate       | A spoken question is not dictation, so it never enters **Events** or gets typed. It is stored with its answer and sources instead.                                                                    |
| Tray with a close fallback    | Closing hides a working app instead of killing the global hook. If the desktop has no tray, closing quits so the window cannot vanish with no way back.                                               |
| Icons inside the asar         | Electron can read `assets/` from the asar for both the window and tray, so there is one copy in development and packaging.                                                                            |
| Passive evdev, no `EVIOCGRAB` | Keys still reach the focused app, and it works on Wayland where compositors block global shortcuts. The only extra privilege is `input`.                                                              |
| Pure `HoldDetector`           | Threshold, autorepeat filtering, and cancel semantics are unit-tested without a keyboard, a microphone, or Electron.                                                                                  |
| Capture starts on key-down    | Starting at the threshold would clip the first syllable; the detector decides later whether the press was a hold or a tap.                                                                            |
| `MediaRecorder` in renderer   | Chromium already encodes Opus/WebM; the main process receives one `ArrayBuffer` instead of owning another audio pipeline.                                                                             |
| ffmpeg conversion             | Whistle accepts many formats, but 16 kHz mono PCM is small and predictable, and ffmpeg decodes anything the recorder produces.                                                                        |
| In-process VAD                | A cheap energy/band/zero-crossing gate drops silence and most hallucinations before paying for model startup.                                                                                         |
| Whistle as a subprocess       | Prebuilt binary plus 17 MB weights, no Python, and a crash cannot take down the UI. The tradeoff is process start and weight load per hold.                                                           |
| External typing tools         | fnfn does not ship a privileged input daemon; it drives `wtype`, `ydotool`, or `xdotool`, picked for the session.                                                                                     |
| Separate HUD window           | `focusable: false`, click-through, and always-on-top keep focus and insertion in the target app while the waveform stays visible.                                                                     |
| JSON settings and history     | Inspectable, dependency-free persistence. History is capped at 200 entries and stored as plain text.                                                                                                  |
| XWayland relaunch             | GNOME ignores Wayland window coordinates, and Chromium fixes its ozone platform before app code runs, so the packaged app restarts once.                                                              |

## Project map

| Path                              | Responsibility                                                   |
| --------------------------------- | ---------------------------------------------------------------- |
| `src/main.ts`                     | Lifecycle, IPC, tray, HUD window, XWayland relaunch              |
| `src/main/evdev.ts`               | Device enumeration and raw `input_event` decoding                |
| `src/main/input-service.ts`       | Detector wiring, chord keys, learn mode, simulator, status       |
| `src/main/stt.ts`                 | ffmpeg conversion, VAD, preview passes, Whistle, rules           |
| `src/main/vad.ts`                 | Speech-band voice activity detection                             |
| `src/main/history.ts`             | Transcript store behind **Events**, capped at 200                |
| `src/main/needle.ts`              | Needle3 subprocess, tool schema, and query extraction            |
| `src/main/tinyfish.ts`            | Search and fetch HTTP client                                     |
| `src/main/research.ts`            | The bounded query → search → fetch → answer loop                 |
| `src/main/search-store.ts`        | Search history behind **Search**, capped at 50                   |
| `src/main/insert.ts`              | Focused-app typing through xdotool, ydotool, or wtype            |
| `src/main/config.ts`              | Settings file and environment overrides                          |
| `scripts/fetch-needle.sh`         | Downloads the engine, Whistle, and Needle3 weights               |
| `scripts/make-icons.ts`           | Rasterizes app and tray SVG masters into PNG/ICO sets            |
| `assets/icons/`, `assets/tray/`   | Window, package, and tray icons, copied into the asar            |
| `vendor/needle/`                  | Engine and weights, gitignored, packaged as resources            |
| `src/shared/hold-detector.ts`     | Pure push-to-talk and Space-chord state machine                  |
| `src/shared/keycodes.ts`          | Key labels and Fn helpers                                        |
| `src/shared/text-rules.ts`        | Cleanup, dictionary, snippets, context, style, and keywords      |
| `src/shared/search.ts`            | Pure query cleaning, scoring, extraction, and URL safety         |
| `src/hooks/use-push-to-talk.ts`   | Capture, previews, transcription, and the search flow            |
| `src/hooks/use-text-rules.ts`     | Loading and saving text rules                                    |
| `src/components/hold-overlay.tsx` | The compact and result cards rendered in the HUD window          |
| `src/components/events-view.tsx`  | The transcription list and **Clear all**                         |
| `src/components/search-view.tsx`  | Search history, answers, and clickable sources                   |
| `src/lib/levels.ts`               | Waveform level sampling and rolling bar history                  |
| `scripts/probe-input.ts`          | Read-only device and permission probe                            |
| `scripts/start.ts`                | Dev launcher, adds `--no-sandbox` when the helper is not set up  |
| `tests/`                          | Detector, insert, history, search, config, STT, VAD, level tests |
