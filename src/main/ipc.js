import fs from 'node:fs';
import { app, ipcMain, shell, clipboard, dialog } from 'electron';
import { getState, patch, patchIn, setError } from './state.js';
import { getSettings, setSettings } from './settings.js';
import { assets, files } from './paths.js';
import { logger } from './logger.js';
import * as panel from './panel.js';
import * as tray from './tray.js';
import * as api from '../core/api.js';
import * as tokenStore from '../core/tokenStore.js';
import * as linkFlow from '../core/linkFlow.js';
import * as pushQueue from '../core/pushQueue.js';
import { checkForUpdates } from './updater.js';

export function register({ refreshAccount }) {
  const handle = (channel, fn) => ipcMain.handle(channel, async (_event, ...args) => {
    try {
      return { ok: true, value: await fn(...args) };
    } catch (err) {
      logger.error(`ipc: ${channel} failed`, err);
      return { ok: false, error: api.describeError(err) };
    }
  });

  handle('state:get', () => getState());

  // The page cannot load a file:// image under its CSP, so the icon comes across as
  // a data URL. src/icon.png stays the one place the mark is defined.
  let iconDataUrl = null;
  handle('app:getIcon', () => {
    if (iconDataUrl === null) {
      try {
        iconDataUrl = 'data:image/png;base64,' + fs.readFileSync(assets.appIcon).toString('base64');
      } catch (err) {
        logger.warn('ipc: could not read the app icon', err);
        iconDataUrl = '';
      }
    }
    return iconDataUrl;
  });

  handle('link:start', () => linkFlow.start(() => void refreshAccount()));
  handle('link:cancel', () => linkFlow.cancel('user cancelled'));
  handle('link:copyCode', () => {
    const code = getState().link?.userCode;
    if (code) clipboard.writeText(code);
    return !!code;
  });
  handle('link:openVerifyUrl', () => {
    const url = getState().link?.verifyUrl;
    if (url) return shell.openExternal(url);
    return false;
  });

  handle('push:now', () => pushQueue.pushNow());
  handle('push:force', async () => {
    if (getSettings().confirmForcePush) {
      panel.setHoldOpen(true);
      const choice = dialog.showMessageBoxSync({
        type: 'question',
        buttons: ['Cancel', 'Force push'],
        defaultId: 0,
        title: 'Force push',
        message: 'Force ignores the 15 minute refresh skip and costs upstream budget. Push the most recent avatars again?'
      });
      panel.setHoldOpen(false);
      if (choice !== 1) return false;
    }
    await pushQueue.forcePush();
    return true;
  });

  handle('account:refresh', () => refreshAccount());
  handle('account:signOut', async () => {
    const identity = tokenStore.getIdentity();
    // Revoke server-side first. A token that is merely forgotten locally is still live.
    if (identity?.tokenId) {
      try {
        await api.revokeToken(identity.tokenId);
      } catch (err) {
        logger.warn('signOut: revoke failed, clearing locally anyway', err);
      }
    }
    tokenStore.clear();
    patch({ mode: 'anonymous', identity: null, quota: null });
    setError(null);
    tray.refresh();
    return true;
  });
  handle('account:setLeaderboardOptOut', async (value) => {
    await api.patchMe({ leaderboardOptOut: !!value });
    patchIn('identity', { leaderboardOptOut: !!value });
    return true;
  });

  handle('settings:get', () => getSettings());
  handle('settings:set', (patchObj) => {
    const next = setSettings(patchObj);
    patch({ settings: next });
    return next;
  });

  handle('system:getLoginItem', () => app.getLoginItemSettings().openAtLogin);
  handle('system:setLoginItem', (value) => {
    app.setLoginItemSettings({ openAtLogin: !!value, path: process.execPath });
    tray.refresh();
    return app.getLoginItemSettings().openAtLogin;
  });

  handle('app:openExternal', (url) => {
    if (!/^https?:\/\//i.test(String(url))) return false;
    return shell.openExternal(url);
  });
  handle('app:openLogFile', () => shell.openPath(files.logFile()));
  handle('app:checkForUpdates', () => checkForUpdates({ manual: true }));
  handle('app:hide', () => panel.hide());
  handle('app:holdOpen', (value) => panel.setHoldOpen(value));
  handle('app:quit', () => app.quit());
}
