import * as api from './api.js';
import * as tokenStore from './tokenStore.js';
import { logger } from '../main/logger.js';

/**
 * Every stats read shares one server budget (60 per minute per IP, scope pusher_read),
 * so they all go through here: one place that respects Retry-After, caches pages the
 * server caches anyway, and hands back the last good answer when the server is down.
 */

const TTL = {
  leaderboard: 60 * 1000,
  neighbors: 30 * 1000,
  awards: 60 * 60 * 1000,
  profile: 60 * 1000
};

/** key -> { value, at } */
const cache = new Map();
let blockedUntil = 0;
let onUnauthorized = () => {};

export function setUnauthorizedHandler(handler) {
  onUnauthorized = handler;
}

export function retryAfterSeconds() {
  return Math.max(0, Math.ceil((blockedUntil - Date.now()) / 1000));
}

/** Run one read against the shared budget. */
export async function read(fn) {
  const wait = retryAfterSeconds();
  if (wait > 0) {
    throw new api.ApiError(429, 'rate_limited', `Rate limited. Try again in ${wait}s.`, wait);
  }
  try {
    return await fn();
  } catch (err) {
    if (err.status === 429) {
      blockedUntil = Date.now() + (err.retryAfter ?? 60) * 1000;
      logger.warn('stats: rate limited for', err.retryAfter ?? 60, 'seconds');
    } else if (err.status === 401 && tokenStore.getToken()) {
      logger.warn('stats: token rejected, dropping to anonymous');
      tokenStore.clear();
      onUnauthorized();
    }
    throw err;
  }
}

/**
 * Serve from cache while fresh. On failure, serve the stale copy if there is one, so a
 * 503 or a 429 leaves the panel showing what it had instead of an error.
 */
async function cached(key, ttl, fn) {
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < ttl) return hit.value;
  try {
    const value = await read(fn);
    cache.set(key, { value, at: Date.now() });
    return value;
  } catch (err) {
    if (hit && err.status !== 401 && err.status !== 400 && err.status !== 404) {
      logger.debug('stats: serving stale', key, err.code);
      return { ...hit.value, stale: true };
    }
    throw err;
  }
}

function period(value) {
  return api.PERIODS.includes(value) ? value : 'all';
}

export function leaderboardPage(p, cursor) {
  const pp = period(p);
  return cached(`lb:${pp}:${cursor || ''}`, TTL.leaderboard, () =>
    api.leaderboard({ period: pp, cursor, limit: 50 }));
}

export function neighbors(p) {
  const pp = period(p);
  return cached(`nb:${pp}`, TTL.neighbors, () => api.neighbors({ period: pp, span: 3 }));
}

/** Personal and paged by cursor; not worth caching. */
export function discoveriesPage(cursor) {
  return read(() => api.myDiscoveries({ cursor, limit: 30 }));
}

export function awardsPage(cursor) {
  return cached(`aw:${cursor || ''}`, TTL.awards, () => api.awards({ cursor, limit: 10 }));
}

export function profile(vrchatUserId) {
  return cached(`u:${vrchatUserId}`, TTL.profile, () => api.publicProfile(vrchatUserId));
}

/** After an opt-out change or a sign-out the boards and neighbour lists are wrong. */
export function invalidate() {
  for (const key of cache.keys()) {
    if (!key.startsWith('aw:')) cache.delete(key);
  }
}

/* ---- milestones --------------------------------------------------------- */

export const MILESTONES = [10, 100, 1000, 10000, 100000];

/** The highest threshold crossed going from `prev` to `next`, or null. */
export function crossedMilestone(prev, next) {
  if (typeof prev !== 'number' || typeof next !== 'number' || next <= prev) return null;
  let hit = null;
  for (const m of MILESTONES) if (prev < m && next >= m) hit = m;
  return hit;
}
