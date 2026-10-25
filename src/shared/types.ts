import type { HoldUpdate, KeyRef } from './hold-detector';
import type { TextRules } from './text-rules';

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

export type TranscriptionMode = 'dictate' | 'search';

export type OverlayMode = 'dictate' | 'search';

export type OverlayPhase =
  | 'idle'
  | 'pending'
  | 'recording'
  | 'transcribing'
  | 'searching'
  | 'reading'
  | 'answering'
  | 'done'
  | 'error';

export interface OverlaySource {
  title: string;
  url: string;
}

export interface OverlayState {
  phase: OverlayPhase;
  mode: OverlayMode;
  levels: number[];
  query?: string;
  answer?: string;
  sources?: OverlaySource[];
  message?: string;
}

export interface SearchSource {
  title: string;
  url: string;
  site: string;
}

export interface SearchResult {
  /** The raw transcript that started the search. */
  spoken: string;
  /** The query Needle extracted, or the spoken text when extraction failed. */
  query: string;
  answer: string;
  sources: SearchSource[];
  confidence: number;
  elapsedMs: number;
  /** True when the spoken text was used as the query directly. */
  fallback: boolean;
}

export interface SearchEntry extends SearchResult {
  id: string;
  timestamp: number;
}

export type SearchPhase = 'query' | 'searching' | 'reading' | 'answering';

export interface SearchProgress {
  phase: SearchPhase;
  query: string;
  message: string;
}

export interface AgentSettings {
  tinyfishConfigured: boolean;
  tinyfishFromEnv: boolean;
  tinyfishHint: string;
  needleReady: boolean;
  needleModel: string;
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
    mode?: TranscriptionMode,
  ) => Promise<TranscriptionResult>;
  startPreview: () => void;
  pushPreviewAudio: (chunk: ArrayBuffer) => void;
  stopPreview: () => void;
  onPartial: (callback: (text: string) => void) => () => void;
  runSearch: (text: string) => Promise<SearchEntry>;
  onSearchProgress: (
    callback: (progress: SearchProgress) => void,
  ) => () => void;
  getSearches: () => Promise<SearchEntry[]>;
  clearSearches: () => Promise<void>;
  onSearchChanged: (callback: () => void) => () => void;
  getAgentSettings: () => Promise<AgentSettings>;
  setTinyfishKey: (key: string) => Promise<AgentSettings>;
  openExternal: (url: string) => Promise<void>;
  getTextRules: () => Promise<TextRules>;
  setTextRules: (rules: TextRules) => Promise<TextRules>;
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
