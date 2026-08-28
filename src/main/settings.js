import fs from 'node:fs';
import { files } from './paths.js';
import { logger } from './logger.js';

const DEFAULTS = {
  notifications: true,
  confirmForcePush: true,
  panelOnLaunch: false,
  anonymousFallback: true,
  updateCheck: true
};

let cache = null;

export function getSettings() {
  if (cache) return cache;
  cache = { ...DEFAULTS };
  try {
    const raw = fs.readFileSync(files.settings(), 'utf-8');
    Object.assign(cache, JSON.parse(raw));
  } catch (err) {
    if (err.code !== 'ENOENT') logger.warn('settings: could not read, using defaults', err);
  }
  return cache;
}

export function setSettings(patch) {
  const next = { ...getSettings(), ...patch };
  cache = next;
  try {
    // Write-then-rename so a crash mid-write cannot leave a truncated file.
    const tmp = files.settings() + '.tmp';
    fs.writeFileSync(tmp, JSON.stringify(next, null, 2));
    fs.renameSync(tmp, files.settings());
  } catch (err) {
    logger.error('settings: write failed', err);
  }
  return next;
}
