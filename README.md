# avtr.zip-pusher

A Windows tray app that watches your VRChat logs for avatar ids and sends them to
[avtr.zip](https://avtr.zip), so avatars you run into get indexed and become searchable.

Left-clicking the tray icon opens a panel showing what has been pushed, your discovery
credit and rank, the leaderboard, and whether the heartbeat is running.

## Install

Download the installer from the [releases page](https://github.com/TheArmagan/avtr.zip-pusher/releases)
and run it. It installs to `%LOCALAPPDATA%\avtr` and starts in the tray.

Windows only. The paths it watches and the credential encryption it uses are both
Windows-specific.

## What it does

It watches two places for `avtr_...` ids:

- `%APPDATA%\..\LocalLow\VRChat\VRChat\output_log_*.txt`, tailing the newest one and
  picking up new log files as VRChat creates them
- `%TEMP%\VRChat\VRChat\amplitude.cache`

Ids it has not seen before are buffered, batched, and pushed. Every id it has pushed is
recorded in `seenAvatars.txt` so it never sends the same one twice.

It reads nothing else from your logs. No world ids, no instance ids, no player names.

## Linking an account

Pushing works without an account and always will. Linking one gets you:

- 500 ids per request instead of one at a time
- discovery credit on the public leaderboard
- recognition on the in-world screens, which matters when several people share one
  public IP address

Click **Link account** in the panel. It shows an eight character code and opens
avtr.zip in your browser. Check the code on screen matches the one the browser shows,
pick your VRChat account, paste the nonce it gives you into your VRChat bio, and save.
The code is good for ten minutes.

The token is encrypted with the Windows credential API and stored in
`%APPDATA%\avtr.zip-pusher\credentials.bin`. Signing out revokes it server-side rather
than only forgetting it locally.

## Files it writes

All under `%APPDATA%\avtr.zip-pusher`:

| file | contents |
|---|---|
| `seenAvatars.txt` | every avatar id already pushed, one per line |
| `settings.json` | notification, startup and force-push preferences |
| `identity.json` | your display name, VRChat user id and token id. No secret |
| `credentials.bin` | the API token, encrypted. Only readable by your Windows account |
| `logs/pusher.log` | rotated at 1 MB, 3 kept. Tokens are masked before anything is written |

## Deep links

The app registers the `azp://` scheme:

- `azp://push/avtr_xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx` queues one avatar
- `azp://panel` opens the panel

## Building from source

Needs [Bun](https://bun.sh) and Windows.

```
bun install
bun run start     # run it
bun run make      # build the Squirrel installer into out/
```

The app is Electron, main process plus one renderer for the panel. There is no bundler
and no build step for the UI: `src/ui/` is plain HTML, CSS and JavaScript loaded
directly.

```
src/index.js      startup and wiring
src/main/         tray, panel window, IPC, settings, logging, update check
src/core/         API client, linking, token storage, push batching, heartbeat, log watchers
src/ui/           the panel
```

`pusher-desktop-protocol.md` documents the API this talks to.

## Licence

GPL-3.0-only.
