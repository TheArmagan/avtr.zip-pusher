import fs from 'node:fs';
import { safeStorage } from 'electron';
import { files } from '../main/paths.js';
import { logger } from '../main/logger.js';

/**
 * The token itself is encrypted at rest (DPAPI on Windows via safeStorage) and kept
 * in memory only for the lifetime of the process. The non-secret identity fields live
 * in a separate plain file so the panel can render who you are without touching it.
 */

let token = null;
/** @type {{tokenId?: string, vrchatUserId?: string, displayName?: string, label?: string} | null} */
let identity = null;

export function isEncryptionAvailable() {
  try {
    return safeStorage.isEncryptionAvailable();
  } catch {
    return false;
  }
}

export function load() {
  try {
    identity = JSON.parse(fs.readFileSync(files.identity(), 'utf-8'));
  } catch {
    identity = null;
  }

  if (!isEncryptionAvailable()) {
    logger.warn('tokenStore: OS encryption unavailable, staying anonymous');
    return null;
  }

  try {
    const buf = fs.readFileSync(files.credentials());
    token = safeStorage.decryptString(buf);
  } catch (err) {
    if (err.code !== 'ENOENT') logger.warn('tokenStore: could not decrypt stored token', err);
    token = null;
  }

  if (!token) identity = null;
  return token;
}

export function save(newToken, newIdentity) {
  if (!isEncryptionAvailable()) {
    throw new Error('OS encryption is unavailable; refusing to store the token in plaintext.');
  }
  fs.writeFileSync(files.credentials(), safeStorage.encryptString(newToken));
  token = newToken;
  identity = newIdentity;
  fs.writeFileSync(files.identity(), JSON.stringify(newIdentity, null, 2));
  logger.info('tokenStore: token stored for', newIdentity?.displayName ?? 'unknown');
}

export function clear() {
  token = null;
  identity = null;
  for (const f of [files.credentials(), files.identity()]) {
    try {
      fs.unlinkSync(f);
    } catch (err) {
      if (err.code !== 'ENOENT') logger.warn('tokenStore: could not remove', f, err);
    }
  }
}

export function getToken() {
  return token;
}

export function getIdentity() {
  return identity;
}

export function updateIdentity(patch) {
  identity = { ...(identity || {}), ...patch };
  try {
    fs.writeFileSync(files.identity(), JSON.stringify(identity, null, 2));
  } catch (err) {
    logger.warn('tokenStore: could not persist identity', err);
  }
  return identity;
}
