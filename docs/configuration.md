# Configuration

Environment variables override the saved settings file:

| Variable            | Default                           | Meaning                                  |
| ------------------- | --------------------------------- | ---------------------------------------- |
| `FN_HOLD_KEY`       | `100`                             | Linux key code to hold                   |
| `FN_HOLD_MS`        | `250`                             | Hold threshold in milliseconds           |
| `FN_INSERT_TOOL`    | `auto`                            | `auto`, `xdotool`, `ydotool`, or `wtype` |
| `FN_MAX_MS`         | `120000`                          | Maximum recording length                 |
| `CACTUS_CLI`        | `vendor/needle/<platform>/needle` | Path to the prebuilt engine              |
| `CACTUS_MODEL`      | `vendor/needle/whistle.cact`      | Path to the Whistle weights              |
| `CACTUS_LANG`       | `auto`                            | Whistle language, or `auto`              |
| `FFMPEG_PATH`       | `ffmpeg`                          | Path to ffmpeg                           |
| `FN_KEEP_AUDIO`     | unset                             | Set to `1` to keep converted WAV files   |
| `FN_NATIVE_WAYLAND` | unset                             | `1` skips the packaged XWayland relaunch |
| `FN_DEVTOOLS`       | unset                             | Set to `1` to open DevTools              |

The settings file lives in the Electron user-data directory as
`fnfn-settings.json`.

## Whistle

Whistle ships as a prebuilt engine for seventeen targets. `npm run fetch:needle`
copies the folder for this machine (`linux-x86_64`, `linux-arm64`, and so on)
plus `whistle.cact` into `vendor/needle/`. That directory is gitignored. Point
`CACTUS_CLI` and `CACTUS_MODEL` at your own files to skip the fetch.

fnfn runs the engine once per hold:

```bash
vendor/needle/linux-x86_64/needle \
  --model vendor/needle/whistle.cact --audio clip.wav
# {"text":"And so, my fellow Americans, ...","language":"en","ttft_ms":1125.4,"decode_tps":57.3}
```

The engine accepts any WAV rate, channel count, and PCM or float format; fnfn
still converts the recording to 16 kHz mono first. Audio longer than thirty
seconds is windowed inside the engine, and each window keeps the text up to its
last full sentence, so a long hold does not split words.

Whistle handles English, German, French, Spanish, Italian, Dutch, and Polish.
Leave `CACTUS_LANG=auto` to detect the language, or set a code such as `en` to
force it. `--audio-keywords` takes a file of names and product words to bias
the decoder toward; fnfn does not pass one yet.

### Streaming

The engine can also transcribe as it reads:

```bash
needle --model whistle.cact --audio clip.wav --audio-stream --audio-chunk 1
```

It prints one JSON object per committed chunk: `text` holds only the words
newly committed, `words` carries their timings, `pending` is the unconfirmed
tail, and `language`, `received`, and `pass_ms` describe the pass. A chunk
re-transcribes the buffered audio and commits only what two consecutive passes
agree on, so printed text never changes under the reader.

fnfn does not use streaming yet. A hold is transcribed once, when the key is
released, because insertion needs the final text.
