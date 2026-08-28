import { app } from 'electron';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const srcDir = path.dirname(path.dirname(fileURLToPath(import.meta.url)));

export const assets = {
  trayIcon: path.join(srcDir, 'icon.png'),
  appIcon: path.join(srcDir, 'icon.png'),
  preload: path.join(srcDir, 'preload.cjs'),
  panelHtml: path.join(srcDir, 'ui', 'index.html')
};

/** Resolved lazily: app.getPath('userData') is only valid after the app is ready. */
export function userData(...parts) {
  return path.join(app.getPath('userData'), ...parts);
}

export const files = {
  seenAvatars: () => userData('seenAvatars.txt'),
  settings: () => userData('settings.json'),
  identity: () => userData('identity.json'),
  credentials: () => userData('credentials.bin'),
  logDir: () => userData('logs'),
  logFile: () => userData('logs', 'pusher.log')
};

export const vrchat = {
  logsDir: () => path.join(process.env.APPDATA || '', '..', 'LocalLow', 'VRChat', 'VRChat'),
  amplitudeCache: () => path.join(process.env.TEMP || '', 'VRChat', 'VRChat', 'amplitude.cache')
};
