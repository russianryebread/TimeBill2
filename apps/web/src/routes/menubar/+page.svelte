<script lang="ts">
  import { onMount } from 'svelte';
  import { pb, toPbDate } from '$lib/pb';
  import { workspace } from '$lib/workspace.svelte';
  import { timer } from '$lib/timer.svelte';
  import { api } from '$lib/api';
  import { formatHours, formatHMS } from '@timebill/shared/money';

  type Entry = {
    id: string;
    project: string;
    task: string;
    started_at: string;
    ended_at: string | null;
    expand?: {
      project?: { id: string; name: string; color: string; client: string; expand?: { client?: { name: string } } };
      task?: { id: string; name: string };
    };
  };

  let entries = $state<Entry[]>([]);
  let weekOffset = $state(0);
  let selectedDay = $state(new Date());
  let loading = $state(true);

  function startOfWeek(d: Date): Date {
    const day = d.getDay();
    const diff = (day + 6) % 7;
    const s = new Date(d);
    s.setDate(d.getDate() - diff);
    s.setHours(0, 0, 0, 0);
    return s;
  }

  let weekStart = $derived.by(() => {
    const d = new Date();
    d.setDate(d.getDate() + weekOffset * 7);
    return startOfWeek(d);
  });

  let weekDays = $derived.by(() => {
    const days: Date[] = [];
    for (let i = 0; i < 7; i++) {
      const d = new Date(weekStart);
      d.setDate(d.getDate() + i);
      days.push(d);
    }
    return days;
  });

  function sameDay(a: Date, b: Date): boolean {
    return (
      a.getFullYear() === b.getFullYear() &&
      a.getMonth() === b.getMonth() &&
      a.getDate() === b.getDate()
    );
  }

  function durationMs(e: Entry): number {
    const ms = e.ended_at
      ? new Date(e.ended_at).getTime() - new Date(e.started_at).getTime()
      : Date.now() - new Date(e.started_at).getTime();
    return Math.max(0, ms);
  }

  async function load() {
    if (!workspace.current) return;
    loading = true;
    try {
      const end = new Date(weekStart);
      end.setDate(end.getDate() + 7);
      entries = (await pb.collection('time_entries').getFullList({
        filter: `workspace = "${workspace.current.id}" && started_at >= "${toPbDate(weekStart)}" && started_at < "${toPbDate(end)}"`,
        sort: '-started_at',
        expand: 'project,project.client,task'
      })) as unknown as Entry[];
    } finally {
      loading = false;
    }
  }

  let dayTotals = $derived(
    weekDays.map((day) =>
      entries
        .filter((e) => sameDay(new Date(e.started_at), day))
        .reduce((sum, e) => sum + durationMs(e), 0)
    )
  );

  type GroupProject = NonNullable<NonNullable<Entry['expand']>['project']>;
  type GroupTask = NonNullable<NonNullable<Entry['expand']>['task']>;
  type Group = {
    project: GroupProject | undefined;
    task: GroupTask | undefined;
    totalMs: number;
  };

  let selectedDayGroups = $derived.by(() => {
    const m = new Map<string, Group>();
    for (const e of entries.filter((e) => sameDay(new Date(e.started_at), selectedDay))) {
      const k = `${e.project}|${e.task ?? ''}`;
      const existing = m.get(k);
      if (existing) {
        existing.totalMs += durationMs(e);
      } else {
        m.set(k, {
          project: e.expand?.project,
          task: e.expand?.task,
          totalMs: durationMs(e)
        });
      }
    }
    return Array.from(m.values()).sort((a, b) => b.totalMs - a.totalMs);
  });

  function fmtDate(d: Date): string {
    return d.toLocaleDateString('en-US', { weekday: 'long', day: 'numeric', month: 'short' });
  }

  function dayLabel(d: Date): string {
    return d.toLocaleDateString('en-US', { weekday: 'narrow' });
  }

  async function quickStart(projectId: string, taskId?: string) {
    await timer.start({ projectId, taskId });
    await load();
  }

  async function stop() {
    await timer.stop();
    await load();
  }

  /**
   * "Open app" button — when running inside Tauri, show the main window
   * (and hide the popover). In the pure web build (or fallback), navigate
   * to /time as before.
   */
  async function openMainApp() {
    if (typeof (window as any).__TAURI_INTERNALS__ !== 'undefined') {
      try {
        const { Window } = await import('@tauri-apps/api/window');
        const main = await Window.getByLabel('main');
        if (main) {
          await main.show();
          await main.setFocus();
        }
        const me = await Window.getByLabel('menubar');
        if (me) await me.hide();
        return;
      } catch (err) {
        console.warn('[menubar] failed to open main window', err);
      }
    }
    window.location.href = '/time';
  }

  onMount(() => {
    if (workspace.current) load();
  });

  $effect(() => {
    void weekOffset;
    if (workspace.current) load();
  });
</script>

