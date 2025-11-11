import { app, dialog, Tray, Menu, shell, Notification } from 'electron';
import path from 'path';
import process from 'process';
import chokidar from 'chokidar';
import PQueue from 'p-queue';
import fs from 'fs';
import _ from 'lodash';
import isSquirrelStartup from 'electron-squirrel-startup';

const __dirname = path.dirname(new URL(import.meta.url).pathname).slice(1);

if (isSquirrelStartup) app.quit();

if (process.defaultApp) {
  if (process.argv.length >= 2) {
    app.setAsDefaultProtocolClient('azp', process.execPath, [path.resolve(process.argv[1])])
  }
} else {
  app.setAsDefaultProtocolClient('azp')
}
app.setAppUserModelId("zip.avtr.pusher");

const AvatarIdRegex = /avtr_\w{8}-\w{4}-\w{4}-\w{4}-\w{12}/g;

/** @type {Tray} */
let tray = null;

function addSeenAvatarId(id) {
  const filePath = path.join(app.getPath('userData'), 'seenAvatars.txt');
  let existingIds = getSeenAvatarIds();
  if (!existingIds.has(id)) {
    fs.appendFileSync(filePath, id + '\n');
    return true;
  }
  return false;
}

function clearSeenAvatarIds() {
  const filePath = path.join(app.getPath('userData'), 'seenAvatars.txt');
  if (fs.existsSync(filePath)) {
    fs.unlinkSync(filePath);
  }
}

function getSeenAvatarIds() {
  const filePath = path.join(app.getPath('userData'), 'seenAvatars.txt');
  let existingIds = new Set();
  if (fs.existsSync(filePath)) {
    const data = fs.readFileSync(filePath, 'utf-8');
    data.split('\n').forEach(line => {
      existingIds.add(line.trim());
    });
  }
  return existingIds;
}

async function main() {
  tray = new Tray(path.join(__dirname, "icon.png"));

  function updateTrayMenu() {
    const seenAvatarsSize = getSeenAvatarIds().size;
    tray.setToolTip(`avtr.zip - Pusher\nSeen Avatars: ${seenAvatarsSize}`);
    tray.setContextMenu(Menu.buildFromTemplate([
      {
        label: 'avtr.zip - Pusher',
        sublabel: 'v0.0.3',
        enabled: false
      },
      {
        type: 'separator'
      },
      {
        label: `Seen Avatars: ${seenAvatarsSize}`,
        enabled: false
      },
      {
        type: 'separator'
      },
      {
        label: "Open Seen Avatars File",
        click: () => {
          const filePath = path.join(app.getPath('userData'), 'seenAvatars.txt');
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
      {
        label: 'Clear Seen Avatars',
        click: () => {
          const choice = dialog.showMessageBoxSync({
            type: 'warning',
            buttons: ['Cancel', 'Clear'],
            defaultId: 0,
            title: 'Clear Seen Avatars',
            message: 'Are you sure you want to clear the list of seen avatars? This action cannot be undone.'
          });
          if (choice === 1) {
            clearSeenAvatarIds();
            throttledUpdateTrayMenu();
          }
        }
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

  function createListeners() {
    const amplitudeCachePath = path.join(process.env.TEMP, "./VRChat/VRChat/amplitude.cache")

    const logsPath = path.join(process.env.APPDATA, "../LocalLow/VRChat/VRChat");

    const queue = new PQueue({ concurrency: 2 });

    let watcher = chokidar.watch([
      amplitudeCachePath,
      logsPath
    ], {
      ignoreInitial: false,
      depth: 2
    });

    watcher.on("all", async (event, path) => {
      if (event !== "add" && event !== "change") return;

      const content = fs.readFileSync(path, 'utf-8');
      for (const match of content.matchAll(AvatarIdRegex)) {
        const avatarId = match[0];
        queue.add(async () => {
          await handleNewAvatar(avatarId);
        });
      }
    });
  }

  async function handleNewAvatar(avatarId) {
    if (addSeenAvatarId(avatarId)) {
      console.log(`New avatar seen: ${avatarId}`);

      const req = await fetch(`http://api.avtr.zip/v1/avatars/push`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({ avatarId })
      });

      if (req.ok) {
        console.log(`Successfully pushed avatar ${avatarId} to avtr.zip`);
      } else {
        console.error(`Failed to push avatar ${avatarId} to avtr.zip: ${req.statusText}`);
      }
    }
    throttledUpdateTrayMenu();
  }

  createListeners();
  console.log("avtr.zip - Pusher is running.");
  console.log(`${getSeenAvatarIds().size} avatars have been seen so far.`);
  console.log("Listening for new avatars...");

  new Notification({
    title: 'avtr.zip - Pusher',
    body: 'The application is now running in the system tray.'
  }).show();

  app.on('second-instance', (event, argv) => {
    let deepLink = argv.pop();
    if (deepLink && deepLink.startsWith("azp://")) {
      deepLink = deepLink.replace("azp://", "");
      if (deepLink.startsWith("/")) deepLink = deepLink.slice(1);
      if (deepLink.endsWith("/")) deepLink = deepLink.slice(0, -1);
      const splited = deepLink.split("/");
      if (splited[0] === "push" && AvatarIdRegex.test(splited[1] || "")) {
        const avatarId = splited[1];
        handleNewAvatar(avatarId);
        console.log(`Received deep link to push avatar: ${avatarId}`);
      }
    }
  });
}

app.whenReady().then(async () => {
  if (!app.requestSingleInstanceLock()) {
    app.quit();
    return;
  }
  main();
});