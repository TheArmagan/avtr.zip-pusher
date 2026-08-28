import { BrowserWindow, screen, shell } from 'electron';
import { assets } from './paths.js';
import { logger } from './logger.js';
import { getState, events } from './state.js';

const WIDTH = 380;
const HEIGHT = 600;
const GAP = 8;

/** @type {BrowserWindow | null} */
let win = null;
let quitting = false;
/** Set from the renderer while a sheet is open, so a focus change does not eat it. */
let holdOpen = false;

export function setHoldOpen(value) {
  holdOpen = !!value;
}

export function markQuitting() {
  quitting = true;
}

export function create() {
  if (win) return win;

  win = new BrowserWindow({
    width: WIDTH,
    height: HEIGHT,
    show: false,
    frame: false,
    transparent: true,
    resizable: false,
    movable: false,
    minimizable: false,
    maximizable: false,
    fullscreenable: false,
    skipTaskbar: true,
    alwaysOnTop: true,
    backgroundColor: '#00000000',
    webPreferences: {
      preload: assets.preload,
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
      devTools: !process.env.AVTR_NO_DEVTOOLS
    }
  });

  win.loadFile(assets.panelHtml).catch((err) => logger.error('panel: could not load the UI', err));

  win.on('blur', () => {
    if (!holdOpen) hide();
  });

  win.on('close', (event) => {
    // The window is created once and reused; closing just hides it.
    if (quitting) return;
    event.preventDefault();
    hide();
  });

  // Nothing in this window should be able to navigate away or open a chrome window.
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:/.test(url)) shell.openExternal(url);
    return { action: 'deny' };
  });
  win.webContents.on('will-navigate', (event) => event.preventDefault());

  events.on('change', (state) => {
    if (win && !win.isDestroyed()) win.webContents.send('state', state);
  });

  win.webContents.on('did-finish-load', () => {
    win.webContents.send('state', getState());
  });

  return win;
}

/** Anchor to the tray icon, then clamp into the display's work area. */
function position(trayBounds) {
  if (!win) return;
  const point = trayBounds && trayBounds.width
    ? { x: Math.round(trayBounds.x + trayBounds.width / 2), y: Math.round(trayBounds.y) }
    : screen.getCursorScreenPoint();
  const display = screen.getDisplayNearestPoint(point);
  const area = display.workArea;

  let x = Math.round(point.x - WIDTH / 2);
  let y;

  // The taskbar edge decides whether the panel sits above, below or beside the icon.
  if (trayBounds && trayBounds.height && trayBounds.y >= area.y + area.height - trayBounds.height - 2) {
    y = area.y + area.height - HEIGHT - GAP;          // taskbar at the bottom
  } else if (trayBounds && trayBounds.y <= area.y + 2) {
    y = area.y + GAP;                                  // taskbar at the top
  } else if (trayBounds && trayBounds.x <= area.x + 2) {
    x = area.x + GAP;                                  // taskbar on the left
    y = Math.round(point.y - HEIGHT / 2);
  } else if (trayBounds && trayBounds.x >= area.x + area.width - trayBounds.width - 2) {
    x = area.x + area.width - WIDTH - GAP;             // taskbar on the right
    y = Math.round(point.y - HEIGHT / 2);
  } else {
    y = area.y + area.height - HEIGHT - GAP;
  }

  x = Math.min(Math.max(x, area.x + GAP), area.x + area.width - WIDTH - GAP);
  y = Math.min(Math.max(y, area.y + GAP), area.y + area.height - HEIGHT - GAP);

  win.setBounds({ x, y, width: WIDTH, height: HEIGHT });
}

export function show(trayBounds) {
  const w = create();
  position(trayBounds);
  w.show();
  w.focus();
}

export function hide() {
  if (!win || win.isDestroyed() || !win.isVisible()) return;
  win.hide();
  // Reopening should land on the panel, never on whatever sheet was left open.
  win.webContents.send('hidden');
}

export function toggle(trayBounds) {
  if (win && !win.isDestroyed() && win.isVisible()) hide();
  else show(trayBounds);
}

export function isVisible() {
  return !!win && !win.isDestroyed() && win.isVisible();
}

export function getWindow() {
  return win;
}
