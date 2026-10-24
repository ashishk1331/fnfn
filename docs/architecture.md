# Architecture

## How a hold flows

```text
evdev key-down
  → HoldDetector.pending        (start recording immediately)
  → 250 ms tick → start         (it is a hold, not a tap)
  → key-up → end(qualified)
  → MediaRecorder blob
  → ffmpeg 16 kHz mono WAV
  → speech-band VAD             (reject silence, trim dead air)
  → Cactus Whistle
  → transcript on screen
  → xdotool / ydotool / wtype types it into the focused app

other key while holding → cancel (discard)
release before 250 ms  → end(unqualified) (discard)
```

A failed insert leaves the transcript on the clipboard.

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
