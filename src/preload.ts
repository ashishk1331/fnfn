import { contextBridge, ipcRenderer, type IpcRendererEvent } from 'electron';

import type { HoldUpdate } from './shared/hold-detector';
import type {
  FnfnApi,
  HistoryEntry,
  InputStatus,
  InsertResult,
  LearnEvent,
  OverlayState,
  SttInfo,
  TranscriptionResult,
} from './shared/types';

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
  ): Promise<TranscriptionResult> =>
    ipcRenderer.invoke('stt:transcribe', audio, durationMs),
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
