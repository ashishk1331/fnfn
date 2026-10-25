/**
 * Generate the checked-in app and tray icons.
 *
 * Run with: npm run icons
 *
 * Reads artwork/app-icon.svg and artwork/tray-icon.svg. Passing --app/--tray
 * overrides them; if a master is missing the built-in artwork is drawn. Every
 * size is rasterized from SVG, so small icons stay crisp.
 */

import { existsSync } from 'node:fs';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { parseArgs } from 'node:util';

import { Resvg, type RenderedImage } from '@resvg/resvg-js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const VIEWBOX = 1024;
const ORANGE = '#ff5a1f';
const BG = '#0b0b0b';
const LINE = '#2e2e2e';

const APP_SIZES = [16, 24, 32, 48, 64, 128, 256, 512, 1024];
const TRAY_SIZES = [16, 22, 24, 32, 44, 48];
const ICO_SIZES = [16, 24, 32, 48, 64, 128, 256];

// The seed artwork `npm run icons` reads by default.
const APP_MASTER = path.join(ROOT, 'artwork', 'app-icon.svg');
const TRAY_MASTER = path.join(ROOT, 'artwork', 'tray-icon.svg');

const num = (value: number): string => String(Number(value.toFixed(3)));

function document(content: string): string {
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" ` +
    `viewBox="0 0 ${VIEWBOX} ${VIEWBOX}" ` +
    `width="${VIEWBOX}" height="${VIEWBOX}">${content}</svg>`
  );
}

/** The dark rounded-square mark with five orange bars. */
function appSvg(): string {
  const pad = VIEWBOX * 0.035;
  const stroke = VIEWBOX * 0.008;
  const radius = VIEWBOX * 0.22;
  const heights = [0.24, 0.44, 0.62, 0.44, 0.24];
  const totalWidth = VIEWBOX * 0.62;
  const gap = VIEWBOX * 0.045;
  const barWidth = (totalWidth - gap * (heights.length - 1)) / heights.length;
  const inset = stroke / 2;
  let x = (VIEWBOX - totalWidth) / 2;

  const bars = heights
    .map((height) => {
      const barHeight = VIEWBOX * height;
      const bar =
        `<rect x="${num(x)}" y="${num((VIEWBOX - barHeight) / 2)}" ` +
        `width="${num(barWidth)}" height="${num(barHeight)}" ` +
        `rx="${num(barWidth / 2)}" fill="${ORANGE}" />`;
      x += barWidth + gap;
      return bar;
    })
    .join('');

  return document(
    `<rect x="${num(pad + inset)}" y="${num(pad + inset)}" ` +
      `width="${num(VIEWBOX - pad * 2 - stroke)}" ` +
      `height="${num(VIEWBOX - pad * 2 - stroke)}" ` +
      `rx="${num(radius - inset)}" fill="${BG}" ` +
      `stroke="${LINE}" stroke-width="${num(stroke)}" />` +
      bars,
  );
}

/** The transparent orange waveform used in the tray. */
function traySvg(): string {
  const heights = [0.3, 0.62, 0.92, 0.52];
  const totalWidth = VIEWBOX * 0.86;
  const gap = VIEWBOX * 0.085;
  const barWidth = (totalWidth - gap * (heights.length - 1)) / heights.length;
  let x = (VIEWBOX - totalWidth) / 2;

  const bars = heights
    .map((height) => {
      const barHeight = VIEWBOX * height;
      const bar =
        `<rect x="${num(x)}" y="${num((VIEWBOX - barHeight) / 2)}" ` +
        `width="${num(barWidth)}" height="${num(barHeight)}" ` +
        `rx="${num(barWidth / 2)}" fill="${ORANGE}" />`;
      x += barWidth + gap;
      return bar;
    })
    .join('');

  return document(bars);
}

/** Rasterize one square size; throws when the source aspect ratio is wrong. */
function renderAt(svg: string, size: number, label = 'SVG'): RenderedImage {
  const image = new Resvg(svg, {
    fitTo: { mode: 'width', value: size },
    background: 'rgba(0, 0, 0, 0)',
  }).render();

  if (image.width !== image.height) {
    throw new Error(
      `${label} must be square; it renders ${image.width}x${image.height} at ${size}px`,
    );
  }
  if (image.width !== size) {
    throw new Error(`${label} did not render at ${size}px`);
  }

  return image;
}

/** True when any pixel is not fully opaque. */
function hasTransparency(image: RenderedImage): boolean {
  const pixels = image.pixels;
  for (let index = 3; index < pixels.length; index += 4) {
    if (pixels[index] < 255) {
      return true;
    }
  }
  return false;
}

interface IcoFrame {
  size: number;
  png: Buffer;
}

/** Pack PNG frames into a Windows ICO container. */
function buildIco(frames: IcoFrame[]): Buffer {
  const sorted = [...frames].sort((a, b) => a.size - b.size);
  const header = Buffer.alloc(6);
  header.writeUInt16LE(0, 0);
  header.writeUInt16LE(1, 2);
  header.writeUInt16LE(sorted.length, 4);

  const entries = Buffer.alloc(16 * sorted.length);
  let offset = header.length + entries.length;

  sorted.forEach((frame, index) => {
    if (frame.size > 256) {
      throw new Error(`ICO frames cannot be larger than 256px (${frame.size})`);
    }
    const entry = index * 16;
    const dimension = frame.size === 256 ? 0 : frame.size;
    entries.writeUInt8(dimension, entry);
    entries.writeUInt8(dimension, entry + 1);
    entries.writeUInt8(0, entry + 2);
    entries.writeUInt8(0, entry + 3);
    entries.writeUInt16LE(1, entry + 4);
    entries.writeUInt16LE(32, entry + 6);
    entries.writeUInt32LE(frame.png.length, entry + 8);
    entries.writeUInt32LE(offset, entry + 12);
    offset += frame.png.length;
  });

  return Buffer.concat([header, entries, ...sorted.map((frame) => frame.png)]);
}

