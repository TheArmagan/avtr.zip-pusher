<!--
  Written for whoever builds the pusher app's stats, leaderboard and rewards
  screens, with no other context. It repeats constraints rather than pointing
  at them, on purpose: an app author should not have to read the server.

  Companion to pusher-desktop-protocol.md, which covers linking, the token,
  pushing and the heartbeat. This page covers everything the app can SHOW.

  Sources:
    backend-v3/src/server/routes/pusher.ts       every endpoint and code
    backend-v3/src/modules/pusher/periods.ts     weekly and monthly boards
    backend-v3/src/modules/pusher/progress.ts    push count, streak, milestones
    backend-v3/src/modules/pusher/discoveries.ts the "collected" feed
    backend-v3/src/modules/pusher/awards.ts      rewards and the hall of fame
    backend-v3/src/jobs/pusherAwards.ts          when rewards are granted
    backend-v3/src/modules/world/awards.ts       how rewards reach the world

  Keep this page in step with those files: change one, change this.
  Last audited: 2026-11-07
-->

# Pusher app: stats, leaderboards and rewards API

Base URL `https://avtr.zip`. Every endpoint here is under `/v3/pusher`.

## 1. What changed and why

The app used to be able to show one number (all-time discoveries) and one rank.
It can now show a person everything they have done and give them reasons to
keep the app running:

| Feature | What the person sees |
|---|---|
| **Total pushed** | Every avatar they sent that we could act on, refreshes included. Grows every push. |
| **Discoveries** | Avatars they were the FIRST to find. This is what every leaderboard ranks on. |
| **Weekly board** | Rank this week (Monday 00:00 UTC to next Monday). Resets every week. |
| **Monthly board** | Rank this month (1st 00:00 UTC to next 1st). |
| **All-time board** | The existing board. |
| **Rank context** | "12 more to pass #4", plus the people just above and below. |
| **Collected** | A scrollable grid of the avatars they discovered, newest first. |
| **Streak** | Consecutive UTC days with at least one discovery, and their best ever. |
| **Milestones** | Badges at 10, 100, 1,000, 10,000 and 100,000 discoveries, with progress to the next. |
| **Impact** | Total likes the avatars they discovered have received, and their share of this week's discoveries. |
| **Weekly reward** | The top 3 discoverers of each week get **VIP** and the **`~ top contributor ~`** flair in the avtr.zip VRChat world for the whole following week. |
| **Hall of fame** | Every past week's top 3. |

**Why rank on discoveries and not total pushed?** Pushing an avatar we already
have is free to repeat; a board ranked on it would reward leaving a script
running on the same avatars. Discoveries can only be earned once per avatar,
ever, by one person. Show total pushed as a personal stat, never as a ranking.

## 2. Auth, errors and limits (recap)

- Personal endpoints (`/me...`) take `Authorization: Bearer avzp_...`, the token
  from the link flow. A browser signed in with the linked account also works.
- Public endpoints (`/leaderboard`, `/awards`, `/u/:id`) need no auth.
- Every error has the shape `{ "success": false, "error": "<human text>", "code": "<machine code>" }`.

| HTTP | `code` | Meaning | What to do |
|---|---|---|---|
| 400 | `invalid_period` | `period` was not `all`, `week` or `month` | Fix the client |
| 401 | `invalid_token` | Token missing, wrong, revoked or the account erased | Discard the token, re-link |
| 404 | `not_found` | Profile hidden or gone | Show "not available" |
| 429 | `rate_limited` | Too many reads | Wait `Retry-After` seconds (also in `retryAfterSeconds`) |
| 503 | `unavailable` | A dependency is down | Retry later; show cached data |

**Rate limit:** every endpoint on this page shares one budget of **60 requests
per minute per IP address** (scope `pusher_read`). A dashboard refresh that
loads `/me`, `/me/neighbors` and one leaderboard page is 3 requests, so
refreshing every 60 seconds uses 5% of it. Do not refresh faster than every
10 seconds.

All timestamps are ISO 8601 UTC strings. All period boundaries are UTC.

## 3. Endpoints

### 3.1 `POST /v3/pusher/push`: one new field

Unchanged except `credit.pushCount`:

```jsonc
"credit": { "granted": 2, "total": 4129, "rank": 12, "pushCount": 18240 }
```

| Field | Meaning |
|---|---|
| `granted` | Discoveries credited by THIS request |
| `total` | All-time discoveries after this request |
| `rank` | All-time rank (see 4.3 on lag), null if unranked |
| `pushCount` | Total pushed after this request |

Update the dashboard's discovery and push counters straight from this; there is
no need to re-read `/me` for those two numbers.

What counts toward `pushCount`: results whose `state` is `new`, `refreshed` or
`skipped`. `missing`, `forbidden` and `unsupported` do not count.

