# Known limits

- Insertion needs an external tool. None ship with fnfn, and `xdotool` cannot
  type into Wayland-native windows.
- Real global key capture is Linux-only. Other platforms get the simulator.
- Fn detection depends on the keyboard exposing `KEY_FN`. Many do not.
- Whistle is the only engine. There is no mock or whisper.cpp fallback; a
  missing `vendor/needle` is reported as a transcription error.
- Whistle runs as a subprocess, so every hold pays process start and weight
  loading. Previews pay it again for each pass while the key is held.
- Live previews run every 1.4 seconds on the clip so far, so they lag the last
  word and cost CPU on long holds. They skip snippets; the final transcript can
  differ from the last preview.
- Text rules are plain-text, whole-word, case-insensitive replacements. There
  is no regex, phonetic matching, or per-application profile, and snippets
  cannot contain a newline.
- Rules apply to future holds only; changing them does not rewrite **Events**.
- The tray needs StatusNotifier or AppIndicator support. Without it, closing
  the window quits rather than hiding an unreachable app.
- Icons are shipped as PNG and ICO. There is no macOS `.icns` because no macOS
  package is built.
- The VAD is energy-based, not a model. Very loud non-speech can still reach
  Whistle, and quiet speech can be trimmed; there is no per-user calibration.
- Transcriptions are stored as plain text, unencrypted, in the app's user-data
  directory. Only the 200 most recent are kept.
- A compositor that refuses always-on-top will keep the HUD behind other
  windows.
- Recording while another key is pressed is treated as a shortcut and
  cancelled, not as dictation.

## Reading

- [Whistle: Speech to Text in 16.9 MB](https://cactuscompute.com/blog/whistle)
- [Getting the Most out of Whistle](https://cactuscompute.com/blog/whistle-best-practices)
- [What Devices Are Supported on Needle](https://cactuscompute.com/blog/needle-supported-devices)
- [Shipping Local Speech-to-Text in a Desktop AI Assistant: What We Learned Bundling whisper.cpp](https://dev.to/cernalo/shipping-local-speech-to-text-in-a-desktop-ai-assistant-what-we-learned-bundling-whispercpp-jh4)
- [I got tired of typing, so I built a free, offline voice-typing tool](https://dev.to/mskazemi/i-got-tired-of-typing-so-i-built-a-free-offline-voice-typing-tool-open-source-contributors-2fgn)
- [Building cross-distro offline voice dictation for Linux (and why it took more than a model)](https://dev.to/jatinkrmalik/building-cross-distro-offline-voice-dictation-for-linux-and-why-it-took-more-than-a-model-1ie8)
- [How I Built a GNOME Utility to Disable My Laptop Keyboard](https://dev.to/mikachu/how-i-built-a-gnome-utility-to-disable-my-laptop-keyboard-and-what-i-learned-about-linux-input-log)
