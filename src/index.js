import { app, Notification } from 'electron';
import isSquirrelStartup from 'electron-squirrel-startup';

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

if (isSquirrelStartup) app.quit();

if (process.defaultApp) {
  if (process.argv.length >= 2) {
    app.setAsDefaultProtocolClient('azp', process.execPath, [process.argv[1]]);
  }
} else {
  app.setAsDefaultProtocolClient('azp');
}
app.setAppUserModelId('zip.avtr.pusher');

const LEADERBOARD_REFRESH_MS = 5 * 60 * 1000;

/** Pull identity, credit, rank and the leaderboard peek the panel renders. */
async function refreshAccount() {
  if (tokenStore.getToken()) {
    try {
      const data = await api.me();
      logger.debug('account: me() returned', Object.keys(data).join(', '));

      const identity = tokenStore.updateIdentity({
        vrchatUserId: data.vrchatUserId ?? tokenStore.getIdentity()?.vrchatUserId,
        displayName: data.displayName ?? tokenStore.getIdentity()?.displayName
      });

      // Push returns credit as { granted, total, rank }. Accept that shape here too,
      // as well as a plain number or a separate discovery count.
      const credit = typeof data.credit === 'object' && data.credit ? data.credit : null;
      patch({
        mode: 'linked',
        identity: {
          ...identity,
          credit: credit?.total ?? (typeof data.credit === 'number' ? data.credit : null)
            ?? data.discoveries ?? data.discoveryCount ?? 0,
          rank: credit?.rank ?? data.rank ?? null,
          leaderboardOptOut: !!data.leaderboardOptOut
        }
      });
    } catch (err) {
      if (err.status === 401) {
        logger.warn('account: token rejected, dropping to anonymous');
        tokenStore.clear();
        patch({ mode: 'anonymous', identity: null });
      } else {
        logger.warn('account: refresh failed', err);
      }
    }
  }

  try {
    const board = await api.leaderboard({ limit: 5 });
    patch({ leaderboard: { items: board.items || [], updatedAt: Date.now() } });
  } catch (err) {
    logger.debug('leaderboard: refresh failed', err.code);
  }

  tray.refresh();
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
    patch({ mode: 'anonymous', identity: null });
    tray.refresh();
  };
  pushQueue.setUnauthorizedHandler(onUnauthorized);
  heartbeat.setUnauthorizedHandler(onUnauthorized);

  await watchers.start((ids) => {
    pushQueue.offer(ids);
    tray.refresh();
  });
  heartbeat.start();

  void refreshAccount();
  setInterval(() => void refreshAccount(), LEADERBOARD_REFRESH_MS);
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
