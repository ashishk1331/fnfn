#!/usr/bin/env python3
"""Regenerate the checked-in app and tray icons.

Requires Pillow: python3 -m pip install pillow
Run from anywhere: python3 scripts/make-icons.py
"""

from pathlib import Path

from PIL import Image, ImageDraw

ROOT = Path(__file__).resolve().parent.parent
ORANGE = (255, 90, 31, 255)
BG = (11, 11, 11, 255)
LINE = (46, 46, 46, 255)


def draw_app(size: int) -> Image.Image:
    scale = 8
    n = size * scale
    img = Image.new('RGBA', (n, n), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)
    pad = round(n * 0.035)
    radius = round(n * 0.22)
    d.rounded_rectangle(
        [pad, pad, n - pad - 1, n - pad - 1],
        radius=radius,
        fill=BG,
        outline=LINE,
        width=max(1, round(n * 0.008)),
    )
    heights = [0.24, 0.44, 0.62, 0.44, 0.24]
    total_w = 0.62 * n
    gap = 0.045 * n
    bar_w = (total_w - gap * 4) / 5
    x = (n - total_w) / 2
    mid = n / 2
    for height in heights:
        bar_h = n * height
        d.rounded_rectangle(
            [x, mid - bar_h / 2, x + bar_w, mid + bar_h / 2],
            radius=bar_w / 2,
            fill=ORANGE,
        )
        x += bar_w + gap
    return img.resize((size, size), Image.LANCZOS)


def draw_tray(size: int) -> Image.Image:
    scale = 8
    n = size * scale
    img = Image.new('RGBA', (n, n), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)
    heights = [0.30, 0.62, 0.92, 0.52]
    total_w = 0.86 * n
    gap = 0.085 * n
    bar_w = (total_w - gap * 3) / 4
    x = (n - total_w) / 2
    mid = n / 2
    for height in heights:
        bar_h = n * height
        d.rounded_rectangle(
            [x, mid - bar_h / 2, x + bar_w, mid + bar_h / 2],
            radius=bar_w / 2,
            fill=ORANGE,
        )
        x += bar_w + gap
    return img.resize((size, size), Image.LANCZOS)


def main() -> None:
    icons = ROOT / 'assets' / 'icons'
    tray = ROOT / 'assets' / 'tray'
    icons.mkdir(parents=True, exist_ok=True)
    tray.mkdir(parents=True, exist_ok=True)

    for size in (16, 24, 32, 48, 64, 128, 256, 512, 1024):
        draw_app(size).save(icons / f'{size}x{size}.png')
    draw_app(512).save(icons / 'icon.png')
    draw_app(256).save(
        icons / 'icon.ico',
        sizes=[(16, 16), (24, 24), (32, 32), (48, 48), (64, 64), (128, 128), (256, 256)],
    )

    for size in (16, 22, 24, 32, 44, 48):
        draw_tray(size).save(tray / f'{size}x{size}.png')
    draw_tray(22).save(tray / 'tray.png')
    draw_tray(44).save(tray / 'tray@2x.png')


if __name__ == '__main__':
    main()
