'use strict';

const $ = (id) => document.getElementById(id);

const SITE = 'https://avtr.zip';
const MILESTONES = [10, 100, 1000, 10000, 100000];
/** Re-opening a tab refetches its first page once its data is older than this. */
const TAB_STALE_MS = 60 * 1000;

const el = {
  liveDot: $('live-dot'),
  liveText: $('live-text'),
  tabs: $('tabs'),
  tabCollected: $('tab-collected'),
  viewMain: $('view-main'),
  viewLink: $('view-link'),
  viewBoards: $('view-boards'),
  viewCollected: $('view-collected'),
  viewFame: $('view-fame'),
  banner: $('banner'),
  bannerLink: $('banner-link'),
  celebrate: $('celebrate'),
  displayName: $('display-name'),
  rankChip: $('rank-chip'),
  rewardChip: $('reward-chip'),
  creditTotal: $('credit-total'),
  rewardCard: $('reward-card'),
  rewardSub: $('reward-sub'),
  statPushTotal: $('stat-push-total'),
  statStreak: $('stat-streak'),
  statStreakK: $('stat-streak-k'),
  statLikes: $('stat-likes'),
  statShare: $('stat-share'),
  streakWarn: $('streak-warn'),
  rankWeek: $('rank-week'),
  rankMonth: $('rank-month'),
  rankAll: $('rank-all'),
  msText: $('ms-text'),
  msPct: $('ms-pct'),
  msBar: $('ms-bar'),
  msBadges: $('ms-badges'),
  statSeen: $('stat-seen'),
  statPushed: $('stat-pushed'),
  statCredited: $('stat-credited'),
  statQuota: $('stat-quota'),
  pendingLabel: $('pending-label'),
  activity: $('activity'),
  activityEmpty: $('activity-empty'),
  boardPeriod: $('board-period'),
  boardMode: $('board-mode'),
  boardNote: $('board-note'),
  boardReward: $('board-reward'),
  boardList: $('board-list'),
  boardEmpty: $('board-empty'),
  boardMe: $('board-me'),
  collectedCount: $('collected-count'),
  collectedGrid: $('collected-grid'),
  collectedEmpty: $('collected-empty'),
  fameList: $('fame-list'),
  fameEmpty: $('fame-empty'),
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

const ui = {
  tab: 'home',
  boardPeriod: 'week',
  boardMode: 'top',
  openProfile: null,
  /** vrchatUserId -> { loading, value, error } */
  profiles: new Map(),
  /** period -> { loading, value, error, at } */
  neighbors: {},
  /** Reset the boards when these change; the rows they show are wrong afterwards. */
  boardsKey: null
};

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

function full(n) {
  return typeof n === 'number' && Number.isFinite(n) ? n.toLocaleString('en-US') : '-';
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

/** "1d 22h", "3h 12m", "12m". Periods end on UTC boundaries; this is just the gap. */
function untilText(iso) {
  const ms = new Date(iso).getTime() - Date.now();
  if (!Number.isFinite(ms)) return '';
  if (ms <= 0) return 'now';
  const m = Math.max(1, Math.floor(ms / 60000));
  const d = Math.floor(m / 1440);
  const h = Math.floor((m % 1440) / 60);
  if (d > 0) return `${d}d ${h}h`;
  if (h > 0) return `${h}h ${m % 60}m`;
  return `${m}m`;
}

/** A span that the one-second tick keeps counting down. */
function until(iso) {
  const span = document.createElement('span');
  span.dataset.until = iso;
  span.textContent = untilText(iso);
  return span;
}

function percent(x, digits = 1) {
  if (typeof x !== 'number' || !Number.isFinite(x)) return '-';
  return (x * 100).toFixed(digits).replace(/\.0$/, '') + '%';
}

/** Award dates are plain YYYY-MM-DD in UTC; periodEnd is exclusive. */
function weekRange(startDate, endDate) {
  const opts = { month: 'short', day: 'numeric', timeZone: 'UTC' };
  const start = new Date(startDate + 'T00:00:00Z');
  const last = new Date(new Date(endDate + 'T00:00:00Z').getTime() - 86400000);
  if (Number.isNaN(start.getTime()) || Number.isNaN(last.getTime())) return startDate;
  return `${start.toLocaleDateString('en-US', opts)} - ${last.toLocaleDateString('en-US', opts)}`;
}

function monthYear(iso) {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return d.toLocaleDateString('en-US', { month: 'short', year: 'numeric', timeZone: 'UTC' });
}

/** Image URLs may be relative to the site. Anything that is not https is dropped. */
function imageUrl(u) {
  if (!u) return null;
  try {
    const url = new URL(u, SITE);
    return url.protocol === 'https:' ? url.href : null;
  } catch {
    return null;
  }
}

function make(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined && text !== null) node.textContent = text;
  return node;
}

function errorText(error) {
  if (!error) return 'Could not load.';
  return error.message || 'Could not load.';
}

/* ---- paging ---- */

/** One cursor-paged list. Every list on these endpoints pages the same way. */
class Pager {
  constructor(fetchPage) {
    this.fetchPage = fetchPage;
    this.gen = 0;
    this.reset();
  }

  reset() {
    this.gen++;
    this.items = [];
    this.cursor = null;
    this.hasMore = true;
    this.loading = false;
    this.error = null;
    this.loadedAt = 0;
    this.meta = null;
    this.stale = false;
  }

  isStale() {
    return !this.loadedAt || Date.now() - this.loadedAt > TAB_STALE_MS;
  }

  async more() {
    if (this.loading || !this.hasMore) return false;
    const gen = this.gen;
    this.loading = true;
    this.error = null;
    const res = await this.fetchPage(this.cursor);
    // A reset while this was in flight means these rows belong to an old list.
    if (gen !== this.gen) return false;
    this.loading = false;
    if (!res.ok) {
      this.error = res.error;
      return true;
    }
    const v = res.value || {};
    this.items.push(...(v.items || []));
    this.cursor = v.nextCursor || null;
    this.hasMore = !!v.hasMore && !!v.nextCursor;
    this.meta = v;
    this.stale = !!v.stale;
    if (!this.loadedAt) this.loadedAt = Date.now();
    return true;
  }
}

const boards = {
  week: new Pager((c) => window.pusher.stats.leaderboard('week', c)),
  month: new Pager((c) => window.pusher.stats.leaderboard('month', c)),
  all: new Pager((c) => window.pusher.stats.leaderboard('all', c))
};
const collected = new Pager((c) => window.pusher.stats.discoveries(c));
const fame = new Pager((c) => window.pusher.stats.awards(c));

/* ---- rendering: banners and link ---- */

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

/* ---- rendering: home ---- */

function renderActivity(items) {
  el.activityEmpty.classList.toggle('hidden', items.length > 0);
  el.activity.innerHTML = '';
  for (const item of items.slice(0, 25)) {
    const row = make('div', 'row');

    const id = make('span', 'id', shortId(item.avatarId));
    id.title = item.avatarId;

    const st = make('span', 'state ' + item.state, item.state);
    if (item.credited) st.title = 'Credited to you';

    const ago = make('span', 'ago', relativeTime(item.at));

    row.append(id, st, ago);
    el.activity.append(row);
  }
}

function renderCelebration(s) {
  const c = s.celebration;
  // A badge is news for a while, not forever.
  if (!c || Date.now() - c.at > 30 * 60 * 1000) {
    el.celebrate.hidden = true;
    return;
  }
  el.celebrate.hidden = false;
  el.celebrate.innerHTML = '';
  el.celebrate.append(make('span', null, `Badge unlocked: ${full(c.milestone)} discoveries.`));
  const btn = make('button', null, 'Dismiss');
  btn.onclick = () => window.pusher.stats.clearCelebration();
  el.celebrate.append(btn);
}

function renderReward(stats) {
  const active = stats && stats.awards && stats.awards.active;
  const holding = !!(active && active.active !== false);
  el.rewardChip.hidden = !holding;
  el.rewardCard.hidden = !holding;
  if (!holding) return;
  el.rewardSub.innerHTML = '';
  el.rewardSub.append(
    `#${active.rank} for ${weekRange(active.periodStart, active.periodEnd)} with ` +
    `${full(active.discoveries)} discoveries. In the avtr.zip world for `,
    until(active.endsAt),
    ' more.'
  );
}

const PERIOD_LABEL = { week: 'This week', month: 'This month', all: 'All time' };

function renderRankRow(target, period, r) {
  target.innerHTML = '';
  target.className = 'rank-row';
  // week and month are null while the period boards are down: hide the row.
  if (!r) {
    target.hidden = true;
    return;
  }
  target.hidden = false;

  const left = make('div', 'rr-left');
  const head = make('div', 'rr-label', PERIOD_LABEL[period]);
  if (r.periodEnd) {
    const reset = make('span', 'rr-reset', 'resets in ');
    reset.append(until(r.periodEnd));
    head.append(reset);
  }
  left.append(head);

  const sub = make('div', 'rr-sub');
  const parts = [];
  if (period !== 'all') parts.push(`${full(r.discoveries)} found`);
  if (r.rank === 1) parts.push('top of the board');
  else if (typeof r.toNext === 'number' && r.rank) parts.push(`${full(r.toNext)} to pass #${r.rank - 1}`);
  if (!r.rank) parts.push(period === 'all' ? 'discover something to get ranked' : 'no discoveries yet');
  sub.textContent = parts.join(', ');
  left.append(sub);

  if (period === 'week' && r.rank) {
    if (r.rank <= 3) {
      target.classList.add('zone');
      left.append(make('div', 'rr-zone', 'In the reward zone. Hold it to win VIP next week.'));
    } else if (r.rank === 4 && typeof r.toNext === 'number') {
      target.classList.add('near-zone');
      left.append(make('div', 'rr-zone', `${full(r.toNext)} more to reach the top 3.`));
    }
  }

  const right = make('div', 'rr-right');
  right.append(make('span', 'rr-rank', r.rank ? '#' + r.rank : '-'));
  if (r.rank && typeof r.participants === 'number') {
    right.append(make('span', 'rr-of', ` of ${full(r.participants)}`));
  }

  target.append(left, right);
}

function renderMilestones(ms, credit) {
  const reached = new Set((ms && ms.reached) || MILESTONES.filter((m) => credit >= m));
  const next = ms ? ms.next : MILESTONES.find((m) => credit < m) ?? null;
  const progress = ms && typeof ms.progress === 'number' ? ms.progress : null;

  if (next) {
    el.msText.textContent = `Next badge: ${full(next)} discoveries`;
    el.msPct.textContent = progress === null ? '' : percent(progress, 0);
    el.msBar.style.width = progress === null ? '0%' : Math.max(0, Math.min(100, progress * 100)) + '%';
  } else {
    el.msText.textContent = 'Every badge earned';
    el.msPct.textContent = '';
    el.msBar.style.width = '100%';
  }

  el.msBadges.innerHTML = '';
  for (const m of MILESTONES) {
    const badge = make('span', 'badge' + (reached.has(m) ? ' on' : ''), compact(m));
    badge.title = `${full(m)} discoveries${reached.has(m) ? ', reached' : ''}`;
    el.msBadges.append(badge);
  }
}

function renderHome(s) {
  const identity = s.identity || {};
  const stats = s.stats || {};

  el.displayName.textContent = identity.displayName || 'Anonymous';
  el.creditTotal.textContent = compact(identity.credit || 0);
  el.creditTotal.title = full(identity.credit || 0);
  el.rankChip.hidden = !identity.rank;
  if (identity.rank) el.rankChip.textContent = `#${identity.rank} all time`;

  renderCelebration(s);
  renderReward(stats);

  el.statPushTotal.textContent = typeof identity.pushCount === 'number' ? compact(identity.pushCount) : '-';
  el.statPushTotal.title = typeof identity.pushCount === 'number' ? full(identity.pushCount) : '';

  const streak = stats.streak;
  el.statStreak.textContent = streak ? `${streak.current}d` : '-';
  el.statStreakK.textContent = streak && streak.best ? `Streak, best ${streak.best}` : 'Day streak';

  const impact = stats.impact;
  el.statLikes.textContent = impact ? compact(impact.likesReceived) : '-';
  el.statShare.textContent = impact ? percent(impact.weekShare) : '-';

  if (streak && streak.current > 0 && !streak.activeToday) {
    el.streakWarn.hidden = false;
    el.streakWarn.innerHTML = '';
    // Streak days end at 00:00 UTC, which is the next day boundary from now.
    const midnight = new Date();
    midnight.setUTCHours(24, 0, 0, 0);
    // Banners are flex rows, so the sentence needs one wrapper to flow as text.
    const text = make('span');
    text.append(
      'Find one new avatar in the next ',
      until(midnight.toISOString()),
      ` to keep your ${streak.current}-day streak.`
    );
    el.streakWarn.append(text);
  } else {
    el.streakWarn.hidden = true;
  }

  const ranks = stats.ranks || {};
  renderRankRow(el.rankWeek, 'week', ranks.week);
  renderRankRow(el.rankMonth, 'month', ranks.month);
  // Before the first /me answer, fall back to what the push responses told us.
  renderRankRow(el.rankAll, 'all', ranks.all || (identity.rank ? { rank: identity.rank } : null));

  renderMilestones(stats.milestones, identity.credit || 0);

  el.statSeen.textContent = compact(s.session.seen);
  el.statPushed.textContent = compact(s.session.pushed);
  el.statCredited.textContent = compact(s.session.credited);
  el.statQuota.textContent = s.quota ? compact(s.quota.remaining) : '-';

  el.pendingLabel.textContent = s.pending ? s.pending + ' queued' : '';

  renderActivity(s.activity);
}

/* ---- rendering: boards ---- */

function linked() {
  return !!state && state.mode === 'linked';
}

function myId() {
  return (state && state.identity && state.identity.vrchatUserId) || null;
}

function boardRow(entry, { isMe = false, period }) {
  const row = make('div', 'lb-row');
  if (isMe) row.classList.add('me');
  if (period === 'week' && entry.rank <= 3) row.classList.add('r' + entry.rank);

  const anonymous = !entry.displayName;
  row.append(make('span', 'rank', String(entry.rank ?? '-')));
  const name = make('span', 'nm' + (anonymous ? ' anon' : ''), anonymous ? 'Anonymous pusher' : entry.displayName);
  if (isMe) name.append(make('span', 'you', ' you'));
  row.append(name);
  row.append(make('span', 'ct', full(entry.discoveries ?? 0)));

  if (entry.vrchatUserId && !anonymous) {
    row.classList.add('tap');
    row.title = 'Show profile';
    row.onclick = () => toggleProfile(entry.vrchatUserId);
  }

  const wrap = document.createDocumentFragment();
  wrap.append(row);
  if (entry.vrchatUserId && ui.openProfile === entry.vrchatUserId) wrap.append(profileBox(entry.vrchatUserId));
  return wrap;
}

function profileBox(vrchatUserId) {
  const box = make('div', 'profile');
  const p = ui.profiles.get(vrchatUserId);
  if (!p || p.loading) {
    box.textContent = 'Loading...';
  } else if (p.error) {
    box.textContent = p.error.code === 'not_found' ? 'This profile is not available.' : errorText(p.error);
  } else {
    const v = (p.value && p.value.pusher) || {};
    const bits = [];
    if (v.rank) bits.push(`#${v.rank} all time`);
    bits.push(`${full(v.discoveries ?? 0)} discoveries`);
    if (v.linkedAt) bits.push(`pushing since ${monthYear(v.linkedAt)}`);
    box.textContent = bits.join(', ');
  }
  return box;
}

async function toggleProfile(vrchatUserId) {
  if (ui.openProfile === vrchatUserId) {
    ui.openProfile = null;
    renderBoards();
    return;
  }
  ui.openProfile = vrchatUserId;
  const known = ui.profiles.get(vrchatUserId);
  if (!known || known.error) {
    ui.profiles.set(vrchatUserId, { loading: true });
    renderBoards();
    const res = await window.pusher.stats.profile(vrchatUserId);
    ui.profiles.set(vrchatUserId, res.ok ? { value: res.value } : { error: res.error });
  }
  renderBoards();
}

function renderBoardNote(meta) {
  el.boardNote.innerHTML = '';
  const period = ui.boardPeriod;
  el.boardReward.hidden = period !== 'week';
  if (period === 'all') {
    el.boardNote.textContent = 'First finds only.';
    return;
  }
  const end = (meta && meta.periodEnd) || state?.stats?.ranks?.[period]?.periodEnd;
  if (end) el.boardNote.append('Resets in ', until(end));
}

function renderPinned() {
  const period = ui.boardPeriod;
  const mine = linked() && state.stats && state.stats.ranks && state.stats.ranks[period];
  // Only pin when the real row is not already on screen.
  const shown = ui.boardMode === 'near' ||
    boards[period].items.some((e) => e.vrchatUserId && e.vrchatUserId === myId());
  if (!mine || !mine.rank || shown) {
    el.boardMe.hidden = true;
    return;
  }
  el.boardMe.hidden = false;
  el.boardMe.innerHTML = '';
  const row = make('div', 'lb-row me');
  row.append(make('span', 'rank', String(mine.rank)));
  const name = make('span', 'nm', state.identity?.displayName || 'You');
  name.append(make('span', 'you', ' you'));
  row.append(name, make('span', 'ct', full(mine.discoveries ?? state.identity?.credit ?? 0)));
  el.boardMe.append(row);
}

function renderBoards() {
  const period = ui.boardPeriod;
  for (const b of el.boardPeriod.querySelectorAll('button')) b.classList.toggle('on', b.dataset.period === period);
  for (const b of el.boardMode.querySelectorAll('button')) b.classList.toggle('on', b.dataset.mode === ui.boardMode);
  el.boardMode.hidden = !linked();

  el.boardList.innerHTML = '';
  const me = myId();

  if (ui.boardMode === 'near' && linked()) {
    const nb = ui.neighbors[period];
    renderBoardNote(null);
    const items = (nb && nb.value && nb.value.items) || [];
    for (const entry of items) el.boardList.append(boardRow(entry, { isMe: !!entry.isMe, period }));
    el.boardEmpty.classList.toggle('hidden', items.length > 0);
    if (!items.length) {
      if (!nb || nb.loading) el.boardEmpty.textContent = 'Loading...';
      else if (nb.error) el.boardEmpty.textContent = errorText(nb.error);
      else el.boardEmpty.textContent = period === 'all'
        ? 'You are not ranked yet. Discover an avatar to join the board.'
        : `You have no discoveries ${period === 'week' ? 'this week' : 'this month'} yet.`;
    }
    renderPinned();
    return;
  }

  const pager = boards[period];
  renderBoardNote(pager.meta);
  for (const entry of pager.items) {
    el.boardList.append(boardRow(entry, { isMe: !!me && entry.vrchatUserId === me, period }));
  }

  const showFooter = !pager.items.length || pager.loading || pager.error || pager.stale;
  el.boardEmpty.classList.toggle('hidden', !showFooter);
  if (pager.error) el.boardEmpty.textContent = errorText(pager.error);
  else if (pager.loading) el.boardEmpty.textContent = 'Loading...';
  else if (pager.stale) el.boardEmpty.textContent = 'Showing saved results. avtr.zip did not answer.';
  else if (!pager.items.length) el.boardEmpty.textContent = 'Nobody has discovered anything yet. Be first.';

  renderPinned();
}

async function loadBoard(period, { reset = false } = {}) {
  const pager = boards[period];
  if (reset) pager.reset();
  const p = pager.more();
  renderBoards();
  if (await p) renderBoards();
}

async function loadNeighbors(period) {
  const known = ui.neighbors[period];
  if (known && known.loading) return;
  if (known && !known.error && Date.now() - known.at < 30 * 1000) return;
  ui.neighbors[period] = { loading: true, value: known && known.value };
  renderBoards();
  const res = await window.pusher.stats.neighbors(period);
  ui.neighbors[period] = res.ok
    ? { value: res.value, at: Date.now() }
    : { error: res.error, value: known && known.value, at: Date.now() };
  renderBoards();
}

function openBoards() {
  const period = ui.boardPeriod;
  if (ui.boardMode === 'near' && linked()) void loadNeighbors(period);
  else if (boards[period].isStale()) void loadBoard(period, { reset: true });
  else renderBoards();
}

/* ---- rendering: collected ---- */

function tile(item) {
  if (!item.listed) {
    const t = make('div', 'tile gone');
    t.append(make('span', 'tile-ph', 'hidden avatar'));
    t.title = 'No longer public. It still counts for you.';
    return t;
  }

  const t = make('button', 'tile');
  t.title = item.authorName ? `${item.name || 'Avatar'} by ${item.authorName}` : item.name || item.avatarId;
  t.onclick = () => window.pusher.app.openAvatar(item.avatarId);

  const src = imageUrl(item.image && (item.image.thumb || item.image.medium));
  if (src) {
    const img = document.createElement('img');
    img.loading = 'lazy';
    img.decoding = 'async';
    img.alt = '';
    img.src = src;
    img.onerror = () => {
      img.remove();
      t.classList.add('noimg');
    };
    t.append(img);
  } else {
    t.classList.add('noimg');
  }

  const cap = make('span', 'tile-cap');
  cap.append(make('span', 'tile-name', item.name || 'Untitled'));
  if (typeof item.likeCount === 'number' && item.likeCount > 0) {
    cap.append(make('span', 'tile-likes', compact(item.likeCount)));
  }
  t.append(cap);
  return t;
}

let collectedRendered = 0;

function renderCollected({ rebuild = false } = {}) {
  const credit = state && state.identity && state.identity.credit;
  el.collectedCount.textContent = typeof credit === 'number' ? `${full(credit)} found` : '';

  // Append only the new tiles, so images already on screen are not reloaded.
  if (rebuild || collectedRendered > collected.items.length) {
    el.collectedGrid.innerHTML = '';
    collectedRendered = 0;
  }
  for (const item of collected.items.slice(collectedRendered)) el.collectedGrid.append(tile(item));
  collectedRendered = collected.items.length;

  const showFooter = !collected.items.length || collected.loading || collected.error;
  el.collectedEmpty.classList.toggle('hidden', !showFooter);
  if (collected.error) el.collectedEmpty.textContent = errorText(collected.error);
  else if (collected.loading) el.collectedEmpty.textContent = 'Loading...';
  else if (!collected.items.length) {
    el.collectedEmpty.textContent = 'Nothing yet. Avatars you find first show up here.';
  }
}

async function loadCollected({ reset = false } = {}) {
  if (reset) collected.reset();
  const p = collected.more();
  renderCollected({ rebuild: reset });
  if (await p) renderCollected();
}

/* ---- rendering: hall of fame ---- */

const MEDAL = { 1: 'gold', 2: 'silver', 3: 'bronze' };

function renderFame() {
  el.fameList.innerHTML = '';
  const me = myId();
  for (const week of fame.items) {
    const card = make('section', 'card fame-week');
    card.append(make('div', 'label', weekRange(week.periodStart, week.periodEnd)));
    const winners = week.winners || [];
    if (!winners.length) card.append(make('div', 'empty', 'No public winners this week.'));
    for (const w of winners) {
      const row = make('div', 'lb-row ' + (MEDAL[w.rank] || ''));
      if (me && w.vrchatUserId === me) row.classList.add('me');
      row.append(make('span', 'rank medal', String(w.rank)));
      const name = make('span', 'nm', w.displayName || 'Anonymous pusher');
      if (me && w.vrchatUserId === me) name.append(make('span', 'you', ' you'));
      row.append(name, make('span', 'ct', full(w.discoveries)));
      card.append(row);
    }
    el.fameList.append(card);
  }

  const showFooter = !fame.items.length || fame.loading || fame.error;
  el.fameEmpty.classList.toggle('hidden', !showFooter);
  if (fame.error) el.fameEmpty.textContent = errorText(fame.error);
  else if (fame.loading) el.fameEmpty.textContent = 'Loading...';
  else if (!fame.items.length) el.fameEmpty.textContent = 'No weeks have closed yet. The first winners are crowned on Monday.';
}

async function loadFame({ reset = false } = {}) {
  if (reset) fame.reset();
  const p = fame.more();
  renderFame();
  if (await p) renderFame();
}

/* ---- tabs ---- */

const VIEWS = {
  home: () => (linked() ? el.viewMain : el.viewLink),
  boards: () => el.viewBoards,
  collected: () => el.viewCollected,
  fame: () => el.viewFame
};

function showTab(name) {
  if (name === 'collected' && !linked()) name = 'home';
  ui.tab = name;
  for (const b of el.tabs.querySelectorAll('.tab')) b.classList.toggle('on', b.dataset.tab === name);

  const active = VIEWS[name]();
  for (const v of [el.viewMain, el.viewLink, el.viewBoards, el.viewCollected, el.viewFame]) {
    v.classList.toggle('hidden', v !== active);
  }

  if (name === 'boards') openBoards();
  else if (name === 'collected') {
    if (collected.isStale()) void loadCollected({ reset: true });
    else renderCollected();
  } else if (name === 'fame') {
    if (fame.isStale()) void loadFame({ reset: true });
    else renderFame();
  }
}

for (const b of el.tabs.querySelectorAll('.tab')) b.onclick = () => showTab(b.dataset.tab);

for (const b of el.boardPeriod.querySelectorAll('button')) {
  b.onclick = () => {
    ui.boardPeriod = b.dataset.period;
    ui.openProfile = null;
    el.viewBoards.scrollTop = 0;
    openBoards();
  };
}
for (const b of el.boardMode.querySelectorAll('button')) {
  b.onclick = () => {
    ui.boardMode = b.dataset.mode;
    ui.openProfile = null;
    el.viewBoards.scrollTop = 0;
    openBoards();
  };
}

/** Infinite scroll: fetch the next page as the bottom comes into view. */
function onNearBottom(view, fn) {
  view.addEventListener('scroll', () => {
    if (view.scrollTop + view.clientHeight >= view.scrollHeight - 160) fn();
  }, { passive: true });
}

onNearBottom(el.viewBoards, () => {
  const pager = boards[ui.boardPeriod];
  if (ui.boardMode === 'top' && pager.hasMore && !pager.loading && !pager.error) void loadBoard(ui.boardPeriod);
});
onNearBottom(el.viewCollected, () => {
  if (collected.hasMore && !collected.loading && !collected.error) void loadCollected();
});
onNearBottom(el.viewFame, () => {
  if (fame.hasMore && !fame.loading && !fame.error) void loadFame();
});

// A failed page shows its error in the footer; clicking it retries.
el.boardEmpty.onclick = () => {
  if (ui.boardMode === 'near') {
    if (ui.neighbors[ui.boardPeriod]?.error) {
      ui.neighbors[ui.boardPeriod] = null;
      void loadNeighbors(ui.boardPeriod);
    }
  } else if (boards[ui.boardPeriod].error) void loadBoard(ui.boardPeriod);
};
el.collectedEmpty.onclick = () => { if (collected.error) void loadCollected(); };
el.fameEmpty.onclick = () => { if (fame.error) void loadFame(); };

/* ---- top-level render ---- */

function render(next) {
  state = next;
  const isLinked = linked();

  // Who is looking, and whether their name is shown, changes what the boards contain.
  const key = `${state.mode}|${myId()}|${!!state.identity?.leaderboardOptOut}`;
  if (ui.boardsKey !== null && ui.boardsKey !== key) {
    for (const p of Object.values(boards)) p.reset();
    ui.neighbors = {};
    collected.reset();
    collectedRendered = 0;
    el.collectedGrid.innerHTML = '';
    if (ui.tab === 'boards') openBoards();
  }
  ui.boardsKey = key;

  el.tabCollected.hidden = !isLinked;
  if (!isLinked && ui.boardMode === 'near') ui.boardMode = 'top';
  if (ui.tab === 'collected' && !isLinked) showTab('home');
  else if (ui.tab === 'home') showTab('home');

  el.liveDot.classList.toggle('on', state.vrchat.running);
  el.liveText.textContent = state.vrchat.running ? 'VRChat' : 'idle';

  renderBanner(el.banner, state);
  renderBanner(el.bannerLink, state);

  if (isLinked) renderHome(state);
  else renderActivity(state.activity);
  renderLink(state);
  renderCountdown();
  renderHeartbeat();
  if (ui.tab === 'boards') renderPinned();

  // settings sheet
  const identity = state.identity || {};
  el.versionLabel.textContent = 'v' + state.version;
  setSwitch('opt-notifications', state.settings.notifications);
  setSwitch('opt-confirm-force', state.settings.confirmForcePush);
  setSwitch('opt-panel-launch', state.settings.panelOnLaunch);
  setSwitch('opt-optout', !!identity.leaderboardOptOut);
  el.optOutRow.classList.toggle('hidden', !isLinked);
  el.signOut.classList.toggle('hidden', !isLinked);
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
// Relative timestamps, the link countdown and the period countdowns move on their own.
setInterval(() => {
  if (!state) return;
  renderActivity(state.activity);
  renderCountdown();
  renderHeartbeat();
  for (const node of document.querySelectorAll('[data-until]')) {
    node.textContent = untilText(node.dataset.until);
  }
}, 1000);
