/**
 * Print the Linux input devices fnfn can see, without recording anything.
 *
 * Run with: npm run probe
 */

import { listInputDevices } from '../src/main/evdev';

async function main(): Promise<void> {
  if (process.platform !== 'linux') {
    console.log('This probe only applies to Linux evdev.');
    return;
  }

  const devices = await listInputDevices();

  if (devices.length === 0) {
    console.error(
      'No /dev/input/event* devices found. Is this a Linux desktop with evdev?',
    );
    process.exitCode = 1;
    return;
  }

  const keyboards = devices.filter((device) => device.isKeyboard);
  const readable = keyboards.filter((device) => device.readable);
  const denied = keyboards.filter((device) => !device.readable);
  const fnDevices = devices.filter((device) => device.hasFn);

  console.log('\nfnfn input probe\n');
  console.table(
    devices.map((device) => ({
      path: device.path,
      name: device.name,
      keyboard: device.isKeyboard ? 'yes' : '',
      readable: device.readable ? 'yes' : 'NO',
      fn: device.hasFn ? 'YES' : '',
      phys: device.phys,
    })),
  );

  console.log(
    `\n${readable.length}/${keyboards.length} keyboard-like devices readable.`,
  );

  if (fnDevices.length > 0) {
    console.log(
      `KEY_FN is advertised by: ${fnDevices
        .map((device) => `${device.path} (${device.name})`)
        .join(', ')}`,
    );
  } else {
    console.log(
      'No device advertises KEY_FN. This is common: most laptop Fn keys are handled by the embedded controller and never reach evdev. Use the simulator, pick another key in Learn a key, or bind a key your keyboard does expose.',
    );
  }

  if (denied.length > 0) {
    console.log(
      `\n${denied.length} keyboard device${
        denied.length === 1 ? ' is' : 's are'
      } not readable. Grant access with:`,
    );
    console.log('  sudo usermod -aG input $USER');
    console.log('Then log out and back in. This is keylogger-level access.\n');
  } else {
    console.log('\nAll keyboard devices are readable.\n');
  }
}

void main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
