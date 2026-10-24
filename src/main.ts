import {
  app,
  BrowserWindow,
  clipboard,
  ipcMain,
  screen,
  session,
  type IpcMainInvokeEvent,
} from 'electron';
import path from 'node:path';
import started from 'electron-squirrel-startup';

import { loadConfig, saveSettings, type AppConfig } from './main/config';
import { HistoryStore } from './main/history';
import { insertTextAtCursor } from './main/insert';
import { InputService } from './main/input-service';
import { OVERLAY_BARS } from './lib/levels';
import { keyName } from './shared/keycodes';
import type {
  HistoryEntry,
  InputStatus,
  InsertResult,
  LearnEvent,
  OverlayState,
  SttInfo,
  TranscriptionResult,
} from './shared/types';
import type { HoldUpdate } from './shared/hold-detector';
import { SttService } from './main/stt';

const WAYLAND_X11_ARG = '--ozone-platform=x11';

/**
 * GNOME's compositor ignores the coordinates a Wayland client asks for, so the
 * HUD cannot be pinned to the top center there. Chromium reads its ozone
 * platform before this script runs, so the only reliable fix is to restart
 * once with the XWayland flag. Chromium switches like this one are parsed at
 * process start, not by app.commandLine.
 */
function restartThroughXWayland(): boolean {
  if (
    process.platform !== 'linux' ||
    !process.env.WAYLAND_DISPLAY ||
    process.env.FN_NATIVE_WAYLAND === '1' ||
    process.argv.includes(WAYLAND_X11_ARG)
  ) {
    return false;
  }

  console.info(
    `[app] restarting with ${WAYLAND_X11_ARG} so the HUD can stay pinned`,
  );

  app.relaunch({ args: [...process.argv.slice(1), WAYLAND_X11_ARG] });
  app.exit(0);
  return true;
}

/**
 * The XWayland restart starts its replacement before this process exits, so the
 * lock is briefly held by a dying parent. A relaunched process retries instead
 * of quitting at once: quitting before `ready` left a second process running
 * with no window, and every later launch then collided with it.
 */
function acquireSingleInstanceLock(timeoutMs = 2500): boolean {
  if (app.requestSingleInstanceLock()) {
    return true;
  }

  if (!process.argv.includes(WAYLAND_X11_ARG)) {
    return false;
  }

  const deadline = Date.now() + timeoutMs;
  const sleeper = new Int32Array(new SharedArrayBuffer(4));
  while (Date.now() < deadline) {
    Atomics.wait(sleeper, 0, 0, 50);
    if (app.requestSingleInstanceLock()) {
      return true;
    }
  }

  return false;
}

if (started) {
  app.quit();
}

// Restart before taking the lock: the replacement process needs to boot while
// this one is still on its way out.
restartThroughXWayland();

const hasSingleInstanceLock = acquireSingleInstanceLock();

if (!hasSingleInstanceLock) {
  app.exit(0);
}

const OVERLAY_WIDTH = 208;
const OVERLAY_HEIGHT = 40;
const OVERLAY_TOP_INSET = 12;
const OVERLAY_HIDE_DELAY_MS = 700;

let mainWindow: BrowserWindow | null = null;
let overlayWindow: BrowserWindow | null = null;
let overlayHideTimer: ReturnType<typeof setTimeout> | null = null;
let inputService: InputService | null = null;
let sttService: SttService | null = null;
let historyStore: HistoryStore | null = null;
let config: AppConfig;

function broadcast(channel: string, payload: unknown): void {
  for (const window of BrowserWindow.getAllWindows()) {
    if (!window.isDestroyed()) {
      window.webContents.send(channel, payload);
    }
  }
}

