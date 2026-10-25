import { contextBridge, ipcRenderer, type IpcRendererEvent } from 'electron';

import type { HoldUpdate } from './shared/hold-detector';
import type {
  AgentSettings,
  FnfnApi,
  HistoryEntry,
  InputStatus,
  InsertResult,
  LearnEvent,
  OverlayState,
  SearchEntry,
  SearchProgress,
  SttInfo,
  TranscriptionMode,
  TranscriptionResult,
} from './shared/types';
import type { TextRules } from './shared/text-rules';

function subscribe<T>(
  channel: string,
  callback: (payload: T) => void,
): () => void {
  const listener = (_event: IpcRendererEvent, payload: T): void => {
    callback(payload);
  };

  ipcRenderer.on(channel, listener);
  return () => {
    ipcRenderer.removeListener(channel, listener);
  };
}

const api: FnfnApi = {
  getInputStatus: (): Promise<InputStatus> =>
    ipcRenderer.invoke('input:status'),
  setLearning: (on: boolean): Promise<InputStatus> =>
    ipcRenderer.invoke('input:learn', on),
  setHoldKey: (code: number): Promise<InputStatus> =>
    ipcRenderer.invoke('input:set-key', { code }),
  simulate: (phase: 'down' | 'up'): void => {
    ipcRenderer.send('input:simulate', phase);
  },
  getSttInfo: (): Promise<SttInfo> => ipcRenderer.invoke('stt:info'),
  transcribe: (
    audio: ArrayBuffer,
    durationMs: number,
    mode: TranscriptionMode = 'dictate',
  ): Promise<TranscriptionResult> =>
    ipcRenderer.invoke('stt:transcribe', audio, durationMs, mode),
  startPreview: (): void => {
    ipcRenderer.send('stt:preview-start');
  },
  pushPreviewAudio: (chunk: ArrayBuffer): void => {
    ipcRenderer.send('stt:preview-chunk', chunk);
  },
  stopPreview: (): void => {
    ipcRenderer.send('stt:preview-stop');
  },
  onPartial: (callback: (text: string) => void): (() => void) =>
    subscribe('stt:partial', callback),
  runSearch: (text: string): Promise<SearchEntry> =>
    ipcRenderer.invoke('search:run', text),
  onSearchProgress: (
    callback: (progress: SearchProgress) => void,
  ): (() => void) => subscribe('search:progress', callback),
  getSearches: (): Promise<SearchEntry[]> => ipcRenderer.invoke('search:list'),
  clearSearches: (): Promise<void> => ipcRenderer.invoke('search:clear'),
  onSearchChanged: (callback: () => void): (() => void) =>
    subscribe('search:changed', callback),
  getAgentSettings: (): Promise<AgentSettings> =>
    ipcRenderer.invoke('agent:settings'),
  setTinyfishKey: (key: string): Promise<AgentSettings> =>
    ipcRenderer.invoke('agent:set-tinyfish', key),
  openExternal: (url: string): Promise<void> =>
    ipcRenderer.invoke('app:open-external', url),
  getTextRules: (): Promise<TextRules> => ipcRenderer.invoke('rules:get'),
  setTextRules: (rules: TextRules): Promise<TextRules> =>
    ipcRenderer.invoke('rules:set', rules),
  copyText: (text: string): Promise<void> =>
    ipcRenderer.invoke('clipboard:write', text),
  insertText: (text: string): Promise<InsertResult> =>
    ipcRenderer.invoke('insert:text', text),
  getHistory: (): Promise<HistoryEntry[]> => ipcRenderer.invoke('history:get'),
  clearHistory: (): Promise<void> => ipcRenderer.invoke('history:clear'),
  onHistoryChange: (callback: () => void): (() => void) =>
    subscribe('history:changed', callback),
  setOverlayState: (state: OverlayState): void => {
    ipcRenderer.send('overlay:state', state);
  },
  onOverlayUpdate: (callback: (state: OverlayState) => void): (() => void) =>
    subscribe('overlay:update', callback),
  onHoldUpdate: (callback: (update: HoldUpdate) => void): (() => void) =>
    subscribe('input:update', callback),
  onStatus: (callback: (status: InputStatus) => void): (() => void) =>
    subscribe('input:status', callback),
  onLearn: (callback: (event: LearnEvent) => void): (() => void) =>
    subscribe('input:learn', callback),
};

contextBridge.exposeInMainWorld('fnfn', api);
