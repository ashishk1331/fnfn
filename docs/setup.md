# Setup details

## Development

```bash
npm install
npm run fetch:needle
npm start
```

`npm run fetch:needle` downloads the prebuilt engine for this machine,
`whistle.cact`, and `needle3.cact` into `vendor/needle/`. Models are never
downloaded at runtime; web answers make TinyFish requests only while you use the
search chord. Add a TinyFish key in **System → Web answers** or set
`TINYFISH_API_KEY` to enable them.

`npm start` passes `--ozone-platform=x11` to Electron. GNOME ignores the window
position a native Wayland client asks for, and the HUD would not stay at the top
center otherwise. It also adds `--no-sandbox` when the sandbox helper is not set
up, and prints the commands that fix it (see
[Electron sandbox on Linux](#electron-sandbox-on-linux)). Extra flags go after a
single `--`:

```bash
npm start -- --enable-logging
```

To start without the XWayland flag:

```bash
npx electron-forge start
```

The app then restarts itself once to switch back to XWayland unless
`FN_NATIVE_WAYLAND=1` is set. The packaged app always restarts itself; a dev
build started with plain Forge does too.

## Build

```bash
npm run package
./out/fnfn-linux-x64/fnfn
```

The packaged app loads the same renderer and preload. If the sandbox helper is
not fixed, add `--no-sandbox`. If the `input` group is not active in this
session, wrap it the same way as the dev build:

```bash
sg input -c './out/fnfn-linux-x64/fnfn --no-sandbox'
```

`npm run package` copies `vendor/needle/` into the app's resources when it
exists. A build without it needs `CACTUS_CLI` and `CACTUS_MODEL` pointed at a
downloaded engine.

## Electron sandbox on Linux

The Electron `chrome-sandbox` helper must be owned by root and mode `4755`.
`npm install` leaves it owned by your user, and Chromium then aborts before any
window appears. `scripts/start.ts` checks the helper first: when it is not set
up, `npm start` prints the commands below and passes `--no-sandbox`, so the app
still opens. Fix the helper to get the sandbox back:

```bash
sudo chown root:root node_modules/electron/dist/chrome-sandbox
sudo chmod 4755 node_modules/electron/dist/chrome-sandbox
```

A reinstall brings the helper back unconfigured, so repeat this after
`npm install`. Prefer it when you can: `--no-sandbox` lowers process isolation.
The check lives in the dev script only, so `npx electron-forge start` and the
packaged binary still need `--no-sandbox` passed by hand.
