# Troubleshooting

## Electron exits with a SUID sandbox error

Fix the helper as described in [Setup](setup.md#electron-sandbox-on-linux), or
run with `npm start -- --no-sandbox`.

## The app prints `restarting with --ozone-platform=x11` and nothing appears

That line is the Wayland handoff, not a crash. The process that printed it exits
on purpose and a second one takes over about a second later. If no window
follows, a process from an earlier launch is still holding the single-instance
lock:

```bash
pkill -x fnfn      # packaged app
pkill -x electron  # development build
```

Start again after that. A relaunched process waits up to 2.5 s for the lock, so
the ordinary case recovers without any help.

## Nothing is typed into the focused app

The transcript is on screen, in **Events**, and on the clipboard either way.
Live says why the insert failed; the usual cause is that no tool is installed:

```bash
command -v xdotool ydotool wtype
```

Install one for your session (see [Insert at cursor](usage.md#insert-at-cursor))
and hold again. `wtype` needs a compositor that implements the virtual-keyboard
protocol, `ydotool` needs `ydotoold` running, and `xdotool` only sees X11 and
Xwayland windows.

## The microphone never starts

Open the app, click **Enable** next to Microphone in **System**, and check the
note under the table. On Linux, make sure PipeWire (or PulseAudio) is running
and the input device is not muted. The app requests mono audio with echo
cancellation and noise suppression.

## The hold key does nothing

Check that the keyboard is readable:

```bash
npm run probe
```

If no keyboard is readable, add your user to the `input` group and log out and
back in, or run with `sg input -c 'npm start -- --no-sandbox'`.

## The HUD is in the wrong place

Native Wayland does not let an app choose its own position. The dev script
already passes `--ozone-platform=x11`; the packaged app restarts itself to get
there. If you set `FN_NATIVE_WAYLAND=1`, the HUD follows the compositor's
placement instead.
