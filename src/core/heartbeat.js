import * as api from './api.js';
import * as tokenStore from './tokenStore.js';
import { getLastLogActivity } from './watchers.js';
import { logger } from '../main/logger.js';
import { patchIn, getState } from '../main/state.js';

const HEARTBEAT_MS = 300 * 1000;
const LIVENESS_MS = 3 * 60 * 1000;
const CHECK_MS = 30 * 1000;

let heartbeatTimer = null;
let checkTimer = null;
let onUnauthorized = () => {};

export function setUnauthorizedHandler(handler) {
  onUnauthorized = handler;
}

/**
 * VRChat counts as running when its log was written to recently. That is enough for
 * a liveness signal and costs nothing beyond the tail we already run.
 */
export function isVrchatRunning() {
  const last = getLastLogActivity();
  return !!last && Date.now() - last < LIVENESS_MS;
}

async function send() {
  if (!tokenStore.getToken() || !isVrchatRunning()) return;
  try {
    await api.heartbeat(true);
    patchIn('vrchat', { lastHeartbeatAt: Date.now() });
    logger.debug('heartbeat: sent');
  } catch (err) {
    if (err.status === 401) {
      logger.warn('heartbeat: token rejected');
      tokenStore.clear();
      onUnauthorized();
      return;
    }
    logger.debug('heartbeat: failed', err.code);
  }
}

export function start() {
  stop();

  checkTimer = setInterval(() => {
    const running = isVrchatRunning();
    if (running !== getState().vrchat.running) {
      logger.info('vrchat:', running ? 'running' : 'not running');
      patchIn('vrchat', { running });
      // No goodbye call exists. When VRChat stops we simply stop sending and let
      // the server-side TTL do the work.
      if (running) void send();
    }
    patchIn('vrchat', { lastLogActivityAt: getLastLogActivity() });
  }, CHECK_MS);

  heartbeatTimer = setInterval(() => void send(), HEARTBEAT_MS);
  void send();
}

export function stop() {
  clearInterval(heartbeatTimer);
  clearInterval(checkTimer);
  heartbeatTimer = null;
  checkTimer = null;
}