### 3.2 `GET /v3/pusher/me`: the dashboard

```http
GET /v3/pusher/me
Authorization: Bearer avzp_...
```

```jsonc
200 {
  "success": true,
  "pusher": {
    "vrchatUserId": "usr_...",
    "displayName": "Kira",
    "discoveryCount": 4129,
    "pushCount": 18240,
    "rank": 12,
    "leaderboardOptOut": false,
    "createdAt": "2026-08-30T19:02:11.000Z",
    "tokens": [
      { "id": "...", "label": "desktop pusher", "hint": "avzp_...3f9a", "createdAt": "...", "lastUsedAt": "..." }
    ],

    "ranks": {
      "all":   { "rank": 12, "discoveries": 4129, "participants": null, "toNext": 37 },
      "week":  { "rank": 3,  "discoveries": 211,  "participants": 48, "toNext": 12,
                 "periodStart": "2026-11-02T00:00:00.000Z", "periodEnd": "2026-11-09T00:00:00.000Z" },
      "month": { "rank": 5,  "discoveries": 302,  "participants": 77, "toNext": 4,
                 "periodStart": "2026-11-01T00:00:00.000Z", "periodEnd": "2026-12-01T00:00:00.000Z" }
    },
    "streak":     { "current": 6, "best": 19, "activeToday": true },
    "milestones": { "reached": [10, 100, 1000], "next": 10000, "progress": 0.3477 },
    "impact":     { "likesReceived": 912, "weekShare": 0.083 },
    "awards": {
      "active": {
        "periodKind": "week", "periodStart": "2026-10-26", "periodEnd": "2026-11-02",
        "rank": 2, "discoveries": 340, "displayName": "Kira",
        "startsAt": "2026-11-02T00:04:12.000Z", "endsAt": "2026-11-09T00:00:00.000Z",
        "active": true
      },
      "history": [ /* the same shape, newest first, at most 10 */ ]
    }
  }
}
```

Field by field:

| Field | Meaning | Null when |
|---|---|---|
| `discoveryCount` | All-time discoveries | never (0) |
| `pushCount` | All-time total pushed. Counting started 2026-11-07; earlier pushes were not recorded, so for older accounts it starts at their discovery count | never (0) |
| `rank` | Same as `ranks.all.rank` (kept for old clients) | no discoveries yet |
| `ranks.<p>.rank` | Position on that board, 1 is best | no discoveries in that period |
| `ranks.<p>.discoveries` | Discoveries within that period | never (0) |
| `ranks.<p>.participants` | How many people are ranked in that period ("#3 of 48") | always null for `all` |
| `ranks.<p>.toNext` | Discoveries needed to pass the person directly above | rank is 1, or unranked |
| `ranks.week` / `ranks.month` | The whole object | the period boards are temporarily unavailable; hide the card |
| `periodStart` / `periodEnd` | The period window, end exclusive. Use `periodEnd` for a "resets in 2d 4h" countdown | |
| `streak.current` | Consecutive UTC days with at least one discovery, ending today or yesterday | never (0) |
| `streak.best` | Longest streak ever | never (0) |
| `streak.activeToday` | Whether today already counts. If `false` and `current > 0`, the streak ends at 00:00 UTC unless they discover something: a good moment for a "keep your 6-day streak" hint | |
| `milestones.reached` | Thresholds reached, ascending | never ([]) |
| `milestones.next` | The next threshold | all five reached |
| `milestones.progress` | 0 to 1, measured from the last reached threshold to `next`, for a progress bar | |
| `impact.likesReceived` | Sum of likes on every avatar they discovered | never (0) |
| `impact.weekShare` | Their share (0 to 1) of all discoveries credited to linked pushers this week | never (0) |
| `awards.active` | The reward they hold right now | none held |
| `awards.history` | Their last 10 rewards, newest first, `active` set on each | never ([]) |

### 3.3 `GET /v3/pusher/me/neighbors`: who is around me

```http
GET /v3/pusher/me/neighbors?period=week&span=3
Authorization: Bearer avzp_...
```

| Param | Values | Default |
|---|---|---|
| `period` | `all`, `week`, `month` | `all` |
| `span` | rows above AND below, 1 to 10 | 3 |

```jsonc
200 {
  "success": true,
  "period": "week",
  "items": [
    { "rank": 1, "vrchatUserId": "usr_...", "displayName": "Ash",  "discoveries": 400, "isMe": false },
    { "rank": 2, "vrchatUserId": null,      "displayName": null,   "discoveries": 222, "isMe": false },
    { "rank": 3, "vrchatUserId": "usr_...", "displayName": "Kira", "discoveries": 211, "isMe": true  },
    { "rank": 4, "vrchatUserId": "usr_...", "displayName": "Bo",   "discoveries": 190, "isMe": false }
  ]
}
```

