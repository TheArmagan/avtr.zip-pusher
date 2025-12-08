import { app, dialog, Tray, Menu, shell, Notification } from 'electron';
import path from 'path';
import process from 'process';
import chokidar from 'chokidar';
import PQueue from 'p-queue';
import fs from 'fs';
import { promises as fsPromises } from 'fs';
import _ from 'lodash';
import isSquirrelStartup from 'electron-squirrel-startup';
import Tail from 'tail';

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
const LogFileRegex = /^output_log_(\d{4})-(\d{2})-(\d{2})_(\d{2})-(\d{2})-(\d{2})\.txt$/;

/** @type {Tray} */
let tray = null;

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

/**
 * Parse log filename and return Date object
 * Format: output_log_YYYY-MM-DD_HH-MM-SS.txt
 */
function parseLogFileDate(filename) {
  const match = filename.match(LogFileRegex);
  if (!match) return null;
  const [, year, month, day, hour, minute, second] = match;
  return new Date(
    parseInt(year),
    parseInt(month) - 1,
    parseInt(day),
    parseInt(hour),
    parseInt(minute),
    parseInt(second)
  );
}

/**
 * Find the latest log file in the VRChat logs directory
 */
async function findLatestLogFile(logsPath) {
  try {
    const files = await fsPromises.readdir(logsPath);
    let latestFile = null;
    let latestDate = null;

    for (const file of files) {
      const date = parseLogFileDate(file);
      if (date && (!latestDate || date > latestDate)) {
        latestDate = date;
        latestFile = file;
      }
    }

    return latestFile ? path.join(logsPath, latestFile) : null;
  } catch (err) {
    console.error('Error finding latest log file:', err);
    return null;
  }
}

async function main() {
  tray = new Tray(path.join(__dirname, "icon.png"));

  // Cache seen avatar IDs in memory to avoid file I/O on every check
  let seenAvatarIdsCache = getSeenAvatarIds();

  function updateTrayMenu() {
    const seenAvatarsSize = seenAvatarIdsCache.size;
    const loginItemSettings = app.getLoginItemSettings();
    tray.setToolTip(`avtr.zip - Pusher\nSeen Avatars: ${seenAvatarsSize}`);
    tray.setContextMenu(Menu.buildFromTemplate([
      {
        label: 'avtr.zip - Pusher',
        sublabel: 'v0.0.4',
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
        label: 'Run at startup',
        type: 'checkbox',
        checked: loginItemSettings.openAtLogin,
        click: () => {
          const newValue = !loginItemSettings.openAtLogin;
          app.setLoginItemSettings({
            openAtLogin: newValue,
            path: process.execPath
          });
          throttledUpdateTrayMenu();
        }
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
            seenAvatarIdsCache = new Set();
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

  /** @type {Tail.Tail | null} */
  let currentLogTail = null;
  /** @type {string | null} */
  let currentLogFile = null;

  const queue = new PQueue({ concurrency: 4 });

  async function handleNewAvatar(avatarId) {
    if (seenAvatarIdsCache.has(avatarId)) return;

    seenAvatarIdsCache.add(avatarId);
    console.log(`New avatar seen: ${avatarId}`);

    try {
      // Write to file async
      const filePath = path.join(app.getPath('userData'), 'seenAvatars.txt');
      await fsPromises.appendFile(filePath, avatarId + '\n');

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
    } catch (err) {
      console.error(`Error handling avatar ${avatarId}:`, err);
    }

    throttledUpdateTrayMenu();
  }

  function processLine(line) {
    for (const match of line.matchAll(AvatarIdRegex)) {
      const avatarId = match[0];
      if (!seenAvatarIdsCache.has(avatarId)) {
        queue.add(() => handleNewAvatar(avatarId));
      }
    }
  }

  async function startTailing(logFilePath) {
    if (currentLogTail) {
      currentLogTail.unwatch();
      currentLogTail = null;
    }

    currentLogFile = logFilePath;
    console.log(`Starting to tail log file: ${logFilePath}`);

    // First, do an initial scan of the file for any existing avatar IDs
    try {
      const content = await fsPromises.readFile(logFilePath, 'utf-8');
      const lines = content.split('\n');
      for (const line of lines) {
        processLine(line);
      }
    } catch (err) {
      console.error('Error reading initial log content:', err);
    }

    // Now start tailing for new content
    currentLogTail = new Tail.Tail(logFilePath, {
      follow: true,
      fromBeginning: false,
      useWatchFile: true,
      fsWatchOptions: { interval: 100 }
    });

    currentLogTail.on('line', (line) => {
      processLine(line);
    });

    currentLogTail.on('error', (err) => {
      console.error('Tail error:', err);
    });
  }

  async function createListeners() {
    const amplitudeCachePath = path.join(process.env.TEMP, "./VRChat/VRChat/amplitude.cache");
    const logsPath = path.join(process.env.APPDATA, "../LocalLow/VRChat/VRChat");

    // Find and tail the latest log file
    const latestLogFile = await findLatestLogFile(logsPath);
    if (latestLogFile) {
      await startTailing(latestLogFile);
    } else {
      console.log('No log file found yet, waiting for one to be created...');
    }

    // Watch the logs directory for new log files
    const dirWatcher = chokidar.watch(logsPath, {
      ignoreInitial: true,
      depth: 0,
      ignored: (filePath) => {
        const basename = path.basename(filePath);
        return !LogFileRegex.test(basename) && basename !== path.basename(logsPath);
      }
    });

    dirWatcher.on('add', async (filePath) => {
      const basename = path.basename(filePath);
      if (LogFileRegex.test(basename)) {
        console.log(`New log file detected: ${filePath}`);
        // Give VRChat a moment to finish creating the file
        await new Promise(resolve => setTimeout(resolve, 500));
        await startTailing(filePath);
      }
    });

    // Also watch amplitude.cache with chokidar (it's small and changes infrequently)
    const amplitudeWatcher = chokidar.watch(amplitudeCachePath, {
      ignoreInitial: false,
      depth: 0
    });

    amplitudeWatcher.on('all', async (event, filePath) => {
      if (event !== 'add' && event !== 'change') return;
      try {
        const content = await fsPromises.readFile(filePath, 'utf-8');
        for (const line of content.split('\n')) {
          processLine(line);
        }
      } catch (err) {
        // File might not exist yet
      }
    });
  }

  await createListeners();
  console.log("avtr.zip - Pusher is running.");
  console.log(`${seenAvatarIdsCache.size} avatars have been seen so far.`);
  console.log("Listening for new avatars...");

  new Notification({
    title: 'avtr.zip - Pusher',
    body: `The application is now running in the system tray. Seen Avatars: ${seenAvatarIdsCache.size}`
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