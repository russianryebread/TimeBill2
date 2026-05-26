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
