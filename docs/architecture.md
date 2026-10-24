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
                                          208x40, click-through
```

While a hold is active, the renderer samples the analyser every 50 ms and sends
the phase plus its rolling level history. Main clamps the payload, shows the
window with `showInactive()`, and hides it 700 ms after the phase goes idle.

## Window and process layout

```text
+---------------------------------------------------------------+
| renderer process (Chromium)                                   |
|                                                               |
|  main BrowserWindow  840x600                                  |
|    React: Live / Events / System                              |
|  overlay BrowserWindow  208x40                                |
|    HUD: dot, state word, waveform                             |
|    frameless, transparent, always-on-top, click-through       |
|                                                               |
| preload   contextBridge   window.fnfn                         |
| the only renderer -> main surface                             |
|                                                               |
| main process (Node)                                           |
| evdev, hold detector, STT, insertion, history, config         |
+---------------------------------------------------------------+
```

## Why these choices

| Choice                        | Reason                                                                                                                                      |
| ----------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------- |
| Electron                      | One app can host a React UI, a separate always-on-top HUD window, microphone capture, and Node-side device and subprocess access.           |
| Main process owns OS work     | evdev, ffmpeg, Whistle, typing tools, and settings all need Node; keeping them out of the renderer leaves it sandboxed and replaceable.     |
| `contextIsolation` + preload  | The renderer gets a small typed `window.fnfn` API instead of `nodeIntegration`, so a compromised page cannot open devices or spawn tools.   |
| Passive evdev, no `EVIOCGRAB` | Keys still reach the focused app, and it works on Wayland where compositors block global shortcuts. The only extra privilege is `input`.    |
| Pure `HoldDetector`           | Threshold, autorepeat filtering, and cancel semantics are unit-tested without a keyboard, a microphone, or Electron.                        |
| Capture starts on key-down    | Starting at the threshold would clip the first syllable; the detector decides later whether the press was a hold or a tap.                  |
| `MediaRecorder` in renderer   | Chromium already encodes Opus/WebM; the main process receives one `ArrayBuffer` instead of owning another audio pipeline.                   |
| ffmpeg conversion             | Whistle accepts many formats, but 16 kHz mono PCM is small and predictable, and ffmpeg decodes anything the recorder produces.              |
| In-process VAD                | A cheap energy/band/zero-crossing gate drops silence and most hallucinations before paying for model startup.                               |
| Whistle as a subprocess       | Prebuilt binary plus 17 MB weights, no Python, and a crash cannot take down the UI. The tradeoff is process start and weight load per hold. |
| External typing tools         | fnfn does not ship a privileged input daemon; it drives `wtype`, `ydotool`, or `xdotool`, picked for the session.                           |
| Separate HUD window           | `focusable: false`, click-through, and always-on-top keep focus and insertion in the target app while the waveform stays visible.           |
| JSON settings and history     | Inspectable, dependency-free persistence. History is capped at 200 entries and stored as plain text.                                        |
| XWayland relaunch             | GNOME ignores Wayland window coordinates, and Chromium fixes its ozone platform before app code runs, so the packaged app restarts once.    |

## Project map

| Path                              | Responsibility                                           |
| --------------------------------- | -------------------------------------------------------- |
| `src/main.ts`                     | Lifecycle, IPC, clipboard, HUD window, XWayland relaunch |
| `src/main/evdev.ts`               | Device enumeration and raw `input_event` decoding        |
| `src/main/input-service.ts`       | Detector wiring, learn mode, simulator, status           |
| `src/main/stt.ts`                 | ffmpeg conversion, VAD, and the Whistle engine           |
| `src/main/vad.ts`                 | Speech-band voice activity detection                     |
| `src/main/history.ts`             | Transcript store behind **Events**, capped at 200        |
| `src/main/insert.ts`              | Focused-app typing through xdotool, ydotool, or wtype    |
| `src/main/config.ts`              | Settings file and environment overrides                  |
| `scripts/fetch-needle.sh`         | Downloads the prebuilt engine and Whistle weights        |
| `vendor/needle/`                  | Engine and weights, gitignored, packaged as resources    |
| `src/shared/hold-detector.ts`     | Pure push-to-talk state machine                          |
| `src/shared/keycodes.ts`          | Key labels and Fn helpers                                |
| `src/hooks/use-push-to-talk.ts`   | React controller for capture and transcription           |
| `src/components/hold-overlay.tsx` | The compact HUD rendered in its own window               |
| `src/components/events-view.tsx`  | The transcription list and **Clear all**                 |
| `src/lib/levels.ts`               | Waveform level sampling and rolling bar history          |
| `scripts/probe-input.ts`          | Read-only device and permission probe                    |
| `tests/`                          | Detector, insert, history, config, STT, VAD, level tests |
