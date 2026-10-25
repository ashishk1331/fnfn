import {
  app,
  BrowserWindow,
  clipboard,
  ipcMain,
  Menu,
  nativeImage,
  screen,
  session,
  shell,
  Tray,
  type IpcMainInvokeEvent,
} from 'electron';
import path from 'node:path';
import started from 'electron-squirrel-startup';

import { loadConfig, saveSettings, type AppConfig } from './main/config';
import { HistoryStore } from './main/history';
import { insertTextAtCursor } from './main/insert';
import { InputService } from './main/input-service';
import { OVERLAY_BARS } from './lib/levels';
import { SearchStore } from './main/search-store';
import { ResearchService } from './main/research';
import { sanitizeSourceUrl } from './shared/search';
import { keyLabel, keyName } from './shared/keycodes';
import { normalizeTextRules, type TextRules } from './shared/text-rules';
import type {
  AgentSettings,
  HistoryEntry,
  InputStatus,
  InsertResult,
  LearnEvent,
  OverlayMode,
  OverlayPhase,
  OverlaySource,
  OverlayState,
  SearchEntry,
  SearchProgress,
  SttInfo,
  TranscriptionMode,
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
const OVERLAY_SEARCH_WIDTH = 380;
const OVERLAY_SEARCH_HEIGHT = 46;
const OVERLAY_RESULT_WIDTH = 540;
const OVERLAY_RESULT_HEIGHT = 232;
const OVERLAY_TOP_INSET = 12;
const OVERLAY_HIDE_DELAY_MS = 700;
const OVERLAY_RESULT_HIDE_MS = 12_000;

let mainWindow: BrowserWindow | null = null;
let overlayWindow: BrowserWindow | null = null;
let tray: Tray | null = null;
let overlayHideTimer: ReturnType<typeof setTimeout> | null = null;
let inputService: InputService | null = null;
let sttService: SttService | null = null;
let historyStore: HistoryStore | null = null;
let searchStore: SearchStore | null = null;
let researchService: ResearchService | null = null;
let config: AppConfig;
let textRules: TextRules;
let isQuitting = false;
let closeToTray = false;
let lastOverlayShape: OverlayShape = { phase: 'idle', mode: 'dictate' };

const OVERLAY_PHASES: readonly OverlayPhase[] = [
  'idle',
  'pending',
  'recording',
  'transcribing',
  'searching',
  'reading',
  'answering',
  'done',
  'error',
];

function assetPath(...parts: string[]): string {
  return path.join(app.getAppPath(), 'assets', ...parts);
}

function trayImage(): Electron.NativeImage {
  const image = nativeImage.createFromPath(assetPath('tray', '22x22.png'));
  const hiRes = nativeImage.createFromPath(assetPath('tray', '44x44.png'));
  if (!hiRes.isEmpty()) {
    image.addRepresentation({ scaleFactor: 2, buffer: hiRes.toPNG() });
  }
  return image;
}

function createTray(): void {
  if (tray) {
    return;
  }

  try {
    const image = trayImage();
    if (image.isEmpty()) {
      throw new Error('tray icon could not be loaded');
    }

    tray = new Tray(image);
    tray.setToolTip(`fnfn — hold ${keyLabel(config.holdKeyCode)} to dictate`);
    tray.setContextMenu(
      Menu.buildFromTemplate([
        { label: 'Show fnfn', click: focusMainWindow },
        { type: 'separator' },
        {
          label: 'Quit fnfn',
          click: () => {
            isQuitting = true;
            app.quit();
          },
        },
      ]),
    );
    tray.on('click', focusMainWindow);
    closeToTray = true;
  } catch (error) {
    // Without a tray, hiding the window on close would make the app
    // unreachable, so closing the window quits instead.
    console.warn('[app] tray unavailable; closing quits', error);
    tray = null;
    closeToTray = false;
  }
}

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
    icon: assetPath('icons', '256x256.png'),
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

  mainWindow.on('close', (event) => {
    if (!isQuitting && closeToTray) {
      event.preventDefault();
      mainWindow?.hide();
      return;
    }

    mainWindow = null;
    overlayWindow?.destroy();
  });
}

interface OverlayShape {
  phase: OverlayPhase;
  mode: OverlayMode;
}

function overlaySize(state?: OverlayShape): {
  width: number;
  height: number;
} {
  if (state?.phase === 'done' || state?.phase === 'error') {
    return { width: OVERLAY_RESULT_WIDTH, height: OVERLAY_RESULT_HEIGHT };
  }

  if (
    state?.mode === 'search' ||
    state?.phase === 'searching' ||
    state?.phase === 'reading' ||
    state?.phase === 'answering'
  ) {
    return { width: OVERLAY_SEARCH_WIDTH, height: OVERLAY_SEARCH_HEIGHT };
  }

  return { width: OVERLAY_WIDTH, height: OVERLAY_HEIGHT };
}

