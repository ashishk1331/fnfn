# Setup details

## Development

```bash
npm install
npm run fetch:needle
npm start
```

`npm run fetch:needle` downloads the prebuilt engine for this machine and
`whistle.cact` into `vendor/needle/`. The app never downloads anything at
runtime, so this is the only step that needs a network.

`npm start` passes `--ozone-platform=x11` to Electron. GNOME ignores the window
position a native Wayland client asks for, and the HUD would not stay at the top
center otherwise. Extra flags go after a single `--`:

```bash
npm start -- --no-sandbox
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
If `npm start` reports a `setuid_sandbox_host` error, fix the helper:

```bash
sudo chown root:root node_modules/electron/dist/chrome-sandbox
sudo chmod 4755 node_modules/electron/dist/chrome-sandbox
```

Or run the development build without the sandbox:

```bash
npm start -- --no-sandbox
```

Prefer fixing the helper when you can: `--no-sandbox` lowers process isolation.