<div class="flex h-screen flex-col overflow-hidden rounded-xl bg-white shadow-xl">
  <!-- Orange-style banded header (themed) -->
  <header class="bg-brand-800 px-4 py-3 text-white">
    <div class="flex items-center justify-between text-sm">
      <span class="font-medium">{fmtDate(selectedDay)}</span>
      <div class="flex items-center gap-2">
        <button
          class="rounded p-1 hover:bg-white/10"
          onclick={() => (weekOffset = weekOffset - 1)}
          aria-label="Previous week"
        >‹</button>
        <button
          class="rounded p-1 hover:bg-white/10"
          onclick={() => (weekOffset = weekOffset + 1)}
          aria-label="Next week"
        >›</button>
      </div>
    </div>
  </header>

  <!-- Week strip -->
  <div class="grid grid-cols-7 border-b border-slate-200 px-2 py-2">
    {#each weekDays as day, i}
      {@const isSel = sameDay(day, selectedDay)}
      <button
        class="flex flex-col items-center gap-0.5 rounded py-1 transition hover:bg-slate-50"
        onclick={() => (selectedDay = day)}
      >
        <span class="text-[10px] uppercase text-slate-500">{dayLabel(day)}</span>
        <span
          class="flex h-7 w-7 items-center justify-center rounded-full text-xs font-medium
            {isSel ? 'bg-brand-800 text-white' : 'text-slate-700'}"
        >
          {day.getDate()}
        </span>
        <span class="font-mono text-[10px] text-slate-500">{formatHours(dayTotals[i] ?? 0)}</span>
      </button>
    {/each}
  </div>

  <!-- Running banner -->
  {#if timer.running}
    <div class="flex items-center gap-2 border-b border-brand-400 bg-brand-50 px-4 py-2">
      <span class="h-2 w-2 animate-pulse rounded-full bg-brand-400"></span>
      <span class="flex-1 truncate text-xs text-brand-800">
        {timer.running.expand?.project?.name ?? 'Project'}
      </span>
      <span class="font-mono text-sm text-brand-800">{formatHMS(timer.elapsedMs)}</span>
      <button class="rounded bg-brand-800 px-2 py-0.5 text-xs font-medium text-white" onclick={stop}>
        Stop
      </button>
    </div>
  {/if}

  <!-- Day list -->
  <div class="flex-1 overflow-auto">
    {#if loading}
      <div class="p-8 text-center text-xs text-slate-500">Loading…</div>
    {:else if selectedDayGroups.length === 0}
      <div class="p-12 text-center text-xs text-slate-500">Nothing tracked today.</div>
    {:else}
      <ul>
        {#each selectedDayGroups as g}
          <li class="flex items-center gap-3 border-b border-slate-100 px-4 py-3 last:border-0">
            <span
              class="h-2.5 w-2.5 shrink-0 rounded-full"
              style:background-color={g.project?.color ?? '#94a3b8'}
            ></span>
            <div class="min-w-0 flex-1">
              <div class="truncate text-[10px] text-slate-500">
                {g.project?.expand?.client?.name ?? ''}
              </div>
              <div class="truncate text-sm font-medium text-slate-900">
                {g.project?.name ?? '—'}
              </div>
              {#if g.task}
                <div class="truncate text-xs text-slate-500">{g.task.name}</div>
              {/if}
            </div>
            <div class="font-mono text-sm text-slate-800">{formatHours(g.totalMs)}</div>
            <button
              class="flex h-7 w-7 shrink-0 items-center justify-center rounded-full border border-slate-300 text-brand-700 hover:border-brand-500 hover:bg-brand-50"
              disabled={!!timer.running}
              onclick={() => quickStart(g.project?.id ?? '', g.task?.id)}
              aria-label="Start timer"
            >
              <span class="icon-[ph--play-fill]" aria-hidden="true"></span>
            </button>
          </li>
        {/each}
      </ul>
    {/if}
  </div>

  <!-- Footer toolbar -->
  <footer class="flex items-center justify-between border-t border-slate-200 px-4 py-2">
    <button
      type="button"
      class="flex items-center gap-1 rounded px-1.5 py-1 text-xs text-slate-500 hover:bg-slate-50 hover:text-brand-700"
      onclick={openMainApp}
      title="Add a new entry in the main app"
    >
      <span class="icon-[ph--plus]" aria-hidden="true"></span>
      New
    </button>
    <button
      type="button"
      class="flex items-center gap-1 rounded px-1.5 py-1 text-xs text-slate-500 hover:bg-slate-50 hover:text-brand-700"
      onclick={openMainApp}
      title="Open the full TimeBill app"
    >
      <span class="icon-[ph--arrow-square-out]" aria-hidden="true"></span>
      Open app
    </button>
  </footer>
</div>

<style>
  /* Window is transparent + decorations:false in Tauri; let the desktop
     show through outside the rounded card so the corners visually clip. */
  :global(html),
  :global(body) {
    background: transparent !important;
  }
</style>
