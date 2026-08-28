import fs from 'node:fs';
import { promises as fsp } from 'node:fs';
import { files } from '../main/paths.js';
import { logger } from '../main/logger.js';

let cache = new Set();

export function load() {
  cache = new Set();
  try {
    const data = fs.readFileSync(files.seenAvatars(), 'utf-8');
    for (const line of data.split('\n')) {
      const id = line.trim();
      if (id) cache.add(id);
    }
  } catch (err) {
    if (err.code !== 'ENOENT') logger.warn('seenAvatars: could not read', err);
  }
  return cache;
}

export function has(id) {
  return cache.has(id);
}

export function size() {
  return cache.size;
}

export function all() {
  return [...cache];
}

/** Marked seen only once a push has actually gone through, so an outage never swallows ids. */
export async function commit(ids) {
  const fresh = ids.filter((id) => !cache.has(id));
  if (!fresh.length) return;
  for (const id of fresh) cache.add(id);
  try {
    await fsp.appendFile(files.seenAvatars(), fresh.join('\n') + '\n');
  } catch (err) {
    logger.warn('seenAvatars: could not append', err);
  }
}

export function clear() {
  cache = new Set();
  try {
    fs.unlinkSync(files.seenAvatars());
  } catch (err) {
    if (err.code !== 'ENOENT') logger.warn('seenAvatars: could not clear', err);
  }
}