function overlayBounds(state?: OverlayShape): Electron.Rectangle {
  const { width, height } = overlaySize(state);
  const { workArea } = screen.getDisplayNearestPoint(
    screen.getCursorScreenPoint(),
  );
  return {
    width,
    height,
    x: Math.round(workArea.x + (workArea.width - width) / 2),
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

function showOverlay(state?: OverlayShape): void {
  if (!overlayWindow || overlayWindow.isDestroyed()) {
    return;
  }

  overlayWindow.setBounds(overlayBounds(state));
  if (!overlayWindow.isVisible()) {
    overlayWindow.showInactive();
  }
}

function hideOverlayAfter(delayMs: number): void {
  if (overlayHideTimer) {
    clearTimeout(overlayHideTimer);
  }

  overlayHideTimer = setTimeout(() => {
    overlayHideTimer = null;
    if (overlayWindow && !overlayWindow.isDestroyed()) {
      overlayWindow.hide();
    }
  }, delayMs);
}

function overlayText(value: unknown, max: number): string | undefined {
  return typeof value === 'string' && value.trim()
    ? value.trim().slice(0, max)
    : undefined;
}

function normalizeOverlayState(payload: OverlayState): OverlayState {
  const phase = OVERLAY_PHASES.includes(payload?.phase)
    ? payload.phase
    : 'idle';
  const mode: OverlayMode = payload?.mode === 'search' ? 'search' : 'dictate';
  const levels = Array.isArray(payload?.levels)
    ? payload.levels
        .slice(-OVERLAY_BARS)
        .map((level) =>
          Number.isFinite(level) ? Math.min(1, Math.max(0, level)) : 0,
        )
    : [];
  const sources: OverlaySource[] = Array.isArray(payload?.sources)
    ? payload.sources
        .slice(0, 4)
        .map((source): OverlaySource | null => {
          const url =
            typeof source?.url === 'string'
              ? sanitizeSourceUrl(source.url)
              : null;
          if (!url) {
            return null;
          }
          const title = overlayText(source?.title, 120) ?? url;
          return { title, url };
        })
        .filter((source): source is OverlaySource => source !== null)
    : [];

  const state: OverlayState = { phase, mode, levels };
  const query = overlayText(payload?.query, 300);
  const answer = overlayText(payload?.answer, 600);
  const message = overlayText(payload?.message, 300);
  if (query) {
    state.query = query;
  }
  if (answer) {
    state.answer = answer;
  }
  if (message) {
    state.message = message;
  }
  if (sources.length > 0) {
    state.sources = sources;
  }

  return state;
}

function handleOverlayState(payload: OverlayState): void {
  if (!overlayWindow || overlayWindow.isDestroyed()) {
    return;
  }

  const state = normalizeOverlayState(payload);
  lastOverlayShape = { phase: state.phase, mode: state.mode };
  overlayWindow.webContents.send('overlay:update', state);

  if (state.phase === 'idle') {
    hideOverlayAfter(OVERLAY_HIDE_DELAY_MS);
    return;
  }

  if (overlayHideTimer) {
    clearTimeout(overlayHideTimer);
    overlayHideTimer = null;
  }
  showOverlay(state);

  if (state.phase === 'done' || state.phase === 'error') {
    hideOverlayAfter(OVERLAY_RESULT_HIDE_MS);
  }
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

async function currentAgentSettings(): Promise<AgentSettings> {
  const tinyfishFromEnv = Boolean(process.env.TINYFISH_API_KEY);
  const tinyfishConfigured = Boolean(config.tinyfishApiKey);
  const needleReady = (await researchService?.needleReady()) ?? false;

  let tinyfishHint = 'Add a TinyFish API key to enable web search.';
  if (tinyfishFromEnv) {
    tinyfishHint =
      'Using TINYFISH_API_KEY from the environment. It wins over a saved key.';
  } else if (tinyfishConfigured) {
    tinyfishHint = 'TinyFish key saved. Search is ready.';
  }

  return {
    tinyfishConfigured,
    tinyfishFromEnv,
    tinyfishHint,
    needleReady,
    needleModel: path.basename(config.needleModel),
  };
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
      mode?: TranscriptionMode,
    ): Promise<TranscriptionResult> => {
      if (!sttService) {
        throw new Error('STT service is not ready yet.');
      }

      const transcriptionMode: TranscriptionMode =
        mode === 'search' ? 'search' : 'dictate';
      const result = await sttService.transcribe(
        audio,
        durationMs,
        transcriptionMode,
      );

      if (transcriptionMode === 'dictate' && !result.skipped && result.text) {
        historyStore?.add({ text: result.text });
        broadcast('history:changed', null);
      }

      return result;
    },
  );

  ipcMain.on('stt:preview-start', (): void => {
    sttService?.startPreview();
  });

  ipcMain.on(
    'stt:preview-chunk',
    (_event, chunk: ArrayBuffer | Uint8Array): void => {
      if (!sttService) {
        return;
      }
      if (chunk instanceof ArrayBuffer) {
        sttService.pushPreviewAudio(chunk);
      } else if (ArrayBuffer.isView(chunk)) {
        const copy = new Uint8Array(chunk.byteLength);
        copy.set(chunk);
        sttService.pushPreviewAudio(copy.buffer);
      }
    },
  );

  ipcMain.on('stt:preview-stop', (): void => {
    void sttService?.stopPreview();
  });

  ipcMain.handle('rules:get', (): TextRules => textRules);

  ipcMain.handle(
    'rules:set',
    (_event: IpcMainInvokeEvent, payload: unknown): TextRules => {
      textRules = normalizeTextRules(payload);
      saveSettings(app.getPath('userData'), { textRules });
      return textRules;
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

  ipcMain.handle(
    'search:run',
    async (_event: IpcMainInvokeEvent, text: string): Promise<SearchEntry> => {
      if (typeof text !== 'string' || !text.trim()) {
        throw new Error('Say a question before searching.');
      }
      if (!researchService || !searchStore) {
        throw new Error('Search is not ready yet.');
      }

      const result = await researchService.run(text.trim());
      const entry = searchStore.add(result);
      broadcast('search:changed', null);
      return entry;
    },
  );

  ipcMain.handle('search:list', (): SearchEntry[] => {
    return searchStore ? searchStore.getAll() : [];
  });

  ipcMain.handle('search:clear', (): void => {
    searchStore?.clear();
    broadcast('search:changed', null);
  });

  ipcMain.handle('agent:settings', (): Promise<AgentSettings> => {
    return currentAgentSettings();
  });

  ipcMain.handle(
    'agent:set-tinyfish',
    async (_event: IpcMainInvokeEvent, key: string): Promise<AgentSettings> => {
      if (typeof key !== 'string') {
        throw new Error('The TinyFish key must be a string.');
      }

      const trimmed = key.trim().slice(0, 300);
      saveSettings(app.getPath('userData'), { tinyfishApiKey: trimmed });
      config.tinyfishApiKey = trimmed;
      researchService?.setTinyfishKey(trimmed);

      return currentAgentSettings();
    },
  );

  ipcMain.handle(
    'app:open-external',
    async (_event: IpcMainInvokeEvent, url: string): Promise<void> => {
      const safe = typeof url === 'string' ? sanitizeSourceUrl(url) : null;
      if (!safe) {
        throw new Error('Only http and https links can be opened.');
      }
      await shell.openExternal(safe);
    },
  );
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
    textRules = config.textRules;
    historyStore = new HistoryStore(userDataDir);
    searchStore = new SearchStore(userDataDir);
    researchService = new ResearchService({
      needleCli: config.needleCli,
      needleModel: config.needleModel,
      tinyfishApiKey: config.tinyfishApiKey,
      onProgress: (progress: SearchProgress) => {
        broadcast('search:progress', progress);
      },
    });

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

    sttService = new SttService(config, {
      getTextRules: () => textRules,
      onPartial: (text) => {
        if (mainWindow && !mainWindow.isDestroyed()) {
          mainWindow.webContents.send('stt:partial', text);
        }
      },
    });
    inputService = new InputService({
      holdKey: {
        code: config.holdKeyCode,
        name: keyName(config.holdKeyCode),
      },
      thresholdMs: config.holdThresholdMs,
      maxHoldMs: config.maxHoldMs,
      onHoldKeyChange: (key) => {
        saveSettings(userDataDir, { holdKeyCode: key.code });
        tray?.setToolTip(`fnfn — hold ${keyLabel(key.code)} to dictate`);
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
    createTray();

    const replaceOverlay = (): void => {
      if (overlayWindow && !overlayWindow.isDestroyed()) {
        overlayWindow.setBounds(overlayBounds(lastOverlayShape));
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
      } else {
        focusMainWindow();
      }
    });
  })
  .catch((error: unknown) => {
    console.error('[app] failed to start', error);
    app.quit();
  });

app.on('before-quit', () => {
  isQuitting = true;
  if (overlayHideTimer) {
    clearTimeout(overlayHideTimer);
    overlayHideTimer = null;
  }
  void sttService?.stopPreview();
  researchService?.cancel();
  tray?.destroy();
  tray = null;
  inputService?.stop();
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});
