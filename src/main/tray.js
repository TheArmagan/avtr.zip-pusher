import { app, Tray, Menu, dialog, shell } from 'electron';
import fs from 'node:fs';
import _ from 'lodash';
import { assets, files } from './paths.js';
import { getState } from './state.js';
import * as panel from './panel.js';
import * as seen from '../core/seenAvatars.js';
import { checkForUpdates } from './updater.js';
import { logger } from './logger.js';

/** @type {Tray | null} */
let tray = null;

function buildMenu() {
  const state = getState();
  // Read this at click time, not at build time, or the toggle acts on a stale value.
  const openAtLogin = app.getLoginItemSettings().openAtLogin;

  return Menu.buildFromTemplate([
    { label: 'avtr.zip - Pusher', sublabel: `v${app.getVersion()}`, enabled: false },
    { type: 'separator' },
    { label: 'Show panel', click: () => panel.show(tray?.getBounds()) },
    { type: 'separator' },
    { label: `Seen avatars: ${seen.size()}`, enabled: false },
    {
      label: state.mode === 'linked'
        ? `Linked as ${state.identity?.displayName ?? 'unknown'}`
        : 'Pushing anonymously',
      enabled: false
    },
    { type: 'separator' },
    {
      label: 'Run at startup',
      type: 'checkbox',
      checked: openAtLogin,
      click: () => {
        app.setLoginItemSettings({
          openAtLogin: !app.getLoginItemSettings().openAtLogin,
          path: process.execPath
        });
        refresh();
      }
    },
    { type: 'separator' },
    {
      label: 'Open seen avatars file',
      click: () => {
        const filePath = files.seenAvatars();
        if (fs.existsSync(filePath)) {
          shell.openPath(filePath);
        } else {
          dialog.showMessageBoxSync({
            type: 'info',
            buttons: ['OK'],
            title: 'Seen Avatars File Not Found',
            message: 'The seen avatars file does not exist yet. It will be created when you encounter new avatars.'
          });
        }
      }
    },
    { label: 'Open log file', click: () => shell.openPath(files.logFile()) },
    {
      label: 'Clear seen avatars',
      click: () => {
        const choice = dialog.showMessageBoxSync({
          type: 'warning',
          buttons: ['Cancel', 'Clear'],
          defaultId: 0,
          title: 'Clear Seen Avatars',
          message: 'Are you sure you want to clear the list of seen avatars? This action cannot be undone.'
        });
        if (choice === 1) {
          seen.clear();
          refresh();
        }
      }
    },
    { type: 'separator' },
    { label: 'Check for updates', click: () => void checkForUpdates({ manual: true }) },
    { label: 'Quit', click: () => app.quit() }
  ]);
}

function apply() {
  if (!tray) return;
  const state = getState();
  const who = state.mode === 'linked' ? state.identity?.displayName ?? 'linked' : 'anonymous';
  tray.setToolTip(`avtr.zip - Pusher (${who})\nSeen avatars: ${seen.size()}`);
  tray.setContextMenu(buildMenu());
}

export const refresh = _.throttle(apply, 1000, { leading: true, trailing: true });

export function create() {
  tray = new Tray(assets.trayIcon);
  tray.on('click', () => panel.toggle(tray.getBounds()));
  tray.on('double-click', () => panel.show(tray.getBounds()));
  apply();
  logger.info('tray: ready');
  return tray;
}

export function getTray() {
  return tray;
}
