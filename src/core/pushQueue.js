import * as api from './api.js';
import * as seen from './seenAvatars.js';
import * as tokenStore from './tokenStore.js';
import { logger } from '../main/logger.js';
import { addActivity, bumpSession, patch, patchIn, setError, getState } from '../main/state.js';

const DEBOUNCE_MS = 2000;
/** Below this share of the batch cap we wait for the window to reset rather than probe it. */
const QUOTA_FLOOR = 0.1;

const buffer = new Set();
let flushTimer = null;
let flushing = false;
let pausedUntil = 0;
let backoffMs = 1000;
let onUnauthorized = () => {};

export function setUnauthorizedHandler(handler) {
  onUnauthorized = handler;
}

function maxIds() {
  return tokenStore.getToken() ? api.MAX_IDS_AUTHED : api.MAX_IDS_ANON;
}

/** Ingest ids discovered by the watchers. Already-seen ids are dropped here. */
export function offer(ids) {
  let added = 0;
  for (const id of ids) {
    if (seen.has(id) || buffer.has(id)) continue;
    buffer.add(id);
    added++;
  }
  if (!added) return;
  bumpSession({ seen: added });
  patch({ pending: buffer.size });

  if (buffer.size >= maxIds()) {
    void flush();
    return;
  }
  clearTimeout(flushTimer);
  flushTimer = setTimeout(() => void flush(), DEBOUNCE_MS);
}

function take(limit) {
  const ids = [];
  for (const id of buffer) {
    if (ids.length >= limit) break;
    ids.push(id);
  }
  for (const id of ids) buffer.delete(id);
  return ids;
}

function recordResults(results) {
  const now = Date.now();
  const entries = [];
  const counts = { pushed: 0, new: 0, credited: 0, skipped: 0 };

  for (const r of results || []) {
    counts.pushed++;
    if (r.state === 'new') counts.new++;
    if (r.state === 'skipped') counts.skipped++;
    // credited is deliberately not the same as state === 'new': under a concurrent
    // first push two callers both see 'new' and only one is credited.
    if (r.credited) counts.credited++;
    entries.push({
      avatarId: r.avatarId,
      state: r.state,
      listed: !!r.listed,
      credited: !!r.credited,
      at: now
    });
  }

  addActivity(entries);
  bumpSession(counts);
}

/** The v3 batch path: one request for the whole batch, with credit and quota back. */
async function flushAuthed(ids, force, explicit) {
  const res = await api.push(ids, force);

  recordResults(res.results);
  if (res.quota) patch({ quota: res.quota });
  if (res.credit) patchIn('identity', { credit: res.credit.total, rank: res.credit.rank });
  if (!explicit) await seen.commit(ids);

  // The server returns quota so we do not have to find the limit by hitting it.
  const q = res.quota;
  if (q && q.remaining <= Math.max(1, q.maxIds * QUOTA_FLOOR)) {
    pausedUntil = Date.now() + (q.resetSeconds || 60) * 1000;
    logger.info('push: quota low, pausing for', q.resetSeconds, 'seconds');
    schedulePausedResume();
  }
}

/**
 * The open v1 path takes one id per request, so a batch becomes a small pool of calls.
 * A single failure must not lose the rest of the batch, so each id is settled on its own
 * and only the ones that actually landed are marked seen.
 */
async function flushAnonymous(ids, explicit) {
  const queue = [...ids];
  const landed = [];
  let lastError = null;

  const worker = async () => {
    while (queue.length) {
      const id = queue.shift();
      try {
        const result = await api.pushAnonymous(id);
        recordResults([result]);
        landed.push(id);
      } catch (err) {
        lastError = err;
        buffer.add(id);
      }
    }
  };

  await Promise.all(
    Array.from({ length: Math.min(api.ANON_CONCURRENCY, ids.length) }, worker)
  );

  if (!explicit && landed.length) await seen.commit(landed);
  // Anonymous pushing has no quota to report; the panel shows a dash.
  if (lastError && !landed.length) throw lastError;
}

export async function flush({ force = false, ids: explicitIds = null } = {}) {
  clearTimeout(flushTimer);
  flushTimer = null;

  if (flushing) return;
  if (Date.now() < pausedUntil) return;

  const authed = !!tokenStore.getToken();
  const ids = explicitIds ? explicitIds.slice(0, maxIds()) : take(maxIds());
  if (!ids.length) return;

  flushing = true;
  patch({ pending: buffer.size });
  try {
    if (authed) await flushAuthed(ids, force, !!explicitIds);
    else await flushAnonymous(ids, !!explicitIds);
    setError(null);
    backoffMs = 1000;
  } catch (err) {
    handleFailure(err, ids, explicitIds);
  } finally {
    flushing = false;
    patch({ pending: buffer.size });
  }

  if (buffer.size && Date.now() >= pausedUntil) {
    flushTimer = setTimeout(() => void flush(), DEBOUNCE_MS);
  }
}

function schedulePausedResume() {
  setTimeout(() => {
    if (buffer.size) void flush();
  }, Math.max(0, pausedUntil - Date.now()) + 250);
}

function requeue(ids) {
  for (const id of ids) buffer.add(id);
}

function handleFailure(err, ids, wasExplicit) {
  const described = api.describeError(err);

  switch (err.status) {
    case 401:
      // Unknown, revoked and expired are deliberately indistinguishable. All mean re-link.
      if (!tokenStore.getToken()) {
        logger.error('push: unauthenticated push was refused');
        setError(described);
        break;
      }
      logger.warn('push: token rejected, dropping to anonymous');
      tokenStore.clear();
      patch({ mode: 'anonymous', identity: null });
      setError(described);
      onUnauthorized();
      if (!wasExplicit) requeue(ids);
      break;

    case 403:
      logger.error('push: this address is blocked');
      setError(described);
      break;

    case 429: {
      const wait = (err.retryAfter ?? 60) * 1000;
      pausedUntil = Date.now() + wait;
      logger.warn('push: rate limited, waiting', Math.round(wait / 1000), 'seconds');
      setError(described);
      if (!wasExplicit) requeue(ids);
      schedulePausedResume();
      break;
    }

    case 400:
      // A malformed batch will never succeed as-is; drop it rather than loop.
      logger.error('push: batch rejected', described.code);
      setError(described);
      break;

    default: {
      // 503 and network failures: keep the ids and back off.
      const wait = Math.min(backoffMs, 5 * 60 * 1000);
      backoffMs = Math.min(backoffMs * 2, 5 * 60 * 1000);
      pausedUntil = Date.now() + wait;
      logger.warn('push: failed, retrying in', Math.round(wait / 1000), 'seconds', described.code);
      setError(described);
      if (!wasExplicit) requeue(ids);
      schedulePausedResume();
    }
  }
}

/** Panel action: send whatever is buffered right now. */
export async function pushNow() {
  pausedUntil = 0;
  await flush();
}

/**
 * Panel action: re-push the most recent ids with force, bypassing the 15-minute
 * "recently refreshed" skip. This costs upstream budget, so it is deliberately capped.
 */
export async function forcePush(count = 50) {
  pausedUntil = 0;
  const recent = getState().activity.slice(0, count).map((a) => a.avatarId);
  const ids = recent.length ? recent : seen.all().slice(-count);
  if (!ids.length) return;
  await flush({ force: true, ids });
}

export function pending() {
  return buffer.size;
}
