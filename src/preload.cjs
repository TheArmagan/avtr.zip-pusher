const { contextBridge, ipcRenderer } = require('electron');

/** Every call returns { ok, value } or { ok: false, error }. */
const call = (channel, ...args) => ipcRenderer.invoke(channel, ...args);

contextBridge.exposeInMainWorld('pusher', {
  onState(callback) {
    const listener = (_event, state) => callback(state);
    ipcRenderer.on('state', listener);
    return () => ipcRenderer.removeListener('state', listener);
  },
  getState: () => call('state:get'),

  onHidden(callback) {
    const listener = () => callback();
    ipcRenderer.on('hidden', listener);
    return () => ipcRenderer.removeListener('hidden', listener);
  },

  link: {
    start: () => call('link:start'),
    cancel: () => call('link:cancel'),
    copyCode: () => call('link:copyCode'),
    openVerifyUrl: () => call('link:openVerifyUrl')
  },
  push: {
    now: () => call('push:now'),
    force: () => call('push:force')
  },
  account: {
    refresh: () => call('account:refresh'),
    signOut: () => call('account:signOut'),
    setLeaderboardOptOut: (value) => call('account:setLeaderboardOptOut', value)
  },
  settings: {
    get: () => call('settings:get'),
    set: (patch) => call('settings:set', patch)
  },
  system: {
    getLoginItem: () => call('system:getLoginItem'),
    setLoginItem: (value) => call('system:setLoginItem', value)
  },
  app: {
    getIcon: () => call('app:getIcon'),
    openExternal: (url) => call('app:openExternal', url),
    openLogFile: () => call('app:openLogFile'),
    checkForUpdates: () => call('app:checkForUpdates'),
    hide: () => call('app:hide'),
    holdOpen: (value) => call('app:holdOpen', value),
    quit: () => call('app:quit')
  }
});
