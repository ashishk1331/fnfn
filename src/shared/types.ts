import type { HoldUpdate, KeyRef } from './hold-detector';

export type InputState =
  | 'starting'
  | 'ready'
  | 'degraded'
  | 'unsupported'
  | 'error';

export interface InputDeviceInfo {
  path: string;
  name: string;
  phys: string;
  readable: boolean;
  isKeyboard: boolean;
  hasFn: boolean;
}

export interface InputStatus {
  state: InputState;
  message: string;
  holdKey: KeyRef;
  thresholdMs: number;
  learning: boolean;
  reading: string[];
}

export type LearnEvent =
  | { type: 'key'; key: KeyRef; device: string }
  | { type: 'timeout'; message: string };

export interface TranscriptionTimings {
  convertMs: number;
  sttMs: number;
  totalMs: number;
}

export interface TranscriptionResult {
  text: string;
  timings: TranscriptionTimings;
  skipped?: string;
}

export type OverlayPhase = 'idle' | 'pending' | 'recording' | 'transcribing';

export interface OverlayState {
  phase: OverlayPhase;
  levels: number[];
}

export type InsertTool = 'xdotool' | 'ydotool' | 'wtype';

export interface InsertResult {
  success: boolean;
  tool: InsertTool | 'none';
  error?: string;
}

export interface HistoryEntry {
  id: string;
  timestamp: number;
  text: string;
}

export interface SttInfo {
  engine: string;
  model: string;
}

export interface FnfnApi {
  getInputStatus: () => Promise<InputStatus>;
  setLearning: (on: boolean) => Promise<InputStatus>;
  setHoldKey: (code: number) => Promise<InputStatus>;
  simulate: (phase: 'down' | 'up') => void;
  getSttInfo: () => Promise<SttInfo>;
  transcribe: (
    audio: ArrayBuffer,
    durationMs: number,
  ) => Promise<TranscriptionResult>;
  copyText: (text: string) => Promise<void>;
  insertText: (text: string) => Promise<InsertResult>;
  getHistory: () => Promise<HistoryEntry[]>;
  clearHistory: () => Promise<void>;
  onHistoryChange: (callback: () => void) => () => void;
  setOverlayState: (state: OverlayState) => void;
  onOverlayUpdate: (callback: (state: OverlayState) => void) => () => void;
  onHoldUpdate: (callback: (update: HoldUpdate) => void) => () => void;
  onStatus: (callback: (status: InputStatus) => void) => () => void;
  onLearn: (callback: (event: LearnEvent) => void) => () => void;
}