function createWindow(): void {
  mainWindow = new BrowserWindow({
    width: 840,
    height: 600,
    minWidth: 680,
    minHeight: 480,
    show: false,
    backgroundColor: '#151515',
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  mainWindow.once('ready-to-show', () => {
    mainWindow?.show();
  });

  mainWindow.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  mainWindow.webContents.on('will-navigate', (event, url) => {
    if (url !== mainWindow?.webContents.getURL()) {
      event.preventDefault();
    }
  });

  if (MAIN_WINDOW_VITE_DEV_SERVER_URL) {
    mainWindow.loadURL(MAIN_WINDOW_VITE_DEV_SERVER_URL);
  } else {
    mainWindow.loadFile(
      path.join(__dirname, `../renderer/${MAIN_WINDOW_VITE_NAME}/index.html`),
    );
  }

  if (process.env.FN_DEVTOOLS === '1') {
    mainWindow.webContents.openDevTools({ mode: 'detach' });
  }

  mainWindow.on('closed', () => {
    mainWindow = null;
    overlayWindow?.destroy();
  });
}

function overlayBounds(): Electron.Rectangle {
  const { workArea } = screen.getPrimaryDisplay();
  return {
    width: OVERLAY_WIDTH,
    height: OVERLAY_HEIGHT,
    x: Math.round(workArea.x + (workArea.width - OVERLAY_WIDTH) / 2),
    y: workArea.y + OVERLAY_TOP_INSET,
  };
}

function createOverlayWindow(): void {
  overlayWindow = new BrowserWindow({
    ...overlayBounds(),
    show: false,
    frame: false,
    transparent: true,
    backgroundColor: '#00000000',
    resizable: false,
    movable: false,
    minimizable: false,
    maximizable: false,
    fullscreenable: false,
    skipTaskbar: true,
    focusable: false,
    hasShadow: false,
    alwaysOnTop: true,
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  // Never take focus from the app being dictated into, and never eat clicks.
  overlayWindow.setIgnoreMouseEvents(true);
  overlayWindow.setAlwaysOnTop(true, 'screen-saver');
  overlayWindow.setVisibleOnAllWorkspaces(true, {
    visibleOnFullScreen: true,
  });

  if (MAIN_WINDOW_VITE_DEV_SERVER_URL) {
    void overlayWindow.loadURL(`${MAIN_WINDOW_VITE_DEV_SERVER_URL}#overlay`);
  } else {
    void overlayWindow.loadFile(
      path.join(__dirname, `../renderer/${MAIN_WINDOW_VITE_NAME}/index.html`),
      { hash: 'overlay' },
    );
  }

  overlayWindow.on('closed', () => {
    overlayWindow = null;
  });
}

function showOverlay(): void {
  if (!overlayWindow || overlayWindow.isDestroyed()) {
    return;
  }

  overlayWindow.setBounds(overlayBounds());
  if (!overlayWindow.isVisible()) {
    overlayWindow.showInactive();
  }
}

function hideOverlayAfterIdle(): void {
  if (overlayHideTimer) {
    clearTimeout(overlayHideTimer);
  }

  overlayHideTimer = setTimeout(() => {
    overlayHideTimer = null;
    if (overlayWindow && !overlayWindow.isDestroyed()) {
      overlayWindow.hide();
    }
  }, OVERLAY_HIDE_DELAY_MS);
}

function normalizeOverlayState(payload: OverlayState): OverlayState {
  const phase =
    payload?.phase === 'pending' ||
    payload?.phase === 'recording' ||
    payload?.phase === 'transcribing'
      ? payload.phase
      : 'idle';
  const levels = Array.isArray(payload?.levels)
    ? payload.levels
        .slice(-OVERLAY_BARS)
        .map((level) =>
          Number.isFinite(level) ? Math.min(1, Math.max(0, level)) : 0,
        )
    : [];

  return { phase, levels };
}

function handleOverlayState(payload: OverlayState): void {
  if (!overlayWindow || overlayWindow.isDestroyed()) {
    return;
  }

  const state = normalizeOverlayState(payload);
  overlayWindow.webContents.send('overlay:update', state);

  if (state.phase === 'idle') {
    hideOverlayAfterIdle();
    return;
  }

  if (overlayHideTimer) {
    clearTimeout(overlayHideTimer);
    overlayHideTimer = null;
  }
  showOverlay();
}

function focusMainWindow(): void {
  if (!mainWindow || mainWindow.isDestroyed()) {
    return;
  }
  if (mainWindow.isMinimized()) {
    mainWindow.restore();
  }
  mainWindow.show();
  mainWindow.focus();
}

if (hasSingleInstanceLock) {
  app.on('second-instance', focusMainWindow);
}

function registerIpc(): void {
  ipcMain.handle('input:status', (): InputStatus => {
    if (!inputService) {
      throw new Error('Input service is not ready yet.');
    }
    return inputService.status;
  });

  ipcMain.handle(
    'input:learn',
    (_event: IpcMainInvokeEvent, on: boolean): InputStatus => {
      if (!inputService) {
        throw new Error('Input service is not ready yet.');
      }
      return inputService.setLearning(Boolean(on));
    },
  );

  ipcMain.handle(
    'input:set-key',
    (_event: IpcMainInvokeEvent, payload: { code?: number }): InputStatus => {
      if (!inputService) {
        throw new Error('Input service is not ready yet.');
      }

      const code = Number(payload?.code);
      if (!Number.isInteger(code) || code < 0 || code > 0x2ff) {
        throw new Error('Invalid key code.');
      }

      return inputService.setHoldKey({
        code,
        name: keyName(code),
      });
    },
  );

  ipcMain.on(
    'input:simulate',
    (_event, phase: 'down' | 'up' | string): void => {
      if (!inputService) {
        return;
      }
      if (phase === 'down' || phase === 'up') {
        inputService.simulate(phase);
      }
    },
  );

  ipcMain.on('overlay:state', (_event, payload: OverlayState): void => {
    handleOverlayState(payload);
  });

  ipcMain.handle('stt:info', (): SttInfo => {
    if (!sttService) {
      throw new Error('STT service is not ready yet.');
    }
    return sttService.info;
  });

  ipcMain.handle(
    'stt:transcribe',
    async (
      _event: IpcMainInvokeEvent,
      audio: ArrayBuffer,
      durationMs: number,
    ): Promise<TranscriptionResult> => {
      if (!sttService) {
        throw new Error('STT service is not ready yet.');
      }
      const result = await sttService.transcribe(audio, durationMs);

      if (!result.skipped && result.text) {
        historyStore?.add({ text: result.text });
        broadcast('history:changed', null);
      }

      return result;
    },
  );

  ipcMain.handle(
    'clipboard:write',
    (_event: IpcMainInvokeEvent, text: string): void => {
      if (typeof text !== 'string') {
        throw new Error('Clipboard text must be a string.');
      }
      clipboard.writeText(text);
    },
  );

  ipcMain.handle(
    'insert:text',
    async (_event: IpcMainInvokeEvent, text: string): Promise<InsertResult> => {
      if (typeof text !== 'string') {
        throw new Error('Insert text must be a string.');
      }
      return insertTextAtCursor(text, { tool: config.insertTool });
    },
  );

  ipcMain.handle('history:get', (): HistoryEntry[] => {
    return historyStore ? historyStore.getAll() : [];
  });

  ipcMain.handle('history:clear', (): void => {
    historyStore?.clear();
  });
}

app
  .whenReady()
  .then(async () => {
    if (!hasSingleInstanceLock) {
      return;
    }

    const userDataDir = app.getPath('userData');
    const appRoot = app.getAppPath();
    config = loadConfig(userDataDir, appRoot);
    historyStore = new HistoryStore(userDataDir);

    session.defaultSession.setPermissionRequestHandler(
      (webContents, permission, callback) => {
        callback(
          permission === 'media' && webContents === mainWindow?.webContents,
        );
      },
    );
    session.defaultSession.setPermissionCheckHandler(
      (webContents, permission) =>
        permission === 'media' && webContents === mainWindow?.webContents,
    );

    sttService = new SttService(config);
    inputService = new InputService({
      holdKey: {
        code: config.holdKeyCode,
        name: keyName(config.holdKeyCode),
      },
      thresholdMs: config.holdThresholdMs,
      maxHoldMs: config.maxHoldMs,
      onHoldKeyChange: (key) => {
        saveSettings(userDataDir, { holdKeyCode: key.code });
      },
    });

    inputService.onUpdate((update: HoldUpdate) => {
      broadcast('input:update', update);
    });
    inputService.onStatus((status: InputStatus) => {
      broadcast('input:status', status);
    });
    inputService.onLearn((event: LearnEvent) => {
      broadcast('input:learn', event);
    });

    registerIpc();
    createWindow();
    createOverlayWindow();

    const replaceOverlay = (): void => {
      if (overlayWindow && !overlayWindow.isDestroyed()) {
        overlayWindow.setBounds(overlayBounds());
      }
    };
    screen.on('display-metrics-changed', replaceOverlay);
    screen.on('display-added', replaceOverlay);
    screen.on('display-removed', replaceOverlay);

    try {
      await inputService.start();
    } catch (error) {
      console.error('[input] failed to start', error);
    }

    console.info(
      `[stt] engine=${sttService.info.engine} model=${sttService.info.model}`,
    );

    app.on('activate', () => {
      if (!mainWindow) {
        createWindow();
        if (!overlayWindow) {
          createOverlayWindow();
        }
      }
    });
  })
  .catch((error: unknown) => {
    console.error('[app] failed to start', error);
    app.quit();
  });

app.on('before-quit', () => {
  if (overlayHideTimer) {
    clearTimeout(overlayHideTimer);
    overlayHideTimer = null;
  }
  inputService?.stop();
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});
