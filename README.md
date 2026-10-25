![Banner](banner.png)

# fnfn

Hold-to-talk dictation for Linux. Hold a key, speak, release: the transcript is
typed into the window you are focused on. Speech-to-text runs locally with
Cactus Whistle, so no audio leaves the machine.

## Requirements

- Linux and Node 24+
- `ffmpeg`
- A microphone
- One typing tool: `xdotool`, `ydotool`, or `wtype`
- Read access to `/dev/input/event*` for the global key (see below)

## Setup

```bash
npm install
npm run fetch:needle   # prebuilt engine and model, about 18 MB, one time
npm start
```

`npm start` runs the dev build on XWayland so the floating HUD can stay pinned
at the top center. Extra Electron flags go after a single `--`:

```bash
npm start -- --no-sandbox
```

## Use

1. Hold **Right Alt**, speak, release. Words appear in **Live** while you
   hold; the finished transcript is typed at the cursor and kept in **Events**.
2. To choose another key, open **System**, press **Change**, then press the key
   you want to hold.
3. To test without keyboard permissions, hold the bar at the bottom of **Live**.
4. Add names, snippet triggers, and a capitalisation style in **System** under
   **Dictation text**.
5. Close the window to keep fnfn in the tray; **Quit fnfn** is in the tray menu.
6. If nothing is typed, the transcript is on the clipboard. Install a typing
   tool for your session, then hold again.

### Permission for the global key

Reading `/dev/input/event*` needs the `input` group. After this, log out and
back in:

```bash
sudo usermod -aG input "$USER"
```

Until you re-login, apply the group to one command instead:

```bash
sg input -c 'npm start -- --no-sandbox'
```

See what fnfn can read without recording anything:

```bash
npm run probe
```

This is keylogger-level access. Only do it on a machine you control.

## Docs

- [Setup details](docs/setup.md) — XWayland, sandbox, packaging
- [Using fnfn](docs/usage.md) — floating HUD, live words, insert at cursor, the Fn key
- [Dictation text](docs/dictation-text.md) — dictionary, snippets, styles
- [Configuration](docs/configuration.md) — environment variables, Whistle
- [Architecture](docs/architecture.md) — how a hold flows, project map
- [Icons](docs/icons.md) — sizes and formats used by the app, tray, and packages
- [Troubleshooting](docs/troubleshooting.md) — common failures and fixes
- [Known limits](docs/limits.md) — what is intentionally out of scope

## Checks

```bash
npm run typecheck
npm test
npm run lint
```
