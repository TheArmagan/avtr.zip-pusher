import { app, Notification } from 'electron';
import isSquirrelStartup from 'electron-squirrel-startup';
import _ from 'lodash';

import { logger } from './main/logger.js';
import { getSettings } from './main/settings.js';
import { patch, getState } from './main/state.js';
import * as panel from './main/panel.js';
import * as tray from './main/tray.js';
import * as ipc from './main/ipc.js';
import { checkForUpdates } from './main/updater.js';

import * as api from './core/api.js';
import * as tokenStore from './core/tokenStore.js';
import * as seen from './core/seenAvatars.js';
import * as watchers from './core/watchers.js';
import * as pushQueue from './core/pushQueue.js';
import * as heartbeat from './core/heartbeat.js';
import * as stats from './core/stats.js';

if (isSquirrelStartup) app.quit();

if (process.defaultApp) {
  if (process.argv.length >= 2) {
    app.setAsDefaultProtocolClient('azp', process.execPath, [process.argv[1]]);
  }
} else {
  app.setAsDefaultProtocolClient('azp');
}
app.setAppUserModelId('zip.avtr.pusher');

/** While the panel is open the dashboard refreshes this often; while hidden, never. */
const ME_REFRESH_MS = 60 * 1000;
/** Re-opening the panel refreshes unless the last read is newer than this. */
const ME_MIN_GAP_MS = 10 * 1000;
/** After a push that earned credit, rank moves are picked up at most this often. */
const ME_AFTER_CREDIT_MS = 30 * 1000;

let lastMeAt = 0;
let meInFlight = null;
let meTimer = null;

/** Pull identity, counters, ranks, streak, milestones and rewards from /me. */
async function refreshAccount() {
  if (meInFlight) return meInFlight;
  meInFlight = doRefreshAccount().finally(() => { meInFlight = null; });
  return meInFlight;
}

async function doRefreshAccount() {
  if (!tokenStore.getToken()) {
    tray.refresh();
    return;
  }
  try {
    const data = await stats.read(() => api.me());
    // Signed out or rejected while this was in flight: the answer is for a dead token.
    if (!tokenStore.getToken()) return;
    lastMeAt = Date.now();
    // The dashboard lives under `pusher`; very old servers answered flat.
    const p = data?.pusher ?? data ?? {};

    const identity = tokenStore.updateIdentity({
      vrchatUserId: p.vrchatUserId ?? tokenStore.getIdentity()?.vrchatUserId,
      displayName: p.displayName ?? tokenStore.getIdentity()?.displayName
    });

    patch({
      mode: 'linked',
      identity: {
        ...identity,
        credit: p.discoveryCount ?? p.discoveries ?? 0,
        pushCount: p.pushCount ?? null,
        rank: p.ranks?.all?.rank ?? p.rank ?? null,
        leaderboardOptOut: !!p.leaderboardOptOut
      },
      stats: {
        ranks: p.ranks ?? null,
        streak: p.streak ?? null,
        milestones: p.milestones ?? null,
        impact: p.impact ?? null,
        awards: p.awards ?? null,
        updatedAt: Date.now()
      }
    });
  } catch (err) {
    // A 401 is handled inside stats.read; anything else keeps the last good numbers.
    if (err.status !== 401) logger.warn('account: refresh failed', err.code || err);
  }
  tray.refresh();
}

/** Credit came back on a push: maybe celebrate, and pick up rank moves soon. */
const refreshAfterCredit = _.throttle(() => {
  if (panel.isVisible()) void refreshAccount();
}, ME_AFTER_CREDIT_MS, { leading: true, trailing: true });

function handleCredit(credit, prevTotal) {
  const hit = stats.crossedMilestone(prevTotal, credit.total);
  if (hit) {
    logger.info('milestone reached', hit);
    patch({ celebration: { milestone: hit, at: Date.now() } });
    if (getSettings().notifications) {
      new Notification({
        title: 'avtr.zip - Pusher',
        body: `${hit.toLocaleString('en-US')} discoveries. New badge unlocked.`
      }).show();
    }
  }
  if (credit.granted > 0) refreshAfterCredit();
}

function onPanelVisibility(visible) {
  clearInterval(meTimer);
  meTimer = null;
  if (!visible || !tokenStore.getToken()) return;
  if (Date.now() - lastMeAt > ME_MIN_GAP_MS) void refreshAccount();
  meTimer = setInterval(() => {
    if (panel.isVisible() && tokenStore.getToken()) void refreshAccount();
  }, ME_REFRESH_MS);
}

function handleDeepLink(argv) {
  const arg = [...argv].reverse().find((a) => typeof a === 'string' && a.startsWith('azp://'));
  if (!arg) return;

  const trimmed = arg.replace('azp://', '').replace(/^\/+|\/+$/g, '');
  const [action, value] = trimmed.split('/');

  if (action === 'push' && watchers.AvatarIdTestRegex.test(value || '')) {
    logger.info('deeplink: push', value);
    pushQueue.offer([value]);
  } else if (action === 'open' || action === 'panel') {
    panel.show(tray.getTray()?.getBounds());
  }
}

async function main() {
  patch({ version: app.getVersion(), settings: getSettings() });

  seen.load();
  tokenStore.load();

  const encryptionAvailable = tokenStore.isEncryptionAvailable();
  patch({
    encryptionAvailable,
    mode: tokenStore.getToken() ? 'linked' : 'anonymous',
    identity: tokenStore.getIdentity()
  });

  panel.create();
  tray.create();
  ipc.register({ refreshAccount });

  // A 401 anywhere means re-link. Surface it and put the tray back in sync.
  const onUnauthorized = () => {
    patch({ mode: 'anonymous', identity: null, stats: null });
    stats.invalidate();
    tray.refresh();
  };
  pushQueue.setUnauthorizedHandler(onUnauthorized);
  heartbeat.setUnauthorizedHandler(onUnauthorized);
  stats.setUnauthorizedHandler(onUnauthorized);
  pushQueue.setCreditHandler(handleCredit);
  panel.onVisibilityChange(onPanelVisibility);

  await watchers.start((ids) => {
    pushQueue.offer(ids);
    tray.refresh();
  });
  heartbeat.start();

  // Once at startup so the tray knows who this is; after that only while visible.
  void refreshAccount();
  void checkForUpdates();

  logger.info(`avtr.zip Pusher v${app.getVersion()} running, ${seen.size()} avatars seen so far`);

  if (getSettings().notifications) {
    new Notification({
      title: 'avtr.zip - Pusher',
      body: getState().mode === 'linked'
        ? `Running in the tray as ${getState().identity?.displayName ?? 'you'}. Seen avatars: ${seen.size()}`
        : `Running in the tray. Seen avatars: ${seen.size()}. Link your account to earn credit.`
    }).show();
  }

  if (getSettings().panelOnLaunch) panel.show(tray.getTray()?.getBounds());

  app.on('second-instance', (_event, argv) => handleDeepLink(argv));
  handleDeepLink(process.argv);
}

app.on('before-quit', () => panel.markQuitting());
// The panel is not a document window; closing it must not end the app.
app.on('window-all-closed', () => {});

app.whenReady().then(() => {
  if (!app.requestSingleInstanceLock()) {
    app.quit();
    return;
  }
  main().catch((err) => logger.error('fatal: startup failed', err));
});
