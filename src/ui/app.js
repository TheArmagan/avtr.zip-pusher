'use strict';

const $ = (id) => document.getElementById(id);

const el = {
  liveDot: $('live-dot'),
  liveText: $('live-text'),
  viewMain: $('view-main'),
  viewLink: $('view-link'),
  banner: $('banner'),
  bannerLink: $('banner-link'),
  displayName: $('display-name'),
  rankChip: $('rank-chip'),
  creditTotal: $('credit-total'),
  statSeen: $('stat-seen'),
  statPushed: $('stat-pushed'),
  statCredited: $('stat-credited'),
  statQuota: $('stat-quota'),
  pendingLabel: $('pending-label'),
  activity: $('activity'),
  activityEmpty: $('activity-empty'),
  leaderboard: $('leaderboard'),
  leaderboardEmpty: $('leaderboard-empty'),
  linkIntro: $('link-intro'),
  linkSession: $('link-session'),
  userCode: $('user-code'),
  countdownBar: $('countdown-bar'),
  countdownText: $('countdown-text'),
  linkStatus: $('link-status'),
  retryLink: $('retry-link'),
  heartbeat: $('heartbeat'),
  sheet: $('sheet'),
  versionLabel: $('version-label'),
  optOutRow: $('opt-optout-row'),
  signOut: $('btn-sign-out')
};

let state = null;

/* ---- formatting ---- */

function relativeTime(ts) {
  const s = Math.max(0, Math.round((Date.now() - ts) / 1000));
  if (s < 5) return 'now';
  if (s < 60) return s + 's';
  if (s < 3600) return Math.round(s / 60) + 'm';
  return Math.round(s / 3600) + 'h';
}

function compact(n) {
  if (typeof n !== 'number' || !Number.isFinite(n)) return '0';
  if (n < 1000) return String(n);
  if (n < 1e6) return (n / 1000).toFixed(n < 10000 ? 1 : 0).replace(/\.0$/, '') + 'K';
  return (n / 1e6).toFixed(1).replace(/\.0$/, '') + 'M';
}

/** The id is long and the middle carries no meaning, so trim to the ends. */
function shortId(id) {
  const bare = String(id).replace('avtr_', '');
  return bare.length > 16 ? bare.slice(0, 8) + '...' + bare.slice(-4) : bare;
}

