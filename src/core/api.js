import { logger } from '../main/logger.js';
import { getToken } from './tokenStore.js';

export const BASE_URL = 'https://avtr.zip';

/**
 * The open, unauthenticated endpoint is the older v1 one on the api host. It takes a
 * single id per request and has no batch form; /v3/pusher/push always wants a bearer.
 */
export const V1_PUSH_URL = 'https://api.avtr.zip/v1/avatars/push';

/** An authenticated pusher gets 500 ids per request. Anonymous callers get 50 total. */
export const MAX_IDS_AUTHED = 500;
export const MAX_IDS_ANON = 50;
/** How many single-id v1 calls to have in flight at once. */
export const ANON_CONCURRENCY = 4;

export class ApiError extends Error {
  constructor(status, code, message, retryAfter) {
    super(message || code || `HTTP ${status}`);
    this.name = 'ApiError';
    this.status = status;
    this.code = code;
    this.retryAfter = retryAfter;
  }
}

function parseRetryAfter(res) {
  const raw = res.headers.get('retry-after');
  if (!raw) return null;
  const seconds = Number(raw);
  if (Number.isFinite(seconds)) return seconds;
  const at = Date.parse(raw);
  return Number.isNaN(at) ? null : Math.max(0, (at - Date.now()) / 1000);
}

async function request(method, path, { body, auth = false, timeoutMs = 20000 } = {}) {
  const headers = { Accept: 'application/json' };
  if (body !== undefined) headers['Content-Type'] = 'application/json';

  if (auth) {
    const token = getToken();
    if (!token) throw new ApiError(401, 'invalid_token', 'No stored token');
    headers.Authorization = `Bearer ${token}`;
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  let res;
  try {
    res = await fetch(BASE_URL + path, {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: controller.signal
    });
  } catch (err) {
    clearTimeout(timer);
    throw new ApiError(0, 'network', err.name === 'AbortError' ? 'Request timed out' : err.message);
  }
  clearTimeout(timer);

  let payload = null;
  try {
    payload = await res.json();
  } catch {
    payload = null;
  }

  if (!res.ok) {
    const code = payload?.code || payload?.refusal || `http_${res.status}`;
    // Errors carry their human text in `error`; older endpoints used `message`.
    const message = payload?.message || (typeof payload?.error === 'string' ? payload.error : undefined);
    const retryAfter = parseRetryAfter(res) ?? (Number.isFinite(payload?.retryAfterSeconds) ? payload.retryAfterSeconds : null);
    throw new ApiError(res.status, code, message, retryAfter);
  }

  return payload;
}

/* ---- linking ------------------------------------------------------------ */

export function openLink(label) {
  const body = {};
  if (label) body.label = String(label).slice(0, 60);
  return request('POST', '/v3/pusher/link', { body });
}

/**
 * The device code goes in the body on purpose. As a path parameter it would land in
 * access logs, metrics and every proxy in between, and it is the value that collects
 * the token.
 */
export function pollLink(deviceCode) {
  return request('POST', '/v3/pusher/link/poll', { body: { deviceCode } });
}

/* ---- pushing ------------------------------------------------------------ */

export function push(avatarIds, force = false) {
  return request('POST', '/v3/pusher/push', { body: { avatarIds, force }, auth: true });
}

/**
 * One id, the v1 way. Its answer is a set of booleans rather than a state string, so
 * it is normalised here into the same shape the v3 results use.
 */
export async function pushAnonymous(avatarId) {
  let res;
  try {
    res = await fetch(V1_PUSH_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify({ avatarId }),
      signal: AbortSignal.timeout(20000)
    });
  } catch (err) {
    throw new ApiError(0, 'network', err.message);
  }

  if (!res.ok) {
    // Normalise onto the same codes the v3 errors use so the panel says the same thing.
    const code = { 429: 'rate_limited', 503: 'ingest_unavailable', 400: 'invalid_avatar_id' }[res.status]
      || `http_${res.status}`;
    throw new ApiError(res.status, code, res.statusText, parseRetryAfter(res));
  }

  const payload = await res.json().catch(() => ({}));
  let state = 'skipped';
  if (payload.isDeleted) state = 'missing';
  else if (payload.isNew) state = 'new';
  else if (payload.isRefreshed) state = 'refreshed';

  // v1 grants no discovery credit; that is the whole point of linking.
  return { avatarId, state, listed: !payload.isDeleted, credited: false };
}

export function heartbeat(playing) {
  return request('POST', '/v3/pusher/heartbeat', { body: { playing }, auth: true });
}

/* ---- account ------------------------------------------------------------ */

export function me() {
  return request('GET', '/v3/pusher/me', { auth: true });
}

export function patchMe(body) {
  return request('PATCH', '/v3/pusher/me', { body, auth: true });
}

export function createToken(label) {
  return request('POST', '/v3/pusher/tokens', { body: { label }, auth: true });
}

export function revokeToken(tokenId) {
  return request('DELETE', `/v3/pusher/tokens/${encodeURIComponent(tokenId)}`, { auth: true });
}

/* ---- stats (personal) ---------------------------------------------------- */

export const PERIODS = ['all', 'week', 'month'];

function query(params) {
  const qs = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) {
    if (v !== undefined && v !== null && v !== '') qs.set(k, String(v));
  }
  const str = qs.toString();
  return str ? `?${str}` : '';
}

export function neighbors({ period = 'all', span = 3 } = {}) {
  return request('GET', `/v3/pusher/me/neighbors${query({ period, span })}`, { auth: true });
}

export function myDiscoveries({ cursor, limit = 30 } = {}) {
  return request('GET', `/v3/pusher/me/discoveries${query({ cursor, limit })}`, { auth: true });
}

/* ---- public ------------------------------------------------------------- */

export function leaderboard({ period, cursor, limit = 50 } = {}) {
  return request('GET', `/v3/pusher/leaderboard${query({ period, cursor, limit })}`);
}

export function awards({ cursor, limit = 10 } = {}) {
  return request('GET', `/v3/pusher/awards${query({ cursor, limit })}`);
}

export function publicProfile(vrchatUserId) {
  return request('GET', `/v3/pusher/u/${encodeURIComponent(vrchatUserId)}`);
}

export function describeError(err) {
  if (!(err instanceof ApiError)) return { code: 'unknown', message: String(err?.message || err) };
  const map = {
    invalid_body: 'The request was rejected as malformed.',
    invalid_avatar_id: 'One of the avatar ids was rejected.',
    too_many_ids: 'Too many ids in one batch.',
    invalid_token: 'Your link has expired or was revoked. Link again to keep earning credit.',
    blocked: 'This network is blocked. A new token will not help.',
    rate_limited: 'Rate limited. Slowing down.',
    ingest_unavailable: 'avtr.zip is busy. Retrying shortly.',
    network: 'Could not reach avtr.zip.',
    invalid_period: 'The app asked for a board that does not exist.',
    not_found: 'That profile is not available.',
    unavailable: 'avtr.zip is having trouble right now. Showing what we last had.'
  };
  logger.debug('api error', err.status, err.code, err.message);
  return { code: err.code, message: map[err.code] || err.message };
}
