import PocketBase from 'pocketbase';
import { browser } from '$app/environment';

const URL = 'https://timebill.hoshor.me';

/**
 * Resolve the PocketBase base URL:
 *  - SSR  → 127.0.0.1:8090 (build-time only; we use adapter-static).
 *  - Browser (web served by PB on the same origin) → window.location origin.
 *  - Tauri shell → 127.0.0.1:8090 (the webview's origin is `tauri://` which
 *    isn't a real network host). Per-install override via `localStorage.pb_url`
 *    so the user can point the desktop app at a remote PocketBase later.
 */
function resolvePbUrl(): string {
  if (!browser) return URL;
  const override = localStorage.getItem('pb_url');
  if (override) return override;
  return URL;
}

export const pbUrl = resolvePbUrl();
export const pb = new PocketBase(pbUrl);

pb.autoCancellation(false);

/**
 * Format a Date for use inside a PocketBase filter expression.
 *
 * PocketBase compares date fields as strings in the format
 *   "YYYY-MM-DD HH:MM:SS.sssZ"
 * with a SPACE between date and time (not ISO 8601's T). Filtering with the
 * ISO `T` form lexicographically breaks because 'T' (0x54) > ' ' (0x20), so
 * `started_at >= "2026-01-01T00:00:00.000Z"` excludes all stored rows.
 */
export function toPbDate(d: Date): string {
  return d.toISOString().replace('T', ' ');
}