- `items` is empty when the caller is unranked on that board.
- A null `displayName` is somebody who opted out of the board. Show them as
  "Anonymous pusher": they still occupy the rank, the numbers stay contiguous.
- The caller's own row is always named, even if the caller opted out.
- 503 `unavailable` for `week`/`month` if the period boards are down.

### 3.4 `GET /v3/pusher/me/discoveries`: what I collected

```http
GET /v3/pusher/me/discoveries?limit=30&cursor=
Authorization: Bearer avzp_...
```

| Param | Values | Default |
|---|---|---|
| `limit` | 1 to 100 | 30 |
| `cursor` | the previous page's `nextCursor` | first page |

```jsonc
200 {
  "success": true,
  "items": [
    {
      "avatarId": "avtr_...",
      "discoveredAt": "2026-11-07T12:01:33.120Z",
      "listed": true,
      "name": "Neon Fox",
      "authorId": "usr_...",
      "authorName": "SomeCreator",
      "image": { "thumb": "https://.../i/file_.../3/256", "medium": "https://.../i/file_.../3/512" },
      "likeCount": 14
    },
    {
      "avatarId": "avtr_...",
      "discoveredAt": "2026-11-07T11:58:02.004Z",
      "listed": false,
      "name": null, "authorId": null, "authorName": null, "image": null, "likeCount": null
    }
  ],
  "nextCursor": "2026-11-07T11:58:02.004Z|avtr_...",
  "hasMore": true
}
```

- Newest first. Page with `nextCursor` until `hasMore` is false. Treat the
  cursor as opaque.
