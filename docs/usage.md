# Using fnfn

## A hold

Hold the talk key, speak, and release. Capture starts on key-down, so the first
syllable is not lost. A tap shorter than the hold threshold is discarded.

- Default key: **Right Alt** (`KEY_RIGHTALT`, code 100)
- Threshold: 250 ms
- Maximum recording length: 120 seconds

The transcript is typed into the focused window and shown in **Live**. Every
successful transcription is also listed in **Events**, newest first.

Pressing another key while holding the talk key is treated as a shortcut and
cancels the hold.

## Changing the key

Open **System** and press **Change**, then press the key you want. Learning mode
accepts any key that reaches evdev, including Fn when the keyboard exposes it.
The choice is saved in the app's settings file.

## Insert at cursor

After a successful hold, fnfn types the transcript into whatever window has
keyboard focus. **Copy** in Live stays available. If no typing tool is
installed, the transcript is copied to the clipboard and Live says why.

fnfn does not implement input injection itself; it drives the first tool it
finds:

| Session | Order                           | Notes                                                                                           |
| ------- | ------------------------------- | ----------------------------------------------------------------------------------------------- |
| Wayland | `wtype` → `ydotool` → `xdotool` | `wtype` needs a wlroots compositor; `ydotool` needs `ydotoold`; `xdotool` only reaches Xwayland |
| X11     | `xdotool` → `ydotool`           | `xdotool` is the reliable choice                                                                |

Debian/Ubuntu package names are the same as the commands:

```bash
sudo apt install xdotool   # X11
sudo apt install wtype     # Wayland with the virtual-keyboard protocol
sudo apt install ydotool   # Wayland, any compositor; also needs ydotoold and /dev/uinput access
```

Force one tool with `FN_INSERT_TOOL=xdotool`, `ydotool`, or `wtype`. `auto`
resolves on every insert, so installing a tool does not need a restart.

Typing follows keyboard focus, so keep the target app focused while you hold
the key. Synthetic typing can reach any application, which is the same power as
evdev capture: only use this on a machine you control.

## Floating HUD

While a hold is active, a compact card appears at the top center of the display
under the pointer: a dot, a state word, and a live waveform. It hides again shortly after
the transcript is done.

The HUD is a separate frameless Electron window with these properties:

- `alwaysOnTop` at the `screen-saver` level, and visible on all workspaces,
  including full-screen apps.
- `focusable: false` and shown with `showInactive()`, so the window you are
  dictating into keeps focus and insertion lands in the right place.
- Click-through (`setIgnoreMouseEvents`), so it never blocks the screen under it.
- Positioned from the active display's work area, re-centered on each hold and
  when display metrics change. There is no timer or stop button: releasing the key ends the
  hold.

Windows are positioned by the compositor on Wayland, and GNOME ignores the
coordinates an app asks for. Chromium reads its ozone platform before any app
code runs, so when `WAYLAND_DISPLAY` is set and the flag is missing, fnfn
restarts itself once with `--ozone-platform=x11`. That puts its windows on
XWayland, where the HUD can be pinned. Set `FN_NATIVE_WAYLAND=1` to keep the
native Wayland backend; the HUD then follows whatever position GNOME picks.

## The Fn key

There is no portable "Fn key" event. Fn is usually handled by the keyboard's
embedded controller, and many laptops never expose it to the OS at all.

On the HP laptop used to build this, `event3` ("AT Translated Set 2 keyboard")
advertises `KEY_FN_ESC` (465) and `KEY_F1`–`KEY_F12`, but **not** `KEY_FN` (464).
No device advertises `KEY_FN`. That is why the default is Right Alt.

If your keyboard does emit `KEY_FN`, **Change** in **System** can bind it. If it
does not, no userspace application can observe Fn alone; that is a firmware
limitation. On Wayland, compositors also block X11-style global hooks, which is
why fnfn reads evdev directly.
