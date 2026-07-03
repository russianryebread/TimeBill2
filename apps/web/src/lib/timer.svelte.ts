import { pb } from './pb';
import { workspace } from './workspace.svelte';
import { auth } from './auth.svelte';

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
    }, 1000);
  }

  /**
   * Push the running timer's state to the Rust tick thread so the tray
   * title shows the correct daily aggregate for the running project.
   * Call this whenever entries change (load, edit, delete, realtime
   * subscription fires).
   *
   * @param dailyBaseMs Sum of all COMPLETED (ended_at != "") entries for
   * the running project today, in milliseconds. Pass 0 when no timer is
   * running — that clears the tray.
   */
  async pushTimerState(dailyBaseMs: number) {
    if (typeof window === 'undefined') return;
    if (typeof (window as any).__TAURI_INTERNALS__ === 'undefined') return;
    try {
      const { invoke } = await import('@tauri-apps/api/core');
      if (this.running) {
        await invoke('push_timer_state', {
          runningStartedMs: new Date(this.running.started_at).getTime(),
          dailyBaseMs: Math.round(dailyBaseMs)
        });
      } else {
        await invoke('push_timer_state', {
          runningStartedMs: null,
          dailyBaseMs: 0
        });
      }
    } catch (_) {
      // Silently ignore — running in web build or command not registered.
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
    const created = await pb.collection('time_entries').create({
      workspace: workspace.current.id,
      project: opts.projectId,
      task: opts.taskId ?? null,
      started_at: new Date().toISOString(),
      ended_at: null,
      description: opts.description ?? '',
      billable: true
    }, { expand: 'project,project.client,task' });
    // Update local state synchronously — the realtime subscription will also
    // fire and re-sync, but the UI shouldn't wait for the round trip.
    this.running = created as unknown as TimeEntry;
    this.now = Date.now();
    // Push initial state — daily base is 0 since we just started (any
    // prior completed entries will be added when the caller reloads).
    this.pushTimerState(0);
    return created;
  }

  /**
   * Stop a specific entry (or whichever timer is currently running). We
   * clear `this.running` optimistically so the UI updates immediately — the
   * realtime subscription will re-sync afterwards. Relying solely on the
   * subscription left the banner stuck whenever the websocket lagged or
   * was reconnecting.
   */
  async stop(entryId?: string) {
    const id = entryId ?? this.running?.id;
    if (!id) return;
    // Optimistic local clear first — guarantees the UI updates even if the
    // realtime subscription is slow/disconnected.
    if (this.running?.id === id) {
      this.running = null;
      this.pushTimerState(0);
    }
    try {
      await pb.collection('time_entries').update(id, {
        ended_at: new Date().toISOString()
      });
    } catch (err) {
      // Revert on failure so the user can retry.
      await this.loadRunning();
      throw err;
    }
  }
}

export const timer = new TimerState();
