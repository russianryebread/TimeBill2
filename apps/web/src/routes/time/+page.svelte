<script lang="ts">
  import { onMount } from 'svelte';
  import { pb, toPbDate } from '$lib/pb';
  import { workspace } from '$lib/workspace.svelte';
  import { timer } from '$lib/timer.svelte';
  import { api } from '$lib/api';
  import { formatHours, formatHMS, formatUSD } from '@timebill/shared/money';
  import DayGantt from '$lib/components/DayGantt.svelte';
  import TimeEntryEditor from '$lib/components/TimeEntryEditor.svelte';

  type ProjectOption = {
    id: string;
    name: string;
    color: string;
    client: string;
    expand?: { client?: { id: string; name: string } };
  };
  type TaskOption = { id: string; name: string };
  type Entry = {
    id: string;
    project: string;
    task: string;
    started_at: string;
    ended_at: string | null;
    description: string;
    billable: boolean;
    rate_cents_snapshot: number | null;
    invoice: string;
    expand?: {
      project?: { id: string; name: string; color: string; client: string; expand?: { client?: { name: string } } };
      task?: { id: string; name: string };
    };
  };

  let projects = $state<ProjectOption[]>([]);
  let tasks = $state<TaskOption[]>([]);
  let entries = $state<Entry[]>([]);
  let loading = $state(true);

  let selectedProject = $state('');
  let selectedTask = $state('');
  let description = $state('');

  let weekOffset = $state(0);
  let selectedDay = $state(new Date());

  // Edit modal
  let editingEntry = $state<Entry | null>(null);

  function startOfWeek(d: Date): Date {
    const day = d.getDay();
    const diff = (day + 6) % 7;
    const start = new Date(d);
    start.setDate(d.getDate() - diff);
    start.setHours(0, 0, 0, 0);
    return start;
  }
  function endOfWeek(d: Date): Date {
    const e = new Date(startOfWeek(d));
    e.setDate(e.getDate() + 7);
    return e;
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

  async function loadEntries() {
    if (!workspace.current) return;
    loading = true;
    try {
      const start = toPbDate(weekStart);
      const end = toPbDate(endOfWeek(weekStart));
      entries = (await pb.collection('time_entries').getFullList({
        filter: `workspace = "${workspace.current.id}" && started_at >= "${start}" && started_at < "${end}"`,
        sort: '-started_at',
        expand: 'project,project.client,task'
      })) as unknown as Entry[];
    } finally {
      loading = false;
    }
  }

  async function load() {
    if (!workspace.current) return;
    const [p, t] = await Promise.all([api.listProjects({ status: 'active' }), api.listTasks()]);
    projects = p as unknown as ProjectOption[];
    tasks = t as unknown as TaskOption[];
    if (!selectedProject && projects.length > 0) selectedProject = projects[0]!.id;
    if (!selectedTask && tasks.length > 0) selectedTask = tasks[0]!.id;
    await loadEntries();
  }

  $effect(() => {
    if (workspace.current && projects.length === 0) load();
  });

  function durationMs(e: Entry): number {
    if (!e.ended_at) return Date.now() - new Date(e.started_at).getTime();
    return new Date(e.ended_at).getTime() - new Date(e.started_at).getTime();
  }
  function sameDay(a: Date, b: Date): boolean {
    return (
      a.getFullYear() === b.getFullYear() &&
      a.getMonth() === b.getMonth() &&
      a.getDate() === b.getDate()
    );
  }

  let dayTotals = $derived.by(() =>
    weekDays.map((day) =>
      entries
        .filter((e) => sameDay(new Date(e.started_at), day))
        .reduce((sum, e) => sum + durationMs(e), 0)
    )
  );
  let weekTotal = $derived(dayTotals.reduce((a, b) => a + b, 0));

  let entriesForSelectedDay = $derived.by(() =>
    entries
      .filter((e) => sameDay(new Date(e.started_at), selectedDay))
      .sort((a, b) => new Date(b.started_at).getTime() - new Date(a.started_at).getTime())
  );

  let dayTotal = $derived(entriesForSelectedDay.reduce((s, e) => s + durationMs(e), 0));

  async function start() {
    if (!selectedProject) return;
    await timer.start({
      projectId: selectedProject,
      taskId: selectedTask || undefined,
      description
    });
    description = '';
    await loadEntries();
  }
  async function stop() {
    await timer.stop();
    await loadEntries();
  }
  async function resumeEntry(e: Entry) {
    await timer.start({
      projectId: e.project,
      taskId: e.task || undefined,
      description: e.description
    });
    await loadEntries();
  }

  function fmtDateLong(d: Date): string {
    return d.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' });
  }
  function dayLabel(d: Date): string {
    return d.toLocaleDateString('en-US', { weekday: 'narrow' });
  }
  function fmtTime(s: string): string {
    return new Date(s).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
  }

  function openEdit(e: Entry) {
    if (!e.ended_at) return; // still running — use the live timer banner
    editingEntry = e; // locked entries open in read-only mode (handled by the editor)
  }

  async function onEntrySaved() {
    editingEntry = null;
    await loadEntries();
  }

  onMount(() => {
    load();
  });

  $effect(() => {
    void weekOffset;
    if (workspace.current) loadEntries();
  });
</script>

<div class="mx-auto max-w-5xl px-8 py-8">
  <h1 class="text-2xl font-bold text-slate-900">Time</h1>
  <p class="mt-1 text-sm text-slate-600">Track hours, see your week at a glance.</p>

  <!-- Timer bar -->
  <div class="mt-6 rounded-xl border border-slate-200 bg-white p-4">
    {#if timer.running}
      <div class="flex items-center gap-4">
        <span class="inline-block h-3 w-3 animate-pulse rounded-full bg-brand-400" aria-hidden="true"></span>
        <div class="flex-1">
          <div class="text-sm text-slate-500">
            {timer.running.expand?.project?.expand?.client?.name ?? ''}
          </div>
          <div class="font-medium">{timer.running.expand?.project?.name ?? 'Project'}</div>
          {#if timer.running.expand?.task}
            <div class="text-xs text-slate-500">{timer.running.expand.task.name}</div>
          {/if}
        </div>
        <div class="font-mono text-2xl font-semibold text-brand-800">
          {formatHMS(timer.elapsedMs)}
        </div>
        <button
          class="rounded bg-brand-800 px-4 py-2 text-sm font-medium text-white hover:bg-brand-900"
          onclick={stop}
        >
          Stop
        </button>
      </div>
    {:else if projects.length === 0}
      <p class="text-sm text-slate-500">
        Create a <a href="/projects" class="text-brand-600 hover:underline">project</a> to start tracking.
      </p>
    {:else}
      <div class="grid grid-cols-12 gap-3">
        <select
          bind:value={selectedProject}
          class="col-span-4 rounded border border-slate-300 px-3 py-2 text-sm focus:border-brand-500 focus:outline-none"
        >
          {#each projects as p}
            <option value={p.id}>
              {p.expand?.client?.name ? `${p.expand.client.name} — ` : ''}{p.name}
            </option>
          {/each}
        </select>
        <select
          bind:value={selectedTask}
          class="col-span-3 rounded border border-slate-300 px-3 py-2 text-sm focus:border-brand-500 focus:outline-none"
        >
          <option value="">No activity</option>
          {#each tasks as t}
            <option value={t.id}>{t.name}</option>
          {/each}
        </select>
        <input
          placeholder="What are you working on?"
          bind:value={description}
          onkeydown={(e) => e.key === 'Enter' && start()}
          class="col-span-3 rounded border border-slate-300 px-3 py-2 text-sm focus:border-brand-500 focus:outline-none"
        />
        <button
          class="col-span-2 flex items-center justify-center gap-2 rounded bg-brand-800 px-4 py-2 text-sm font-medium text-white hover:bg-brand-900"
          onclick={start}
        >
          <span class="icon-[ph--play-fill] text-base" aria-hidden="true"></span>
          Start
        </button>
      </div>
    {/if}
  </div>

  <!-- Week strip -->
  <div class="mt-6 rounded-xl border border-slate-200 bg-white">
    <div class="flex items-center justify-between border-b border-slate-100 px-4 py-3">
      <button
        class="rounded p-1 text-slate-500 hover:bg-slate-100"
        onclick={() => (weekOffset = weekOffset - 1)}
        aria-label="Previous week"
      >
        <span class="icon-[ph--caret-left] text-base" aria-hidden="true"></span>
      </button>
      <div class="text-sm font-medium text-slate-700">
        Week of {weekStart.toLocaleDateString('en-US', { month: 'long', day: 'numeric' })}
        · {formatHours(weekTotal)}
      </div>
      <button
        class="rounded p-1 text-slate-500 hover:bg-slate-100"
        onclick={() => (weekOffset = weekOffset + 1)}
        aria-label="Next week"
      >
        <span class="icon-[ph--caret-right] text-base" aria-hidden="true"></span>
      </button>
    </div>
    <div class="grid grid-cols-7 px-4 py-4">
      {#each weekDays as day, i}
        {@const isSelected = sameDay(day, selectedDay)}
        {@const isToday = sameDay(day, new Date())}
        <button
          class="flex flex-col items-center gap-1 rounded-lg py-2 transition hover:bg-slate-50"
          onclick={() => (selectedDay = day)}
        >
          <span class="text-xs uppercase tracking-wider text-slate-500">{dayLabel(day)}</span>
          <span
            class="flex h-9 w-9 items-center justify-center rounded-full text-sm font-medium
              {isSelected ? 'bg-brand-800 text-white' : isToday ? 'text-brand-800' : 'text-slate-700'}"
          >
            {day.getDate()}
          </span>
          <span class="font-mono text-xs text-slate-500">{formatHours(dayTotals[i] ?? 0)}</span>
        </button>
      {/each}
    </div>
  </div>

  <!-- Day Gantt timeline -->
  <div class="mt-6 rounded-xl border border-slate-200 bg-white">
    <div class="flex items-center justify-between border-b border-slate-100 px-5 py-3 text-sm">
      <span class="font-medium text-slate-700">{fmtDateLong(selectedDay)}</span>
      <span class="font-mono text-slate-500">{formatHours(dayTotal)} tracked</span>
    </div>
    <div class="px-5 py-4">
      <DayGantt
        entries={entriesForSelectedDay}
        onEntryClick={(e) => openEdit(e as Entry)}
      />
    </div>
  </div>

  <!-- Day entry list -->
  <div class="mt-4 rounded-xl border border-slate-200 bg-white">
    {#if loading}
      <div class="p-8 text-center text-sm text-slate-500">Loading…</div>
    {:else if entriesForSelectedDay.length === 0}
      <div class="p-12 text-center text-sm text-slate-500">No time tracked this day.</div>
    {:else}
      <ul>
        {#each entriesForSelectedDay as e (e.id)}
          {@const isLocked = !!e.invoice}
          {@const isRunning = !e.ended_at}
          <li class="border-b border-slate-100 last:border-0">
            <div class="flex items-center gap-4 px-5 py-3 hover:bg-slate-50">
              <!-- The whole left half is clickable (opens editor, read-only if locked). -->
              <button
                type="button"
                class="flex flex-1 items-center gap-4 text-left disabled:cursor-default"
                onclick={() => openEdit(e)}
                disabled={isRunning}
              >
                <span
                  class="inline-block h-3 w-3 shrink-0 rounded-full"
                  style:background-color={e.expand?.project?.color ?? '#94a3b8'}
                  aria-hidden="true"
                ></span>
                <div class="flex-1 min-w-0">
                  <div class="flex items-center gap-2">
                    <span class="text-xs text-slate-500">{e.expand?.project?.expand?.client?.name ?? ''}</span>
                    {#if isLocked}
                      <span class="flex items-center gap-1 rounded-full bg-amber-100 px-1.5 py-0.5 text-[10px] font-medium text-amber-800" title="Linked to an invoice — click to view">
                        <span class="icon-[ph--lock-key-duotone] text-xs" aria-hidden="true"></span>
                        invoiced
                      </span>
                    {/if}
                    {#if isRunning}
                      <span class="text-[10px] uppercase tracking-wider text-brand-700">running</span>
                    {/if}
                  </div>
                  <div class="truncate font-medium text-slate-900">{e.expand?.project?.name ?? '—'}</div>
                  <div class="flex items-center gap-2 text-xs text-slate-500">
                    {#if e.expand?.task}<span>{e.expand.task.name}</span><span aria-hidden="true">·</span>{/if}
                    <span>{fmtTime(e.started_at)}{e.ended_at ? `–${fmtTime(e.ended_at)}` : ' →'}</span>
                    {#if e.description}
                      <span aria-hidden="true">·</span>
                      <span class="truncate">{e.description}</span>
                    {/if}
                  </div>
                </div>
              </button>

              <div class="text-right">
                <div class="font-mono text-base text-slate-800">{formatHours(durationMs(e))}</div>
                {#if e.billable && e.rate_cents_snapshot}
                  <div class="font-mono text-[10px] text-slate-500">
                    {formatUSD(Math.round((e.rate_cents_snapshot * durationMs(e)) / 3_600_000))}
                  </div>
                {/if}
              </div>
              <div class="flex items-center gap-1">
                {#if !isRunning && !isLocked}
                  <button
                    class="flex h-8 w-8 items-center justify-center rounded-full text-slate-500 hover:bg-slate-100 hover:text-brand-700"
                    onclick={() => openEdit(e)}
                    aria-label="Edit entry"
                  >
                    <span class="icon-[ph--pencil-simple-duotone]" aria-hidden="true"></span>
                  </button>
                {/if}
                {#if !isRunning}
                  <button
                    class="flex h-8 w-8 items-center justify-center rounded-full border border-slate-300 text-brand-700 hover:border-brand-500 hover:bg-brand-50 disabled:opacity-30"
                    onclick={() => resumeEntry(e)}
                    aria-label="Resume timer"
                    disabled={!!timer.running}
                  >
                    <span class="icon-[ph--play-fill]" aria-hidden="true"></span>
                  </button>
                {/if}
              </div>
            </div>
          </li>
        {/each}
      </ul>
    {/if}
  </div>
</div>

{#if editingEntry}
  <TimeEntryEditor
    entry={editingEntry}
    {projects}
    {tasks}
    onClose={() => (editingEntry = null)}
    onSaved={onEntrySaved}
  />
{/if}