function expandHome(value: string): string {
  if (value === '~') {
    return os.homedir();
  }
  return value.startsWith('~/')
    ? path.join(os.homedir(), value.slice(2))
    : value;
}

async function loadSvg(file: string, label: string): Promise<string> {
  const resolved = path.resolve(expandHome(file));
  if (path.extname(resolved).toLowerCase() !== '.svg') {
    throw new Error(`${label} master must be an .svg file: ${file}`);
  }

  let source: string;
  try {
    source = await readFile(resolved, 'utf8');
  } catch {
    throw new Error(`${label} master not found: ${file}`);
  }

  renderAt(source, 256, `${label} SVG`);
  return source;
}

function pngAt(pngs: Map<number, Buffer>, size: number): Buffer {
  const png = pngs.get(size);
  if (!png) {
    throw new Error(`Missing ${size}px render`);
  }
  return png;
}

interface Master {
  source: string;
  name: string;
  fromFile: boolean;
}

/**
 * Use the requested master, otherwise the seed file in `artwork/`, otherwise
 * the built-in drawing. The resolved name is printed so the source is never
 * ambiguous.
 */
async function pickMaster(
  flag: string | undefined,
  fallback: string,
  label: string,
  builtin: () => string,
): Promise<Master> {
  if (flag) {
    return { source: await loadSvg(flag, label), name: flag, fromFile: true };
  }

  const relative = path.relative(ROOT, fallback);
  if (existsSync(fallback)) {
    return {
      source: await loadSvg(fallback, label),
      name: relative,
      fromFile: true,
    };
  }

  console.log(
    `note: ${relative} not found, drawing the built-in ${label.toLowerCase()} artwork`,
  );
  return { source: builtin(), name: 'built-in artwork', fromFile: false };
}

function usage(): string {
  return [
    'Usage: npm run icons [-- options]',
    '',
    'Reads artwork/app-icon.svg and artwork/tray-icon.svg by default.',
    '',
    '  --app <file.svg>   override the app, window, and package master',
    '  --tray <file.svg>  override the tray master (transparent background)',
    '  --out <dir>        write below <dir> instead of the repo root',
    '  -h, --help         show this help',
    '',
    'A missing master falls back to the built-in artwork. Masters must be square.',
    'Examples:',
    '  npm run icons',
    '  npm run icons -- --out /tmp/icons',
  ].join('\n');
}

async function main(): Promise<void> {
  const { values } = parseArgs({
    options: {
      app: { type: 'string' },
      tray: { type: 'string' },
      out: { type: 'string' },
      help: { type: 'boolean', short: 'h' },
    },
  });

  if (values.help) {
    console.log(usage());
    return;
  }

  const out = path.resolve(expandHome(values.out ?? ROOT));
  const icons = path.join(out, 'assets', 'icons');
  const tray = path.join(out, 'assets', 'tray');
  await mkdir(icons, { recursive: true });
  await mkdir(tray, { recursive: true });

  const appMaster = await pickMaster(values.app, APP_MASTER, 'App', appSvg);
  const trayMaster = await pickMaster(
    values.tray,
    TRAY_MASTER,
    'Tray',
    traySvg,
  );

  const appPngs = new Map<number, Buffer>();
  for (const size of APP_SIZES) {
    appPngs.set(size, renderAt(appMaster.source, size, 'App').asPng());
  }

  const tray48 = renderAt(trayMaster.source, 48, 'Tray');
  const trayPngs = new Map<number, Buffer>();
  for (const size of TRAY_SIZES) {
    trayPngs.set(
      size,
      size === 48
        ? tray48.asPng()
        : renderAt(trayMaster.source, size, 'Tray').asPng(),
    );
  }

  for (const [size, png] of appPngs) {
    await writeFile(path.join(icons, `${size}x${size}.png`), png);
  }
  await writeFile(path.join(icons, 'icon.png'), pngAt(appPngs, 512));
  await writeFile(
    path.join(icons, 'icon.ico'),
    buildIco(
      ICO_SIZES.map((size) => ({
        size,
        png: pngAt(appPngs, size),
      })),
    ),
  );

  for (const [size, png] of trayPngs) {
    await writeFile(path.join(tray, `${size}x${size}.png`), png);
  }
  await writeFile(path.join(tray, 'tray.png'), pngAt(trayPngs, 22));
  await writeFile(path.join(tray, 'tray@2x.png'), pngAt(trayPngs, 44));

  if (trayMaster.fromFile && !hasTransparency(tray48)) {
    console.warn(
      'warning: the tray renders fully opaque; a square background will show on panels',
    );
  }

  console.log(`wrote ${APP_SIZES.length + 2} app icons to ${icons}`);
  console.log(`wrote ${TRAY_SIZES.length + 2} tray icons to ${tray}`);
  console.log(`masters: app=${appMaster.name}, tray=${trayMaster.name}`);
}

const invokedDirectly =
  process.argv[1] !== undefined &&
  import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href;

if (invokedDirectly) {
  main().catch((error: unknown) => {
    console.error(
      `icons: ${error instanceof Error ? error.message : String(error)}`,
    );
    process.exitCode = 1;
  });
}
