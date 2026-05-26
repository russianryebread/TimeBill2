import { pb } from './pb';
import { workspace } from './workspace.svelte';
import { auth } from './auth.svelte';

/**
 * Compact "menu-bar friendly" label for the tray title. Strips seconds; uses
 * "Xh Ym" once an hour has passed, otherwise just "Ym".
 */
function compactElapsed(ms: number): string {
  const totalMinutes = Math.floor(Math.max(0, ms) / 60_000);
  const h = Math.floor(totalMinutes / 60);
  const m = totalMinutes % 60;
  if (h > 0) return `${h}h ${m}m`;
  return `${m}m`;
}

export type TimeEntry = {
  id: string;
  workspace: string;
  project: string;
  task?: string;
  started_at: string;
  ended_at: string | null;
  description: string;
  billable: boolean;
  rate_cents_snapshot: number | null;
  invoice: string | null;
  expand?: {
    project?: { id: string; name: string; color?: string; client: string; expand?: { client?: { name: string } } };
    task?: { id: string; name: string };
  };
};

class TimerState {
  running = $state<TimeEntry | null>(null);
  now = $state(Date.now());
  private tickHandle: ReturnType<typeof setInterval> | null = null;
  private unsubscribe: (() => void) | null = null;

  get elapsedMs(): number {
    if (!this.running) return 0;
    // Clamp to 0: clock skew can produce a brief negative reading right
    // after starting a timer (server stores a slightly-future started_at).
    return Math.max(0, this.now - new Date(this.running.started_at).getTime());
  }

  async init() {
    if (!auth.isLoggedIn || !workspace.current) return;
    await this.loadRunning();
    this.startTick();
    await this.subscribe();
  }

  async dispose() {
    if (this.tickHandle) clearInterval(this.tickHandle);
    if (this.unsubscribe) this.unsubscribe();
    this.tickHandle = null;
    this.unsubscribe = null;
  }

  private startTick() {
    if (this.tickHandle) return;
    this.tickHandle = setInterval(() => {
      this.now = Date.now();
      this.pushTrayTitle();
    }, 1000);
  }

  /**
   * Push the running timer's elapsed time to the macOS tray title so the user
   * can glance at the menu bar and see they're tracking. Cleared when no
   * timer is running. No-op outside Tauri.
   */
  private trayTitleLast = '';
  /**
   * Push the running timer's elapsed (minute-precision) to the macOS tray
   * title. Updates only when the minute changes, so each timer second-tick
   * is essentially free. Cleared (and icon restored) when no timer is
   * running. No-op outside Tauri.
   */
  private async pushTrayTitle() {
    if (typeof window === 'undefined') return;
    if (typeof (window as any).__TAURI_INTERNALS__ === 'undefined') return;
    const next = this.running ? compactElapsed(this.elapsedMs) : '';
    if (next === this.trayTitleLast) return;
    this.trayTitleLast = next;
    try {
      const { invoke } = await import('@tauri-apps/api/core');
      await invoke('set_tray_title', { title: next });
    } catch (_) {
      // Silently ignore — likely running in the web build or the command
      // isn't registered (older Tauri build before the title feature shipped).
    }
  }

  private async loadRunning() {
    if (!workspace.current) return;
    const list = await pb.collection('time_entries').getList(1, 1, {
      filter: `workspace = "${workspace.current.id}" && ended_at = ""`,
      sort: '-started_at',
      expand: 'project,project.client,task'
    });
    this.running = (list.items[0] as TimeEntry | undefined) ?? null;
  }

  private async subscribe() {
    if (this.unsubscribe) this.unsubscribe();
    const fn = await pb.collection('time_entries').subscribe('*', () => {
      this.loadRunning();
    });
    this.unsubscribe = fn;
  }

  async start(opts: { projectId: string; taskId?: string; description?: string }) {
    if (!workspace.current) throw new Error('No workspace');
    return pb.collection('time_entries').create({
      workspace: workspace.current.id,
      project: opts.projectId,
      task: opts.taskId ?? null,
      started_at: new Date().toISOString(),
      ended_at: null,
      description: opts.description ?? '',
      billable: true
    });
  }

  async stop() {
    if (!this.running) return;
    await pb.collection('time_entries').update(this.running.id, {
      ended_at: new Date().toISOString()
    });
  }
}

export const timer = new TimerState();
