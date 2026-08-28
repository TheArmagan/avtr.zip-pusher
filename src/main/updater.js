import { app, Notification, shell } from 'electron';
import { logger } from './logger.js';
import { patch } from './state.js';
import { getSettings } from './settings.js';

const REPO = 'TheArmagan/avtr.zip-pusher';
const LATEST_URL = `https://api.github.com/repos/${REPO}/releases/latest`;

let notified = false;

/** Compares dotted numeric versions. Returns > 0 when a is newer than b. */
function compareVersions(a, b) {
  const pa = String(a).split('.').map((n) => parseInt(n, 10) || 0);
  const pb = String(b).split('.').map((n) => parseInt(n, 10) || 0);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    if ((pa[i] || 0) !== (pb[i] || 0)) return (pa[i] || 0) - (pb[i] || 0);
  }
  return 0;
}

export async function checkForUpdates({ manual = false } = {}) {
  if (!manual && !getSettings().updateCheck) return null;

  try {
    const res = await fetch(LATEST_URL, {
      headers: { Accept: 'application/vnd.github+json', 'User-Agent': 'avtr.zip-pusher' },
      signal: AbortSignal.timeout(15000)
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);

    const release = await res.json();
    const tag = String(release.tag_name || '');
    const latest = tag.replace(/^v/i, '');
    if (!latest) throw new Error('release has no tag');

    const available = compareVersions(latest, app.getVersion()) > 0;
    const info = {
      available,
      latestVersion: latest,
      url: release.html_url || `https://github.com/${REPO}/releases/latest`
    };
    patch({ update: info });

    if (available) {
      logger.info('update: v' + latest + ' is available');
      if (!notified && getSettings().notifications) {
        notified = true;
        const n = new Notification({
          title: 'avtr.zip Pusher update',
          body: `Version ${latest} is out. You are on ${app.getVersion()}.`
        });
        n.on('click', () => shell.openExternal(info.url));
        n.show();
      }
    } else if (manual) {
      logger.info('update: already on the latest version');
    }

    return info;
  } catch (err) {
    logger.debug('update: check failed', err.message);
    return null;
  }
}
