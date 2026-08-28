import fs from 'node:fs';
import path from 'node:path';
import { files } from './paths.js';

const MAX_BYTES = 1024 * 1024;
const KEEP = 3;

/**
 * Any avzp_ token that reaches the logger by accident is masked here. The prefix
 * exists so secrets can be caught by scanners; this makes sure we never write one.
 */
const TOKEN_RE = /avzp_[A-Za-z0-9_-]{8,}/g;

export function redact(value) {
  if (typeof value === 'string') return value.replace(TOKEN_RE, 'avzp_***');
  if (value instanceof Error) return redact(value.stack || value.message);
  if (value && typeof value === 'object') {
    try {
      return JSON.stringify(value).replace(TOKEN_RE, 'avzp_***');
    } catch {
      return '[unserialisable]';
    }
  }
  return String(value);
}

let stream = null;

function rotateIfNeeded(filePath) {
  try {
    if (fs.statSync(filePath).size < MAX_BYTES) return;
  } catch {
    return; // no file yet
  }
  if (stream) {
    stream.end();
    stream = null;
  }
  for (let i = KEEP - 1; i >= 1; i--) {
    const from = `${filePath}.${i}`;
    const to = `${filePath}.${i + 1}`;
    if (fs.existsSync(from)) fs.renameSync(from, to);
  }
  fs.renameSync(filePath, `${filePath}.1`);
}

function write(line) {
  const filePath = files.logFile();
  try {
    if (!stream) {
      fs.mkdirSync(path.dirname(filePath), { recursive: true });
      rotateIfNeeded(filePath);
      stream = fs.createWriteStream(filePath, { flags: 'a' });
      stream.on('error', () => { stream = null; });
    }
    stream.write(line + '\n');
    if (stream.bytesWritten > MAX_BYTES) rotateIfNeeded(filePath);
  } catch {
    // logging must never take the app down
  }
}

function emit(level, args) {
  const message = args.map(redact).join(' ');
  const line = `${new Date().toISOString()} ${level.toUpperCase().padEnd(5)} ${message}`;
  if (level === 'error') console.error(line);
  else if (level === 'warn') console.warn(line);
  else console.log(line);
  write(line);
}

export const logger = {
  debug: (...a) => emit('debug', a),
  info: (...a) => emit('info', a),
  warn: (...a) => emit('warn', a),
  error: (...a) => emit('error', a)
};
