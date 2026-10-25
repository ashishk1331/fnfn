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
| `NEEDLE_CLI`        | same as `CACTUS_CLI`              | Engine path for query extraction         |
| `NEEDLE_MODEL`      | `vendor/needle/needle3.cact`      | Path to the Needle3 weights              |
| `TINYFISH_API_KEY`  | unset                             | Key for web answers; wins over the UI    |
| `FFMPEG_PATH`       | `ffmpeg`                          | Path to ffmpeg                           |
| `FN_KEEP_AUDIO`     | unset                             | Set to `1` to keep converted WAV files   |
| `FN_NATIVE_WAYLAND` | unset                             | `1` skips the packaged XWayland relaunch |
| `FN_DEVTOOLS`       | unset                             | Set to `1` to open DevTools              |

The settings file lives in the Electron user-data directory as
`fnfn-settings.json`. Its `textRules` field holds cleanup, dictionary, snippets,
context, and style from **System → Dictation text**; edit them in the UI rather
than by hand. `tinyfishApiKey` stores a key saved through **System → Web
answers**. It is plain text like the rest of the settings file, so prefer the
environment variable on a shared machine.

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
the decoder toward; fnfn writes one for each pass from the dictionary and
snippet triggers in [Dictation text](dictation-text.md).

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

The engine only reads complete files; it rejects a FIFO or a file that grows
while it is open. fnfn therefore does not keep one streaming process alive
during a hold. Instead it writes the WebM chunks captured so far to a temp
file every 1.4 seconds, converts and VADs them, and runs `--audio-stream` over
that clip. Each pass starts from the beginning, so the preview is stable, and
the accumulated WAV is replaced by the VAD-trimmed version. When the key is
released, the preview session is aborted and the complete recording goes
through one plain engine pass; only that final text is typed and stored.

## Needle and TinyFish

`npm run fetch:needle` also downloads `needle3.cact` (about 34 MB) beside the
Whistle weights. The same engine binary runs it with a tool schema. fnfn gives
Needle one job: turn the cleaned transcript into a short web query. It does not
write the answer. A 121M-parameter model that is good at structured extraction
is not a reliable writer, and an invented answer is worse than a quoted one.

The answer itself is extractive and deterministic:

```text
speech
  -> Whistle transcript
  -> cleanup + dictionary
  -> Needle: "Web search: ..." -> { query }
  -> TinyFish search (up to 6 results)
  -> score snippet sentences against the query
       |
       +-- good score: quote the best sentence
       |
       +-- weak score: TinyFish fetch on the top 2 pages, score again
  -> answer + up to 4 sources
```

TinyFish search uses `GET https://api.search.tinyfish.ai?query=...` with the
`X-API-Key` header. The fetch fallback uses `POST https://api.fetch.tinyfish.ai`
with `format: "markdown"` and a 15 second per-URL timeout. Only the query and
result URLs leave the machine; audio and transcripts of normal dictation stay
local.

Get a key from <https://tinyfish.ai>, then paste it in **System → Web answers**
or export `TINYFISH_API_KEY`. The environment value wins. Free-tier limits and
an invalid key are reported in the HUD and in **Search**.
