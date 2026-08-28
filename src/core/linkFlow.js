import os from 'node:os';
import { shell } from 'electron';
import * as api from './api.js';
import * as tokenStore from './tokenStore.js';
import { logger } from '../main/logger.js';
import { patch, patchIn, setError, getState } from '../main/state.js';

/** The device code never touches disk and is never logged. Memory only. */
let deviceCode = null;
let pollTimer = null;
let expiryTimer = null;

function stopTimers() {
  clearTimeout(pollTimer);
  clearTimeout(expiryTimer);
  pollTimer = null;
  expiryTimer = null;
}

export function cancel(reason = 'cancelled') {
  stopTimers();
  deviceCode = null;
  if (getState().mode === 'linking') {
    patch({ mode: tokenStore.getToken() ? 'linked' : 'anonymous', link: null });
    logger.info('link: flow ended -', reason);
  }
}

export async function start(onLinked) {
  if (!tokenStore.isEncryptionAvailable()) {
    setError({
      code: 'no_encryption',
      message: 'Windows credential encryption is unavailable, so a token cannot be stored safely.'
    });
    return;
  }

  cancel('restarting');
  setError(null);

  let session;
  try {
    session = await api.openLink(os.hostname());
  } catch (err) {
    setError(api.describeError(err));
    logger.error('link: could not open a session', err);
    return;
  }

  deviceCode = session.deviceCode;
  patch({
    mode: 'linking',
    link: {
      userCode: session.userCode,
      verifyUrl: session.verifyUrl,
      expiresAt: session.expiresAt,
      expiresIn: session.expiresIn || 600,
      status: 'pending'
    }
  });
  logger.info('link: session open, user code', session.userCode);

  shell.openExternal(session.verifyUrl).catch((err) => logger.warn('link: could not open browser', err));

  const intervalMs = Math.max(1, session.interval || 5) * 1000;
  const expiresIn = (session.expiresIn || 600) * 1000;

  expiryTimer = setTimeout(() => {
    patchIn('link', { status: 'expired' });
    stopTimers();
    deviceCode = null;
  }, expiresIn);

  const tick = async () => {
    if (!deviceCode) return;
    let result;
    try {
      result = await api.pollLink(deviceCode);
    } catch (err) {
      // 404 covers wrong, expired, already-collected and denied alike; 409 means the
      // token was already handed out. Neither is worth another poll.
      if (err.status === 404 || err.status === 409) {
        patchIn('link', { status: err.status === 409 ? 'consumed' : 'expired' });
        cancel(`poll refused (${err.status})`);
        return;
      }
      logger.warn('link: poll failed, retrying', err);
      pollTimer = setTimeout(tick, intervalMs);
      return;
    }

    if (result.status === 'linked') {
      stopTimers();
      deviceCode = null;
      const identity = {
        tokenId: result.tokenId,
        vrchatUserId: result.vrchatUserId,
        displayName: result.displayName,
        label: os.hostname()
      };
      try {
        // Persist before anything else: the token is returned exactly once.
        tokenStore.save(result.token, identity);
      } catch (err) {
        logger.error('link: could not store the token', err);
        setError({ code: 'store_failed', message: err.message });
        patch({ mode: 'anonymous', link: null });
        return;
      }
      patch({ mode: 'linked', link: null, identity: { ...identity, credit: 0, rank: null } });
      logger.info('link: linked as', identity.displayName);
      onLinked?.();
      return;
    }

    if (result.status === 'denied' || result.status === 'expired') {
      patchIn('link', { status: result.status });
      cancel(result.status);
      return;
    }

    patchIn('link', { status: result.status });
    pollTimer = setTimeout(tick, intervalMs);
  };

  pollTimer = setTimeout(tick, intervalMs);
}
