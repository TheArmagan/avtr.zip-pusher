import { app, dialog, Tray, Menu } from 'electron';
import path from 'path';
import fs from 'fs';
import _ from 'lodash';
import isSquirrelStartup from 'electron-squirrel-startup';

if (isSquirrelStartup) app.quit();

if (process.defaultApp) {
  if (process.argv.length >= 2) {
    app.setAsDefaultProtocolClient('azp', process.execPath, [path.resolve(process.argv[1])])
  }
} else {
  app.setAsDefaultProtocolClient('azp')
}
app.setAppUserModelId("zip.avtr.pusher");

/** @type {Tray} */
let tray = null;

let totalAvatarsPushed = 0;

async function createTray() {
  tray = new Tray('./src/icon.png');

  function updateTrayMenu() {
    tray.setToolTip(`avtr.zip - Pusher\nAvatars Pushed: ${totalAvatarsPushed}`);
    tray.setContextMenu(Menu.buildFromTemplate([
      {
        label: 'avtr.zip - Pusher',
        sublabel: 'v0.0.1',
        enabled: false
      },
      {
        type: 'separator'
      },
      {
        label: `Avatars Pushed: ${totalAvatarsPushed}`,
        enabled: false
      },
      {
        type: 'separator'
      },
      {
        label: 'Quit',
        click: () => {
          app.quit();
        }
      }
    ]));
  }

  const throttledUpdateTrayMenu = _.throttle(updateTrayMenu, 1000);
  updateTrayMenu();
}

app.whenReady().then(async () => {
  if (!app.requestSingleInstanceLock()) {
    app.quit();
    return;
  }
  createTray();
});