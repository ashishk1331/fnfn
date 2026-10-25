/**
 * Start the development build.
 *
 * Chromium aborts before any window appears when its `chrome-sandbox` helper is
 * present but not owned by root with mode 4755, which is what a plain
 * `npm install` leaves behind; newer Ubuntu also refuses the namespace sandbox
 * that would otherwise be the fallback. Rather than fail on a fresh checkout,
 * this checks the helper first and passes `--no-sandbox` only when the sandbox
 * cannot work. Fix the helper and the flag disappears on its own.
 *
 * Run with: npm start [-- extra electron flags]
 */

import { spawn } from 'node:child_process';
import { statSync } from 'node:fs';
import path from 'node:path';

const WAYLAND_X11_ARG = '--ozone-platform=x11';
const SANDBOX_HELPER = path.join(
  'node_modules',
  'electron',
  'dist',
  'chrome-sandbox',
);

/** Chromium needs the helper owned by root with the setuid bit set. */
function sandboxHelperUsable(): boolean {
  try {
    const stats = statSync(SANDBOX_HELPER);
    return stats.uid === 0 && (stats.mode & 0o4000) !== 0;
  } catch {
    // A missing helper makes Chromium try the namespace sandbox, which either
    // works or reports its own error; leave that decision to Chromium.
    return true;
  }
}

function forgeCommand(): { command: string; args: string[] } {
  const bin = path.join(
    'node_modules',
    '.bin',
    process.platform === 'win32' ? 'electron-forge.cmd' : 'electron-forge',
  );
  return { command: bin, args: ['start'] };
}

function electronArgs(extra: string[]): string[] {
  const args = [WAYLAND_X11_ARG, ...extra];
  const sandboxOff = args.some(
    (arg) => arg === '--no-sandbox' || arg === '--disable-gpu-sandbox',
  );

  if (!sandboxOff && process.platform === 'linux' && !sandboxHelperUsable()) {
    console.warn(
      [
        '',
        'The Electron sandbox helper is not set up, so fnfn starts with --no-sandbox.',
        'Fix it to run with the sandbox again:',
        `  sudo chown root:root ${SANDBOX_HELPER}`,
        `  sudo chmod 4755 ${SANDBOX_HELPER}`,
        '',
      ].join('\n'),
    );
    args.push('--no-sandbox');
  }

  return args;
}

const { command, args } = forgeCommand();
const child = spawn(
  command,
  [...args, '--', ...electronArgs(process.argv.slice(2))],
  { stdio: 'inherit' },
);

for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.on(signal, () => {
    child.kill(signal);
  });
}

child.on('error', (error) => {
  console.error('[start] could not run electron-forge', error);
  process.exitCode = 1;
});

child.on('exit', (code, signal) => {
  if (signal) {
    process.kill(process.pid, signal);
    return;
  }
  process.exitCode = code ?? 0;
});
