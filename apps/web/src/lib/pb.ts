import PocketBase from 'pocketbase';
import { browser } from '$app/environment';

const PB_URL = browser
  ? (localStorage.getItem('pb_url') ?? `${window.location.protocol}//${window.location.hostname}:8090`)
  : 'http://127.0.0.1:8090';

export const pb = new PocketBase(PB_URL);

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
