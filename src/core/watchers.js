import path from 'node:path';
import { promises as fsp } from 'node:fs';
import chokidar from 'chokidar';
import Tail from 'tail';
import { vrchat } from '../main/paths.js';
import { logger } from '../main/logger.js';

/**
 * Global flag, so this one is only ever used with matchAll. A `g` regex reused with
 * .test() carries lastIndex between calls and starts failing on valid input.
 */
const AvatarIdRegex = /avtr_\w{8}-\w{4}-\w{4}-\w{4}-\w{12}/g;
export const AvatarIdTestRegex = /^avtr_\w{8}-\w{4}-\w{4}-\w{4}-\w{12}$/;

const LogFileRegex = /^output_log_(\d{4})-(\d{2})-(\d{2})_(\d{2})-(\d{2})-(\d{2})\.txt$/;

let currentTail = null;
let lastLogActivityAt = null;
let onIds = () => {};

/** Last time the VRChat log produced a line. The heartbeat uses this as liveness. */
export function getLastLogActivity() {
  return lastLogActivityAt;
}

function parseLogFileDate(filename) {
  const match = filename.match(LogFileRegex);
  if (!match) return null;
  const [, year, month, day, hour, minute, second] = match;
  return new Date(+year, +month - 1, +day, +hour, +minute, +second);
}

async function findLatestLogFile(logsPath) {
  try {
    const entries = await fsp.readdir(logsPath);
    let latestFile = null;
    let latestDate = null;
    for (const file of entries) {
      const date = parseLogFileDate(file);
      if (date && (!latestDate || date > latestDate)) {
        latestDate = date;
        latestFile = file;
      }
    }
    return latestFile ? path.join(logsPath, latestFile) : null;
  } catch (err) {
    logger.warn('watchers: could not list the VRChat logs directory', err);
    return null;
  }
}

function collect(text, live) {
  const found = [];
  for (const match of text.matchAll(AvatarIdRegex)) found.push(match[0]);
  if (live) lastLogActivityAt = Date.now();
  if (found.length) onIds(found);
}

async function startTailing(logFilePath) {
  if (currentTail) {
    currentTail.unwatch();
    currentTail = null;
  }
  logger.info('watchers: tailing', path.basename(logFilePath));

  try {
    collect(await fsp.readFile(logFilePath, 'utf-8'), false);
  } catch (err) {
    logger.warn('watchers: could not read the log for its initial scan', err);
  }

  currentTail = new Tail.Tail(logFilePath, {
    follow: true,
    fromBeginning: false,
    useWatchFile: true,
    fsWatchOptions: { interval: 100 }
  });
  currentTail.on('line', (line) => collect(line, true));
  currentTail.on('error', (err) => logger.warn('watchers: tail error', err));
}

export async function start(handler) {
  onIds = handler;
  const logsPath = vrchat.logsDir();
  const amplitudeCachePath = vrchat.amplitudeCache();

  const latest = await findLatestLogFile(logsPath);
  if (latest) await startTailing(latest);
  else logger.info('watchers: no VRChat log yet, waiting for one');

  const dirWatcher = chokidar.watch(logsPath, {
    ignoreInitial: true,
    depth: 0,
    ignored: (filePath) => {
      const basename = path.basename(filePath);
      return !LogFileRegex.test(basename) && basename !== path.basename(logsPath);
    }
  });

  dirWatcher.on('add', async (filePath) => {
    if (!LogFileRegex.test(path.basename(filePath))) return;
    logger.info('watchers: new log file');
    // Give VRChat a moment to finish creating it.
    await new Promise((resolve) => setTimeout(resolve, 500));
    await startTailing(filePath);
  });

  const amplitudeWatcher = chokidar.watch(amplitudeCachePath, {
    ignoreInitial: false,
    depth: 0
  });

  amplitudeWatcher.on('all', async (event, filePath) => {
    if (event !== 'add' && event !== 'change') return;
    try {
      collect(await fsp.readFile(filePath, 'utf-8'), false);
    } catch {
      // it may not exist yet
    }
  });

  return {
    stop: () => {
      currentTail?.unwatch();
      dirWatcher.close();
      amplitudeWatcher.close();
    }
  };
}
