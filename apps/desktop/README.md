# @timebill/desktop

Tauri Mac desktop app — wraps the SvelteKit web build and adds native features (menu bar timer, global hotkeys, idle detection, notifications).

**Status:** scaffold deferred to Phase 1. Phase 0 verification doesn't require this app; it tests web + PocketBase auth. When we start the menu bar timer (Phase 1), we'll initialize:

```sh
cd apps/desktop
npm create tauri-app@latest .   # template: vanilla / svelte (we point devPath at ../web)
```

Then configure `src-tauri/tauri.conf.json`:
- `build.devUrl = http://127.0.0.1:5173` (during dev, points at SvelteKit Vite)
- `build.frontendDist = ../../apps/web/build` (production points at the static build)
- Tray icon + menu bar window matching the [Timing-app-style screenshot](../../docs/menubar-mockup.png)
- Global shortcut `Ctrl+Opt+T` for start/stop most recent timer
