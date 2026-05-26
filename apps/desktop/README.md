# @timebill/desktop

Tauri Mac desktop wrapper around the SvelteKit web build. Adds a menu
bar timer window, a tray icon, and a global hotkey on top of the same
SPA the browser uses.

## Architecture

Two windows, both pointing at the same frontend bundle (`apps/web/build`
in production, the SvelteKit dev server on `127.0.0.1:5173` in dev):

- **`main`** — the full app (1100x720, hidden at launch). Opened from
  the tray's "Open TimeBill" menu item.
- **`menubar`** — chromeless 380x520 popover that loads `/menubar` (the
  Svelte route in `apps/web/src/routes/menubar/+page.svelte`).
  Transparent, decoration-free, always on top, hidden at launch.
  Toggled by left-clicking the tray icon or hitting Cmd+Opt+T.

The tray icon uses the app's default window icon as a template image so
macOS auto-adapts it to light/dark menu bars.

## Running

From the repo root:

```sh
npm run dev:desktop   # spawns Vite + opens the Tauri shell
```

That runs `tauri dev`, which:

1. Starts `npm --workspace=apps/web run dev` (Vite on 5173).
2. Launches the Tauri app pointed at the dev server.

You still need PocketBase running separately for auth + data:

```sh
npm run dev:pb        # in another terminal
```

To produce a `.app` and `.dmg`:

```sh
npm run build:desktop
```

This runs the web build first, then bundles it into the native app
under `apps/desktop/src-tauri/target/release/bundle/`.

## Global shortcut

`Cmd+Opt+T` toggles the menu bar window. The intended long-term
behavior is "start/stop the most recently used timer" — that requires
emitting a Tauri event into the Svelte side, which lands when we add
the Rust↔JS bridge.

## TODO

- **Tauri↔Svelte bridge.** Replace the current Cmd+Opt+T toggle with a
  `timer-toggle` event the renderer listens for, so the hotkey
  start/stops the most recent timer without showing the window.
- **Idle detection.** Watch macOS input idle time; when the user has
  been idle for N minutes mid-timer, prompt to discard or keep the
  idle stretch.
- **Notifications.** Pomodoro-style nudges; reminders to start a timer.
- **Code signing + notarization.** Set up Developer ID + notarytool so
  the `.dmg` isn't quarantined on download.
- **Updater.** Hook `tauri-plugin-updater` up to GitHub Releases.
