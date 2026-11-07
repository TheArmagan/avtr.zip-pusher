import { EventEmitter } from 'node:events';

const ACTIVITY_LIMIT = 50;

const state = {
  version: '0.0.0',
  mode: 'anonymous', // 'anonymous' | 'linking' | 'linked'
  encryptionAvailable: true,
  link: null,        // { userCode, verifyUrl, expiresAt, status }
  identity: null,    // { displayName, vrchatUserId, credit, pushCount, rank, leaderboardOptOut, tokenId }
  session: { seen: 0, pushed: 0, new: 0, credited: 0, skipped: 0 },
  quota: null,       // { remaining, maxIds, resetSeconds }
  vrchat: { running: false, lastHeartbeatAt: null, lastLogActivityAt: null },
  activity: [],      // [{ avatarId, state, listed, credited, at }]
  stats: null,       // from /me: { ranks, streak, milestones, impact, awards, updatedAt }
  celebration: null, // { milestone, at } when a badge was just crossed
  update: null,      // { available, latestVersion, url }
  settings: {},
  pending: 0,        // ids buffered and not yet sent
  error: null        // { code, message }
};

export const events = new EventEmitter();

export function getState() {
  return state;
}

/** Shallow-merge a patch and notify listeners. */
export function patch(next) {
  Object.assign(state, next);
  events.emit('change', state);
}

/** Merge into one nested object without clobbering its siblings. */
export function patchIn(key, next) {
  state[key] = { ...(state[key] || {}), ...next };
  events.emit('change', state);
}

export function addActivity(entries) {
  if (!entries.length) return;
  state.activity = [...entries, ...state.activity].slice(0, ACTIVITY_LIMIT);
  events.emit('change', state);
}

export function bumpSession(patchCounts) {
  for (const [k, v] of Object.entries(patchCounts)) {
    state.session[k] = (state.session[k] || 0) + v;
  }
  events.emit('change', state);
}

export function setError(error) {
  state.error = error;
  events.emit('change', state);
}