function mmss(ms) {
  const total = Math.max(0, Math.round(ms / 1000));
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, '0')}`;
}

/* ---- rendering ---- */

const LINK_STATUS_TEXT = {
  pending: 'Waiting for you to open the page...',
  claimed: 'Account picked. Now paste the nonce into your VRChat bio.',
  challenged: 'Paste the nonce into your VRChat bio, save, then press "check now".',
  denied: 'You cancelled the request.',
  expired: 'That code expired. Codes last ten minutes.',
  consumed: 'That session was already completed.'
};

function renderBanner(target, s) {
  if (s.update && s.update.available) {
    target.hidden = false;
    target.className = 'banner warn';
    target.innerHTML = '';
    target.append(`Version ${s.update.latestVersion} is available.`);
    const btn = document.createElement('button');
    btn.textContent = 'Get it';
    btn.onclick = () => window.pusher.app.openExternal(s.update.url);
    target.append(btn);
    return;
  }
  if (s.error) {
    target.hidden = false;
    target.className = 'banner bad';
    target.textContent = s.error.message;
    return;
  }
  if (!s.encryptionAvailable) {
    target.hidden = false;
    target.className = 'banner warn';
    target.textContent = 'Windows credential encryption is unavailable, so linking is disabled.';
    return;
  }
  target.hidden = true;
}

function renderActivity(items) {
  el.activityEmpty.classList.toggle('hidden', items.length > 0);
  el.activity.innerHTML = '';
  for (const item of items.slice(0, 25)) {
    const row = document.createElement('div');
    row.className = 'row';

    const id = document.createElement('span');
    id.className = 'id';
    id.textContent = shortId(item.avatarId);
    id.title = item.avatarId;

    const st = document.createElement('span');
    st.className = 'state ' + item.state;
    st.textContent = item.state;
    if (item.credited) st.title = 'Credited to you';

    const ago = document.createElement('span');
    ago.className = 'ago';
    ago.textContent = relativeTime(item.at);

    row.append(id, st, ago);
    el.activity.append(row);
  }
}

function renderLeaderboard(board, identity) {
  const items = (board && board.items) || [];
  el.leaderboardEmpty.classList.toggle('hidden', items.length > 0);
  if (!items.length) {
    el.leaderboardEmpty.textContent = board && board.updatedAt ? 'No entries yet.' : 'Loading...';
  }
  el.leaderboard.innerHTML = '';

  items.forEach((entry, index) => {
    const row = document.createElement('div');
    const isMe = identity && entry.vrchatUserId && entry.vrchatUserId === identity.vrchatUserId;
    row.className = 'lb-row' + (isMe ? ' me' : '');

    const rank = document.createElement('span');
    rank.className = 'rank';
    rank.textContent = entry.rank ?? index + 1;

    const name = document.createElement('span');
    name.className = 'nm';
    name.textContent = entry.displayName || 'unknown';

    const count = document.createElement('span');
    count.className = 'ct';
    const entryCredit = typeof entry.credit === 'object' && entry.credit
      ? entry.credit.total
      : entry.credit;
    count.textContent = compact(entryCredit ?? entry.discoveries ?? entry.discoveryCount ?? 0);

    row.append(rank, name, count);
    el.leaderboard.append(row);
  });
}

function renderLink(s) {
  const session = s.link;
  el.linkIntro.classList.toggle('hidden', !!session);
  el.linkSession.classList.toggle('hidden', !session);
  if (!session) return;

  el.userCode.textContent = session.userCode || '-';
  el.linkStatus.textContent = LINK_STATUS_TEXT[session.status] || 'Working...';

  const dead = ['denied', 'expired', 'consumed'].includes(session.status);
  el.retryLink.classList.toggle('hidden', !dead);
}

function renderCountdown() {
  if (!state || !state.link || !state.link.expiresAt) return;
  const total = (state.link.expiresIn || 600) * 1000;
  const left = new Date(state.link.expiresAt).getTime() - Date.now();
  el.countdownBar.style.width = Math.max(0, Math.min(100, (left / total) * 100)) + '%';
  el.countdownText.textContent = left > 0 ? `${mmss(left)} left` : 'expired';
}

function renderHeartbeat() {
  if (!state) return;
  const { running, lastHeartbeatAt } = state.vrchat;
  if (state.mode !== 'linked') {
    el.heartbeat.textContent = '';
  } else if (!running) {
    el.heartbeat.textContent = 'heartbeat idle';
  } else if (lastHeartbeatAt) {
    el.heartbeat.textContent = 'heartbeat ' + relativeTime(lastHeartbeatAt) + ' ago';
  } else {
    el.heartbeat.textContent = 'heartbeat starting';
  }
}

function render(next) {
  state = next;
  const linked = state.mode === 'linked';

  el.viewMain.classList.toggle('hidden', !linked);
  el.viewLink.classList.toggle('hidden', linked);

  el.liveDot.classList.toggle('on', state.vrchat.running);
  el.liveText.textContent = state.vrchat.running ? 'VRChat' : 'idle';

  renderBanner(el.banner, state);
  renderBanner(el.bannerLink, state);

  const identity = state.identity || {};
  el.displayName.textContent = identity.displayName || 'Anonymous';
  el.creditTotal.textContent = compact(identity.credit || 0);
  el.rankChip.hidden = !identity.rank;
  if (identity.rank) el.rankChip.textContent = '#' + identity.rank;
  el.rankChip.className = 'chip accent';

  el.statSeen.textContent = compact(state.session.seen);
  el.statPushed.textContent = compact(state.session.pushed);
  el.statCredited.textContent = compact(state.session.credited);
  el.statQuota.textContent = state.quota ? compact(state.quota.remaining) : '-';

  el.pendingLabel.textContent = state.pending ? state.pending + ' queued' : '';

  renderActivity(state.activity);
  renderLeaderboard(state.leaderboard, identity);
  renderLink(state);
  renderCountdown();
  renderHeartbeat();

  // settings sheet
  el.versionLabel.textContent = 'v' + state.version;
  setSwitch('opt-notifications', state.settings.notifications);
  setSwitch('opt-confirm-force', state.settings.confirmForcePush);
  setSwitch('opt-panel-launch', state.settings.panelOnLaunch);
  setSwitch('opt-optout', !!identity.leaderboardOptOut);
  el.optOutRow.classList.toggle('hidden', !linked);
  el.signOut.classList.toggle('hidden', !linked);
}

/* ---- controls ---- */

function setSwitch(id, value) {
  $(id).setAttribute('aria-checked', value ? 'true' : 'false');
}

function isOn(id) {
  return $(id).getAttribute('aria-checked') === 'true';
}

function onSwitch(id, handler) {
  $(id).addEventListener('click', async () => {
    const next = !isOn(id);
    setSwitch(id, next);
    const res = await handler(next);
    // If the main process refused, snap back rather than lie about the state.
    if (res && res.ok === false) setSwitch(id, !next);
  });
}

$('start-link').onclick = () => window.pusher.link.start();
$('cancel-link').onclick = () => window.pusher.link.cancel();
$('retry-link').onclick = () => window.pusher.link.start();
$('copy-code').onclick = async () => {
  await window.pusher.link.copyCode();
  const btn = $('copy-code');
  btn.textContent = 'Copied';
  setTimeout(() => { btn.textContent = 'Copy'; }, 1200);
};
$('reopen-url').onclick = () => window.pusher.link.openVerifyUrl();

$('push-now').onclick = async () => {
  const btn = $('push-now');
  btn.disabled = true;
  await window.pusher.push.now();
  btn.disabled = false;
};
$('force-push').onclick = async () => {
  const btn = $('force-push');
  btn.disabled = true;
  // The confirm dialog steals focus; hold the panel open across it.
  await window.pusher.app.holdOpen(true);
  await window.pusher.push.force();
  await window.pusher.app.holdOpen(false);
  btn.disabled = false;
};

$('open-leaderboard').onclick = () =>
  window.pusher.app.openExternal('https://avtr.zip/pusher/leaderboard');

function openSheet() {
  // The tray menu can flip this too, so never trust the value from last time.
  window.pusher.system.getLoginItem().then((res) => {
    if (res.ok) setSwitch('opt-startup', res.value);
  });
  el.sheet.classList.remove('hidden');
}

$('open-settings').onclick = openSheet;
$('close-settings').onclick = () => el.sheet.classList.add('hidden');

onSwitch('opt-startup', (v) => window.pusher.system.setLoginItem(v));
onSwitch('opt-notifications', (v) => window.pusher.settings.set({ notifications: v }));
onSwitch('opt-confirm-force', (v) => window.pusher.settings.set({ confirmForcePush: v }));
onSwitch('opt-panel-launch', (v) => window.pusher.settings.set({ panelOnLaunch: v }));
onSwitch('opt-optout', (v) => window.pusher.account.setLeaderboardOptOut(v));

$('btn-check-updates').onclick = () => window.pusher.app.checkForUpdates();
$('btn-open-log').onclick = () => window.pusher.app.openLogFile();
$('btn-sign-out').onclick = async () => {
  await window.pusher.app.holdOpen(true);
  await window.pusher.account.signOut();
  await window.pusher.app.holdOpen(false);
  el.sheet.classList.add('hidden');
};
$('btn-quit').onclick = () => window.pusher.app.quit();

document.addEventListener('keydown', (event) => {
  if (event.key !== 'Escape') return;
  if (!el.sheet.classList.contains('hidden')) el.sheet.classList.add('hidden');
  else window.pusher.app.hide();
});

/* ---- boot ---- */

window.pusher.onHidden(() => el.sheet.classList.add('hidden'));
window.pusher.onState(render);
window.pusher.getState().then((res) => {
  if (res.ok) render(res.value);
});
window.pusher.app.getIcon().then((res) => {
  if (res.ok && res.value) $('logo').src = res.value;
});
// Relative timestamps and the link countdown are the only things that move on their own.
setInterval(() => {
  if (!state) return;
  renderActivity(state.activity);
  renderCountdown();
  renderHeartbeat();
}, 1000);