- `listed: false` means the avatar is not shown publicly any more (the author
  blocked it, it went private, or it was deleted). The discovery still counts
  for them; the details are withheld. Render a placeholder tile ("hidden
  avatar"), and do not try to look it up elsewhere.
- `image` URLs may be absolute or relative (`/i/...`). Resolve a relative URL
  against `https://avtr.zip`. They are immutable and safe to cache forever.
- To open an avatar's page: `https://avtr.zip/avatars/<avatarId>`.

### 3.5 `GET /v3/pusher/leaderboard`: the boards (public)

```http
GET /v3/pusher/leaderboard?period=week&limit=50&cursor=
```

| Param | Values | Default |
|---|---|---|
| `period` | `all`, `week`, `month` | `all` (exactly the old behaviour) |
| `limit` | 1 to 100 | 50 |
| `cursor` | the previous page's `nextCursor` | first page |

```jsonc
200 {
  "success": true,
  "period": "week",
  "items": [
    { "rank": 1, "vrchatUserId": "usr_...", "displayName": "Ash",  "discoveries": 400 },
    { "rank": 3, "vrchatUserId": "usr_...", "displayName": "Kira", "discoveries": 211 }
  ],
  "nextCursor": "211|<id>",
  "hasMore": true,
  "periodStart": "2026-11-02T00:00:00.000Z",   // week and month only
  "periodEnd":   "2026-11-09T00:00:00.000Z"    // week and month only
}
```

- Ranks can skip (2 is missing above): somebody opted out. That is expected;
  do not renumber.
- Ties are ordered deterministically and get distinct ranks.
- There is no total count and no page numbers, by design. Use `participants`
  from `/me` when you need "of N".
- To pin the user's own row at the bottom of the list, use `ranks.<period>`
  from `/me` rather than paging until you find them.

### 3.6 `GET /v3/pusher/awards`: hall of fame (public)

```http
GET /v3/pusher/awards?limit=10&cursor=
```

| Param | Values | Default |
|---|---|---|
| `limit` | weeks per page, 1 to 26 | 10 |
| `cursor` | the previous page's `nextCursor` (a date) | newest |

```jsonc
200 {
  "success": true,
  "items": [
    {
      "periodStart": "2026-10-26",
      "periodEnd": "2026-11-02",
      "winners": [
        { "rank": 1, "vrchatUserId": "usr_...", "displayName": "Ash",  "discoveries": 512 },
        { "rank": 2, "vrchatUserId": "usr_...", "displayName": "Kira", "discoveries": 340 },
        { "rank": 3, "vrchatUserId": "usr_...", "displayName": "Bo",   "discoveries": 301 }
      ]
    }
  ],
  "nextCursor": "2026-10-26",
  "hasMore": true
}
```

- Newest week first. `periodEnd` is exclusive (the Monday the week closed).
- `displayName` is the name at the time of the award.
- A week can show fewer than 3 winners: a winner who later opted out or erased
  their account is left off the public page.

### 3.7 `GET /v3/pusher/u/:vrchatUserId`: someone's public profile

Unchanged: `{ success, pusher: { rank, vrchatUserId, displayName, discoveries, linkedAt } }`,
404 if they opted out or erased. Use it when somebody taps a leaderboard row.

## 4. Semantics the UI must get right

### 4.1 Periods are UTC

A week is Monday 00:00 UTC to the next Monday 00:00 UTC. A month is the 1st
00:00 UTC to the next 1st. Show the reset as a countdown to `periodEnd`, or
convert it to local time; never assume the user's local Monday.

### 4.2 Streaks are UTC days too

A day "counts" when at least one push in it was a discovery (`credit.granted > 0`).
Refresh-only days do not count. The streak survives until the end of the next
UTC day, so a streak whose last day was yesterday is still alive (`current > 0`,
`activeToday: false`).

### 4.3 How fresh each number is

| Number | Lag |
|---|---|
| `discoveryCount`, `pushCount`, `credit.*` | live |
| streak | live |
| weekly and monthly ranks | up to 60 seconds |
| all-time `rank` and `ranks.all` | up to 1 hour (recomputed hourly) |
| `impact.likesReceived` | up to 1 hour |
| rewards appearing in the world | up to 1 hour after Monday 00:00 UTC |

So right after a big push the weekly rank can move before the all-time rank
does. That is expected; do not "correct" it client side.

### 4.4 Opting out

`PATCH /v3/pusher/me { "leaderboardOptOut": true }` hides the person from every
public board, neighbour list and the hall of fame. They still see their own
ranks in `/me` (they keep their position). **An opted-out person cannot win the
weekly reward**, because the reward shows their name in the world; if they
opt out while holding one, it is removed from the world within the hour. Say
this next to the toggle: "Opting out also makes you ineligible for the weekly
top 3 reward."

### 4.5 The weekly reward

- **Who:** the top 3 discoverers of the closed week, skipping anyone opted out,
  banned, or jailed in the world. The next person moves up into the slot.
- **When:** granted within an hour after Monday 00:00 UTC.
- **For how long:** until the following Monday 00:00 UTC (`endsAt`).
- **What:** VIP in the avtr.zip world, and the flair text **`~ top contributor ~`**
  in colour **`#F5C542`** (gold). Someone who already has a custom flair from
  the world staff keeps theirs and gets only the VIP.
- **Matching is by VRChat display name.** The reward follows a rename within
  the hour, but a player on a very old world build may not see it (old builds
  read an old config).
- Suggested copy: "Top 3 this week get VIP and the ~ top contributor ~ flair in
  the avtr.zip world all next week. You are #3, 12 discoveries ahead of #4."

## 5. Polling guidance

- After a push with `credit.granted > 0`, update counters from the push
  response, and re-read `/me` at most once per 30 seconds to pick up rank moves.
- Otherwise refresh `/me` no more than once per 60 seconds while the dashboard
  is visible, and not at all while minimised.
- Cache leaderboard pages for 60 seconds; the server does the same.
- The hall of fame changes once a week; cache it for an hour.
- On 429, stop and wait `Retry-After`. On 503, keep showing cached data.

## 6. Suggested UI

**Dashboard (from `/me`)**

```
+---------------------------------------------------------------+
|  Kira                                     [REWARD] VIP + flair |
|                                           ends in 1d 22h       |
+---------------+---------------+---------------+---------------+
| Total pushed  | Discoveries   | Streak        | Likes earned  |
| 18,240        | 4,129         | 6 days (19)   | 912           |
+---------------+---------------+---------------+---------------+
| This week   #3 of 48   12 to pass #2     resets in 1d 22h      |
| This month  #5 of 77    4 to pass #4                           |
| All time    #12        37 to pass #11                          |
+---------------------------------------------------------------+
| Next badge: 10,000 discoveries  [######-----------]  35%       |
| You found 8.3% of everything discovered this week              |
+---------------------------------------------------------------+
```

- Highlight the weekly card when `ranks.week.rank <= 3` ("you are in the reward
  zone") or when `toNext` is small and rank is 4 ("12 more to reach the top 3").
- Show a streak warning when `streak.current > 0 && !streak.activeToday`.
- Celebrate locally when `discoveryCount` crosses a value in `milestones`.

**Leaderboard tab:** Week / Month / All switch (`period`), infinite scroll with
`nextCursor`, the user's own row pinned at the bottom from `/me`, and a
"Near me" view from `/me/neighbors`.

**Collected tab:** a grid from `/me/discoveries`, thumbnails from `image.thumb`,
placeholder tiles for `listed: false`, infinite scroll.

**Hall of fame tab:** `/awards`, one card per week, gold, silver and bronze.

## 7. Backwards compatibility

Everything here is additive. Fields were added to existing responses and none
changed meaning; `/leaderboard` without `period` returns exactly what it always
did. An old app keeps working unchanged.
