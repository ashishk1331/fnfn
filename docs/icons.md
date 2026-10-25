# Icons

The checked-in sets live in `assets/` and are copied into `app.asar`, so the
window and tray read the same files in development and in a package.

## Sizes

| Use                           | File                                  | Sizes                                   |
| ----------------------------- | ------------------------------------- | --------------------------------------- |
| Tray, Linux default           | `assets/tray/22x22.png`               | 22×22                                   |
| Tray, HiDPI                   | `assets/tray/44x44.png`               | 44×44 (2×)                              |
| Tray, desktop-environment set | `assets/tray/{16,24,32,48}x*.png`     | 16, 24, 32, 48                          |
| Tray convenience copies       | `assets/tray/tray.png`, `tray@2x.png` | 22, 44                                  |
| Window and dock               | `assets/icons/256x256.png`            | 256                                     |
| Launcher icon set             | `assets/icons/{16..1024}x*.png`       | 16, 24, 32, 48, 64, 128, 256, 512, 1024 |
| Debian and RPM package icon   | `assets/icons/512x512.png`            | 512 PNG                                 |
| Windows installer icon        | `assets/icons/icon.ico`               | 16–256 multi-size ICO                   |

`assets/icons/icon.png` is a 512×512 convenience copy.

The runtime tray uses 22×22 as the base image and adds 44×44 as a 2×
representation, so one code path covers both normal and HiDPI panels. The
window passes 256×256 to `BrowserWindow`, which the compositor scales for the
dock. The `.deb` and `.rpm` makers take the 512 PNG, and Squirrel takes the
`.ico`.

## Not included

- macOS `.icns`: no macOS package is built (`MakerZIP` targets darwin, but the
  app has not been tested there). If that changes, add 16–512 at 1× and 2× in
  an `.icns` and point the packager at it.
- SVG sources: the artwork is generated at raster sizes; there is no vector
  master.

## Regenerating

The icons are committed, so a normal build does not touch them. To change the
artwork, edit `scripts/make-icons.py` and run:

```bash
python3 -m pip install pillow
python3 scripts/make-icons.py
```

The script redraws the dark rounded-square app icon and the transparent orange
tray waveform at every size above. Check the 16×16 and 22×22 results by eye
before committing; small sizes lose the thin border quickly.
