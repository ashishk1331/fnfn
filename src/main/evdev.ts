/**
 * Minimal Linux evdev reader.
 *
 * We read /dev/input/event* passively (no EVIOCGRAB), so the keys still reach
 * the focused application. This is the only reliable way to see global keys
 * under Wayland without a compositor portal, and it also exposes KEY_FN on
 * keyboards that actually emit it.
 *
 * Permission: the user must be able to read the event device, usually via the
 * `input` group. That is a keylogger-level privilege, so keep it opt-in.
 */

import { constants as fsConstants } from 'node:fs';
import { access, open, readdir, readFile } from 'node:fs/promises';
import type { ReadStream } from 'node:fs';

import type { InputDeviceInfo } from '../shared/types';

const INPUT_DIR = '/dev/input';
const EVENT_SIZE = 24; // struct input_event on 64-bit Linux
const EV_KEY = 1;

const KEY_A = 30;
const KEY_SPACE = 57;
const KEY_RIGHTCTRL = 97;
const KEY_MICMUTE = 248;
const KEY_FN = 464;
const KEY_FN_ESC = 465;

export interface RawKeyEvent {
  code: number;
  value: 0 | 1 | 2;
  at: number;
  devicePath: string;
  deviceName: string;
}

export interface EvdevStartResult {
  devices: InputDeviceInfo[];
  reading: string[];
  denied: string[];
}

function bitmapHas(words: string[], code: number): boolean {
  const word = words[Math.floor(code / 64)];
  if (!word) {
    return false;
  }

  try {
    return (BigInt(`0x${word}`) & (1n << BigInt(code % 64))) !== 0n;
  } catch {
    return false;
  }
}

function parseKeyBitmap(raw: string): string[] {
  return raw.trim().split(/\s+/).filter(Boolean).reverse();
}

function looksLikeKeyboard(words: string[]): boolean {
  return (
    bitmapHas(words, KEY_A) ||
    bitmapHas(words, KEY_SPACE) ||
    bitmapHas(words, KEY_RIGHTCTRL) ||
    bitmapHas(words, KEY_MICMUTE) ||
    bitmapHas(words, KEY_FN) ||
    bitmapHas(words, KEY_FN_ESC)
  );
}

export async function listInputDevices(): Promise<InputDeviceInfo[]> {
  if (process.platform !== 'linux') {
    return [];
  }

  let entries: string[];
  try {
    entries = await readdir(INPUT_DIR);
  } catch {
    return [];
  }

  const eventNames = entries
    .filter((entry) => /^event\d+$/.test(entry))
    .sort((a, b) => Number(a.slice(5)) - Number(b.slice(5)));

  const devices = await Promise.all(
    eventNames.map(async (eventName) => {
      const path = `${INPUT_DIR}/${eventName}`;
      const sysfs = `/sys/class/input/${eventName}/device`;

      const [name, phys, capabilities, readable] = await Promise.all([
        readFile(`${sysfs}/name`, 'utf8').catch(() => ''),
        readFile(`${sysfs}/phys`, 'utf8').catch(() => ''),
        readFile(`${sysfs}/capabilities/key`, 'utf8').catch(() => ''),
        access(path, fsConstants.R_OK).then(
          () => true,
          () => false,
        ),
      ]);

      const words = parseKeyBitmap(capabilities);

      return {
        path,
        name: name.trim() || eventName,
        phys: phys.trim(),
        readable,
        isKeyboard: looksLikeKeyboard(words),
        hasFn: bitmapHas(words, KEY_FN),
      } satisfies InputDeviceInfo;
    }),
  );

  return devices;
}

export class EvdevSource {
  private readonly streams = new Map<string, ReadStream>();
  private readonly buffers = new Map<string, Buffer>();
  private stopping = false;

  onKey: ((event: RawKeyEvent) => void) | null = null;
  onDeviceError: ((path: string, message: string) => void) | null = null;

  get reading(): string[] {
    return [...this.streams.keys()];
  }

  async start(): Promise<EvdevStartResult> {
    this.stopping = false;

    const allDevices = await listInputDevices();
    const candidates = allDevices.filter(
      (device) => device.isKeyboard && device.readable,
    );
    const denied = allDevices
      .filter((device) => device.isKeyboard && !device.readable)
      .map((device) => device.path);

    for (const device of candidates) {
      try {
        const handle = await open(device.path, 'r');
        const stream = handle.createReadStream({
          highWaterMark: EVENT_SIZE * 256,
        });

        this.streams.set(device.path, stream);
        this.buffers.set(device.path, Buffer.alloc(0));

        stream.on('data', (chunk: Buffer) => {
          this.consume(device, chunk);
        });
        stream.on('error', (error: Error) => {
          if (!this.stopping) {
            this.onDeviceError?.(device.path, error.message);
          }
        });
        stream.on('close', () => {
          this.streams.delete(device.path);
          this.buffers.delete(device.path);
        });
      } catch {
        denied.push(device.path);
      }
    }

    // A device can be readable according to access() but fail to open (for
    // example if it disappears between the two calls). Keep the union honest.
    const uniqueDenied = [...new Set(denied)];
    const reading = this.reading;

    return {
      devices: allDevices,
      reading,
      denied: uniqueDenied.filter((path) => !reading.includes(path)),
    };
  }

  stop(): void {
    this.stopping = true;

    for (const stream of this.streams.values()) {
      stream.removeAllListeners('error');
      stream.destroy();
    }

    this.streams.clear();
    this.buffers.clear();
  }

  private consume(device: InputDeviceInfo, chunk: Buffer): void {
    const previous = this.buffers.get(device.path) ?? Buffer.alloc(0);
    const buffer =
      previous.length > 0 ? Buffer.concat([previous, chunk]) : chunk;
    const usable = buffer.length - (buffer.length % EVENT_SIZE);

    for (let offset = 0; offset < usable; offset += EVENT_SIZE) {
      const seconds = Number(buffer.readBigInt64LE(offset));
      const micros = Number(buffer.readBigInt64LE(offset + 8));
      const type = buffer.readUInt16LE(offset + 16);
      const code = buffer.readUInt16LE(offset + 18);
      const value = buffer.readInt32LE(offset + 20);

      if (type !== EV_KEY || (value !== 0 && value !== 1 && value !== 2)) {
        continue;
      }

      const kernelTime = seconds > 0 ? seconds * 1000 + micros / 1000 : 0;
      const at = kernelTime > 0 ? kernelTime : Date.now();

      this.onKey?.({
        code,
        value,
        at,
        devicePath: device.path,
        deviceName: device.name,
      });
    }

    this.buffers.set(
      device.path,
      buffer.length === usable
        ? Buffer.alloc(0)
        : Buffer.from(buffer.subarray(usable)),
    );
  }
}
