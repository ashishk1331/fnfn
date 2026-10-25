import { existsSync } from 'node:fs';

import type { ForgeConfig } from '@electron-forge/shared-types';
import { MakerSquirrel } from '@electron-forge/maker-squirrel';
import { MakerZIP } from '@electron-forge/maker-zip';
import { MakerDeb } from '@electron-forge/maker-deb';
import { MakerRpm } from '@electron-forge/maker-rpm';
import { VitePlugin } from '@electron-forge/plugin-vite';
import { FusesPlugin } from '@electron-forge/plugin-fuses';
import { FuseV1Options, FuseVersion } from '@electron/fuses';

// The Whistle engine is a prebuilt binary plus weights, fetched with
// scripts/fetch-needle.sh. Package it only when it has been fetched.
const needleResources = existsSync('./vendor/needle')
  ? ['./vendor/needle']
  : [];

const config: ForgeConfig = {
  packagerConfig: {
    asar: true,
    extraResource: needleResources,
    // The Vite plugin otherwise copies only `/.vite`, which would drop the
    // tray and window icons in `assets`.
    ignore: (file) => {
      if (!file) {
        return false;
      }
      return !file.startsWith('/.vite') && !file.startsWith('/assets');
    },
    download: {
      unsafelyDisableChecksums: true,
    },
  },
  rebuildConfig: {},
  makers: [
    new MakerSquirrel({ setupIcon: './assets/icons/icon.ico' }),
    new MakerZIP({}, ['darwin']),
    new MakerRpm({
      options: {
        icon: './assets/icons/512x512.png',
        categories: ['AudioVideo', 'Utility'],
      },
    }),
    new MakerDeb({
      options: {
        icon: './assets/icons/512x512.png',
        categories: ['AudioVideo', 'Utility'],
      },
    }),
  ],
  plugins: [
    new VitePlugin({
      // `build` can specify multiple entry builds, which can be Main process, Preload scripts, Worker process, etc.
      // If you are familiar with Vite configuration, it will look really familiar.
      build: [
        {
          // `entry` is just an alias for `build.lib.entry` in the corresponding file of `config`.
          entry: 'src/main.ts',
          config: 'vite.main.config.mts',
          target: 'main',
        },
        {
          entry: 'src/preload.ts',
          config: 'vite.preload.config.mts',
          target: 'preload',
        },
      ],
      renderer: [
        {
          name: 'main_window',
          config: 'vite.renderer.config.mts',
        },
      ],
    }),
    // Fuses are used to enable/disable various Electron functionality
    // at package time, before code signing the application
    new FusesPlugin({
      version: FuseVersion.V1,
      [FuseV1Options.RunAsNode]: false,
      [FuseV1Options.EnableCookieEncryption]: true,
      [FuseV1Options.EnableNodeOptionsEnvironmentVariable]: false,
      [FuseV1Options.EnableNodeCliInspectArguments]: false,
      [FuseV1Options.EnableEmbeddedAsarIntegrityValidation]: true,
      [FuseV1Options.OnlyLoadAppFromAsar]: true,
    }),
  ],
};

export default config;
