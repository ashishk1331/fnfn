/// <reference types="@electron-forge/plugin-vite/forge-vite-env" />
import type { FnfnApi } from './shared/types';

declare global {
  interface Window {
    fnfn: FnfnApi;
  }
}
