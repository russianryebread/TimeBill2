<script lang="ts">
  import { onMount, tick } from 'svelte';
  import { pb, toPbDate, pbUrl } from '$lib/pb';
  import { auth } from '$lib/auth.svelte';
  import { goto } from '$app/navigation';
  import { workspace } from '$lib/workspace.svelte';
  import { timer } from '$lib/timer.svelte';
  import { api } from '$lib/api';
  import { formatHours } from '@timebill/shared/money';

  type Entry = {
    id: string;
    project: string;
    task: string;
    started_at: string;
    ended_at: string | null;
    description: string;
    invoice: string;
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

  function goToToday() {
    weekOffset = 0;
    selectedDay = new Date();
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

  function durationMs(e: Entry, nowMs: number): number {
    const end = e.ended_at ? new Date(e.ended_at).getTime() : nowMs;
    return Math.max(0, end - new Date(e.started_at).getTime());
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
      pushTray();
    }
  }

  // Use timer.now so totals tick as the active timer runs.
  let dayTotals = $derived(
    weekDays.map((day) =>
      entries
        .filter((e) => sameDay(new Date(e.started_at), day))
        .reduce((sum, e) => sum + durationMs(e, timer.now), 0)
    )
  );

  // Sum of all COMPLETED entries for the currently-running project on
  // the current day — this is the "daily base" we push to the Rust tick
  // thread so the tray shows the aggregate, not just the current segment.
  function computeDailyBase(): number {
    if (!timer.running) return 0;
    const today = new Date();
    return entries
      .filter(
        (e) =>
          e.project === timer.running!.project &&
          !!e.ended_at &&
          sameDay(new Date(e.started_at), today)
      )
      .reduce((sum, e) => sum + durationMs(e, timer.now), 0);
  }

  function pushTray() {
    timer.pushTimerState(computeDailyBase());
  }

  // Entries on the selected day, with the running timer (if any and started
  // on the selected day) at the top. The active row gets a green highlight;
  // every other row is rendered with the same client/project layout.
  let entriesForSelectedDay = $derived.by(() => {
    const list = entries
      .filter((e) => sameDay(new Date(e.started_at), selectedDay))
      .sort((a, b) => new Date(b.started_at).getTime() - new Date(a.started_at).getTime());
    return list;
  });

  function fmtDate(d: Date): string {
    return d.toLocaleDateString('en-US', { weekday: 'long', day: 'numeric', month: 'short' });
  }

  function dayLabel(d: Date): string {
    return d.toLocaleDateString('en-US', { weekday: 'narrow' });
  }

  // ---- Inline hours/minutes editor ----
  // Editing keys: when the user types in a row's hours/minutes inputs we keep
  // the draft in a per-id map until they blur or press Enter, then we push the
  // change to PocketBase by adjusting ended_at (or started_at for the running
  // entry — shifting it backwards extends the timer).
  let drafts = $state<Record<string, { h: string; m: string }>>({});

  function hmFromMs(ms: number): { h: number; m: number } {
    const total = Math.max(0, Math.floor(ms / 60_000));
    return { h: Math.floor(total / 60), m: total % 60 };
  }

  function getDraft(e: Entry): { h: string; m: string } {
    const existing = drafts[e.id];
    if (existing) return existing;
    const { h, m } = hmFromMs(durationMs(e, timer.now));
    return { h: String(h), m: String(m).padStart(2, '0') };
  }

  function setDraft(id: string, field: 'h' | 'm', value: string) {
    // Seed the draft from the entry's current displayed h/m the first time
    // the user touches either input, so editing minutes alone doesn't
    // silently zero out the hours field (and vice versa).
    let current = drafts[id];
    if (!current) {
      const e = entries.find((x) => x.id === id);
      if (e) {
        const { h, m } = hmFromMs(durationMs(e, timer.now));
        current = { h: String(h), m: String(m).padStart(2, '0') };
      } else {
        current = { h: '0', m: '0' };
      }
    }
    drafts[id] = { ...current, [field]: value };
  }

  async function commitDraft(e: Entry) {
    const d = drafts[e.id];
    if (!d) return;
    const h = Math.max(0, parseInt(d.h || '0', 10) || 0);
    const m = Math.max(0, parseInt(d.m || '0', 10) || 0);
    const newMs = (h * 60 + m) * 60_000;
    const startMs = new Date(e.started_at).getTime();
    try {
      if (!e.ended_at) {
        // Active timer — keep ended_at empty, shift started_at so elapsed = newMs.
        const newStart = new Date(Date.now() - newMs);
        await pb.collection('time_entries').update(e.id, {
          started_at: newStart.toISOString()
        });
      } else {
        await pb.collection('time_entries').update(e.id, {
          ended_at: new Date(startMs + newMs).toISOString()
        });
      }
      delete drafts[e.id];
      await load();
      pushTray();
    } catch (err) {
      console.warn('[menubar] failed to update duration', err);
    }
  }

  function onKeyDown(ev: KeyboardEvent, e: Entry) {
    if (ev.key === 'Enter') {
      ev.preventDefault();
      (ev.target as HTMLInputElement).blur();
    }
    if (ev.key === 'Escape') {
      delete drafts[e.id];
      (ev.target as HTMLInputElement).blur();
    }
  }

  async function toggleEntry(e: Entry) {
    if (!e.ended_at) {
      // It's the running one — stop it.
      await timer.stop(e.id);
    } else {
      // Resume: start a new entry on the same project/task.
      await timer.start({
        projectId: e.project,
        taskId: e.task || undefined,
        description: e.description
      });
    }
    await load();
    pushTray();
  }

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

  // ---- "New timer" project picker ----
  //
  // Click +New opens an inline popover above the button with a list of active
  // projects (grouped by client). The most-recently-used project is
  // pre-selected and a text input filters the list — typing narrows by
  // client OR project name. Enter starts on the highlighted row, Esc
  // closes. If a timer is already running, starting a new one auto-stops
  // it (the PB hook handles that on create).
  type ProjectOption = {
    id: string;
    name: string;
    color?: string;
    client: string;
    expand?: { client?: { id: string; name: string } };
  };
  let projects = $state<ProjectOption[]>([]);
  let projectsLoaded = $state(false);
  let pickerOpen = $state(false);
  let pickerQuery = $state('');
  let pickerHighlightId = $state<string | null>(null);
  let pickerInputEl: HTMLInputElement | null = null;
  let lastUsedProjectId = $state<string | null>(null);

  async function loadProjects() {
    if (!workspace.current || projectsLoaded) return;
    try {
      projects = (await api.listProjects({ status: 'active' })) as unknown as ProjectOption[];
      projectsLoaded = true;
    } catch (_) {}
  }

  // Most-recently-used project across the workspace (any day) — used as the
  // default highlight when the picker opens.
  async function refreshLastUsedProject() {
    if (!workspace.current) return;
    try {
      const recent = await pb.collection('time_entries').getList(1, 1, {
        filter: `workspace = "${workspace.current.id}"`,
        sort: '-started_at'
      });
      const row = recent.items[0] as any;
      if (row) lastUsedProjectId = row.project;
    } catch (_) {}
  }

  let filteredProjects = $derived.by(() => {
    const q = pickerQuery.trim().toLowerCase();
    if (!q) return projects;
    return projects.filter((p) => {
      const projHit = p.name.toLowerCase().includes(q);
      const clientHit = (p.expand?.client?.name ?? '').toLowerCase().includes(q);
      return projHit || clientHit;
    });
  });

  // Group filtered projects by client for display.
  type ProjectGroup = { clientName: string; clientId: string; projects: ProjectOption[] };
  let projectGroups = $derived.by(() => {
    const m = new Map<string, ProjectGroup>();
    for (const p of filteredProjects) {
      const clientId = p.client;
      const clientName = p.expand?.client?.name ?? '(no client)';
      let g = m.get(clientId);
      if (!g) {
        g = { clientId, clientName, projects: [] };
        m.set(clientId, g);
      }
      g.projects.push(p);
    }
    return Array.from(m.values()).sort((a, b) => a.clientName.localeCompare(b.clientName));
  });

  // Flat ordered list (matches visual order) — used for keyboard nav.
  let pickerFlat = $derived(projectGroups.flatMap((g) => g.projects));

  async function openPicker() {
    await loadProjects();
    await refreshLastUsedProject();
    pickerQuery = '';
    // Default highlight: last-used, or first project in the filtered list.
    pickerHighlightId = lastUsedProjectId &&
      projects.some((p) => p.id === lastUsedProjectId)
      ? lastUsedProjectId
      : projects[0]?.id ?? null;
    pickerOpen = true;
    await tick();
    pickerInputEl?.focus();
  }

  function closePicker() {
    pickerOpen = false;
    pickerQuery = '';
  }

  async function startOnProject(projectId: string) {
    closePicker();
    // Reuse the most-recent task on this project so the new entry keeps
    // its activity classification when the user picks "the same project
    // I was on yesterday." Falls back to no task.
    let taskId: string | undefined;
    try {
      const recent = await pb.collection('time_entries').getList(1, 1, {
        filter: `project = "${projectId}" && task != ""`,
        sort: '-started_at'
      });
      const row = recent.items[0] as any;
      if (row?.task) taskId = row.task;
    } catch (_) {}
    await timer.start({ projectId, taskId });
    lastUsedProjectId = projectId;
    await load();
    pushTray();
  }

  function onPickerKey(ev: KeyboardEvent) {
    if (!pickerOpen) return;
    if (ev.key === 'Escape') {
      ev.preventDefault();
      closePicker();
      return;
    }
    if (ev.key === 'Enter') {
      ev.preventDefault();
      const id = pickerHighlightId ?? pickerFlat[0]?.id ?? null;
      if (id) startOnProject(id);
      return;
    }
    if (ev.key === 'ArrowDown' || ev.key === 'ArrowUp') {
      ev.preventDefault();
      const list = pickerFlat;
      if (list.length === 0) return;
      const idx = Math.max(0, list.findIndex((p) => p.id === pickerHighlightId));
      const next =
        ev.key === 'ArrowDown'
          ? Math.min(list.length - 1, idx + 1)
          : Math.max(0, idx - 1);
      pickerHighlightId = list[next]?.id ?? null;
    }
  }

  // If the query changes and the current highlight isn't in the filtered
  // list, snap to the first match so Enter always starts something visible.
  $effect(() => {
    void pickerQuery;
    if (!pickerOpen) return;
    if (!pickerFlat.some((p) => p.id === pickerHighlightId)) {
      pickerHighlightId = pickerFlat[0]?.id ?? null;
    }
  });

  // ---- Settings panel ----
  let settingsOpen = $state(false);
  let urlDraft = $state(pbUrl);
  let appVersion = $state('—');
  let hasUrlOverride = $state(false);

  function saveUrl() {
    const trimmed = urlDraft.trim();
    if (!trimmed) return;
    localStorage.setItem('pb_url', trimmed);
    pb.authStore.clear();
    window.location.reload();
  }

  function clearUrl() {
    localStorage.removeItem('pb_url');
    pb.authStore.clear();
    window.location.reload();
  }

  async function signOut() {
    auth.logOut();
    await goto('/login');
  }

  async function quitApp() {
    try {
      if (typeof (window as any).__TAURI_INTERNALS__ !== 'undefined') {
        const { invoke } = await import('@tauri-apps/api/core');
        await invoke('quit_app');
      }
    } catch (_) {
      // Fallback: just close the window.
      window.close();
    }
  }

  onMount(async () => {
    if (workspace.current) load();
    hasUrlOverride = !!localStorage.getItem('pb_url');
    try {
      if (typeof (window as any).__TAURI_INTERNALS__ !== 'undefined') {
        const { getVersion } = await import('@tauri-apps/api/app');
        appVersion = await getVersion();
      }
    } catch (_) {}
  });

  $effect(() => {
    void weekOffset;
    if (workspace.current) load();
  });

  // Re-load whenever the realtime running timer changes (start/stop from
  // elsewhere) — the live `timer.running` is updated by the timer store's
  // subscription, so reacting to its id keeps this view in sync without
  // every-second reloads.
  $effect(() => {
    void timer.running?.id;
    void timer.running?.ended_at;
    if (workspace.current) load();
  });
</script>

<div class="flex h-screen w-screen flex-col overflow-hidden bg-white">
  <!-- Banded header -->
  <header class="bg-brand-800 px-4 py-3 text-white">
    <div class="flex items-center justify-between text-sm">
      <div class="flex items-center gap-2">
        <span class="font-medium">{fmtDate(selectedDay)}</span>
        <button
            class="flex h-6 w-6 items-center justify-center rounded-full hover:bg-white/10"
            onclick={() => goToToday()}
            aria-label="Go To Today"
            title="Go To Today"
        ><span class="icon-[ph--calendar-duotone]" aria-hidden="true"></span></button>
      </div>
      <div class="flex items-center gap-2">
        <button
          class="flex h-6 w-6 items-center justify-center rounded-full hover:bg-white/10"
          onclick={() => (weekOffset = weekOffset - 1)}
          aria-label="Previous week"
        >‹</button>
        <button
          class="flex h-6 w-6 items-center justify-center rounded-full hover:bg-white/10"
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

  <!-- Day list -->
  <div class="menubar-scroll flex-1 overflow-auto">
    {#if loading}
      <div class="p-8 text-center text-xs text-slate-500">Loading…</div>
    {:else if entriesForSelectedDay.length === 0}
      <div class="p-12 text-center text-xs text-slate-500">Nothing tracked today.</div>
    {:else}
      <ul>
        {#each entriesForSelectedDay as e (e.id)}
          {@const isRunning = !e.ended_at}
          {@const isLocked = !!e.invoice}
          {@const d = getDraft(e)}
          <li
            class="flex items-center gap-3 border-b border-slate-100 px-3 py-2 last:border-0
              {isRunning ? 'bg-brand-50' : ''}"
          >
            <!-- Project color dot, or clock with spinning hands for the active entry -->
            {#if isRunning}
              <svg
                class="h-4 w-4 shrink-0 text-brand-500"
                viewBox="0 0 24 24"
                fill="none"
                aria-label="Timer running"
              >
                <circle cx="12" cy="12" r="9.25" fill="currentColor" opacity="0.2" />
                <circle cx="12" cy="12" r="9.25" stroke="currentColor" stroke-width="1.5" />
                <line
                  class="clock-hand clock-hand--hour"
                  x1="12"
                  y1="12"
                  x2="12"
                  y2="7.5"
                  stroke="currentColor"
                  stroke-width="1.75"
                  stroke-linecap="round"
                />
                <line
                  class="clock-hand clock-hand--minute"
                  x1="12"
                  y1="12"
                  x2="12"
                  y2="5"
                  stroke="currentColor"
                  stroke-width="1.5"
                  stroke-linecap="round"
                />
                <circle cx="12" cy="12" r="0.9" fill="currentColor" />
              </svg>
            {:else}
              <span
                class="h-2.5 w-2.5 shrink-0 rounded-full"
                style:background-color={e.expand?.project?.color ?? '#94a3b8'}
                aria-hidden="true"
              ></span>
            {/if}

            <!-- Client / project / task -->
            <div class="min-w-0 flex-1">
              <div class="truncate text-[10px] text-slate-500">
                {e.expand?.project?.expand?.client?.name ?? ''}
              </div>
              <div class="truncate text-sm font-medium {isRunning ? 'text-brand-800' : 'text-slate-900'}">
                {e.expand?.project?.name ?? '—'}
              </div>
              {#if e.expand?.task}
                <div class="truncate text-[11px] text-slate-500">{e.expand.task.name}</div>
              {/if}
            </div>

            <!-- Hours / minutes editor -->
            <div class="flex items-center gap-0.5 font-mono text-sm">
              <input
                type="number"
                min="0"
                max="99"
                disabled={isLocked}
                value={d.h}
                oninput={(ev) => setDraft(e.id, 'h', (ev.currentTarget as HTMLInputElement).value)}
                onblur={() => commitDraft(e)}
                onkeydown={(ev) => onKeyDown(ev, e)}
                class="w-9 rounded border border-transparent bg-transparent px-1 py-0.5 text-right text-slate-800 hover:border-slate-200 focus:border-brand-500 focus:bg-white focus:outline-none disabled:text-slate-500"
                aria-label="Hours"
              />
              <span class="text-slate-400">h</span>
              <input
                type="number"
                min="0"
                max="59"
                disabled={isLocked}
                value={d.m}
                oninput={(ev) => setDraft(e.id, 'm', (ev.currentTarget as HTMLInputElement).value)}
                onblur={() => commitDraft(e)}
                onkeydown={(ev) => onKeyDown(ev, e)}
                class="w-9 rounded border border-transparent bg-transparent px-1 py-0.5 text-right text-slate-800 hover:border-slate-200 focus:border-brand-500 focus:bg-white focus:outline-none disabled:text-slate-500"
                aria-label="Minutes"
              />
              <span class="text-slate-400">m</span>
            </div>

            <!-- Play / Pause -->
            <button
              type="button"
              disabled={isLocked || (!isRunning && !!timer.running)}
              onclick={() => toggleEntry(e)}
              class="flex h-7 w-7 shrink-0 items-center justify-center rounded-full
                {isRunning
                  ? 'bg-brand-500 text-white hover:bg-brand-600'
                  : 'border border-slate-300 text-brand-700 hover:border-brand-500 hover:bg-brand-50 disabled:opacity-30'}"
              aria-label={isRunning ? 'Pause timer' : 'Start timer'}
            >
              <span
                class={isRunning ? 'icon-[ph--pause-fill]' : 'icon-[ph--play-fill]'}
                aria-hidden="true"
              ></span>
            </button>
          </li>
        {/each}
      </ul>
    {/if}
  </div>

  <!-- Footer toolbar -->
  <footer class="relative flex items-center justify-between border-t border-slate-200 px-4 py-2">
    <button
      type="button"
      class="flex items-center gap-1 rounded px-1.5 py-1 text-xs text-slate-500 hover:bg-slate-50 hover:text-brand-700"
      onclick={() => (pickerOpen ? closePicker() : openPicker())}
      title="Start a new timer on a project"
      aria-haspopup="listbox"
      aria-expanded={pickerOpen}
    >
      <span class="icon-[ph--plus]" aria-hidden="true"></span>
      New
    </button>
    <div class="flex items-center gap-0.5">
      <button
        type="button"
        class="flex items-center gap-1 rounded px-1.5 py-1 text-xs text-slate-500 hover:bg-slate-50 hover:text-brand-700"
        onclick={openMainApp}
        title="Open the full TimeBill app"
      >
        <span class="icon-[ph--app-window-duotone]" aria-hidden="true"></span>
      </button>
      <button
        type="button"
        class="flex h-7 w-7 items-center justify-center rounded text-slate-500 hover:bg-slate-50 hover:text-brand-700"
        onclick={() => (settingsOpen = true)}
        title="Settings"
        aria-label="Settings"
      >
        <span class="icon-[ph--gear-duotone]" aria-hidden="true"></span>
      </button>
    </div>

    {#if pickerOpen}
      <!-- Click-shield: closes the picker if the user clicks anywhere
           outside the popover itself. -->
      <button
        type="button"
        class="fixed inset-0 z-30 cursor-default bg-transparent"
        aria-label="Close project picker"
        onclick={closePicker}
      ></button>
      <div
        class="absolute bottom-full left-2 z-40 mb-2 w-72 overflow-hidden rounded-lg border border-slate-200 bg-white shadow-lg"
        role="listbox"
        aria-label="Pick a project to start"
      >
        <div class="border-b border-slate-100 px-2 py-1.5">
          <input
            bind:this={pickerInputEl}
            bind:value={pickerQuery}
            onkeydown={onPickerKey}
            placeholder="Search client or project…"
            class="w-full rounded px-2 py-1 text-sm focus:outline-none"
          />
        </div>
        <div class="menubar-scroll max-h-64 overflow-auto py-1">
          {#if !projectsLoaded}
            <div class="px-3 py-4 text-center text-xs text-slate-500">Loading…</div>
          {:else if pickerFlat.length === 0}
            <div class="px-3 py-4 text-center text-xs text-slate-500">No matching projects.</div>
          {:else}
            {#each projectGroups as g (g.clientId)}
              <div class="px-3 pt-2 pb-1 text-[10px] uppercase tracking-wider text-slate-500">
                {g.clientName}
              </div>
              {#each g.projects as p (p.id)}
                {@const isHi = p.id === pickerHighlightId}
                {@const isLast = p.id === lastUsedProjectId}
                <button
                  type="button"
                  role="option"
                  aria-selected={isHi}
                  onmouseenter={() => (pickerHighlightId = p.id)}
                  onclick={() => startOnProject(p.id)}
                  class="flex w-full items-center gap-2 px-3 py-1.5 text-left text-sm
                    {isHi ? 'bg-brand-50 text-brand-800' : 'text-slate-800 hover:bg-slate-50'}"
                >
                  <span
                    class="h-2 w-2 shrink-0 rounded-full"
                    style:background-color={p.color ?? '#94a3b8'}
                  ></span>
                  <span class="flex-1 truncate">{p.name}</span>
                  {#if isLast}
                    <span class="text-[10px] text-slate-400">last used</span>
                  {/if}
                </button>
              {/each}
            {/each}
          {/if}
        </div>
        <div class="border-t border-slate-100 px-3 py-1.5 text-[10px] text-slate-500">
          ↑↓ to navigate · Enter to start · Esc to close
        </div>
      </div>
    {/if}
  </footer>

  {#if settingsOpen}
    <div class="fixed inset-0 z-50 flex flex-col bg-white">
      <header class="bg-brand-800 px-4 py-3 text-white">
        <div class="flex items-center gap-2 text-sm">
          <button
            class="flex h-6 w-6 items-center justify-center rounded-full hover:bg-white/10"
            onclick={() => (settingsOpen = false)}
            aria-label="Back"
          >‹</button>
          <span class="font-medium">Settings</span>
        </div>
      </header>

      <div class="menubar-scroll flex-1 overflow-auto p-4">
        <div class="space-y-5">
          <div>
            <label class="mb-1 block text-xs font-medium text-slate-700">Server URL</label>
            <div class="flex gap-2">
              <input
                type="url"
                bind:value={urlDraft}
                placeholder="http://..."
                class="min-w-0 flex-1 rounded border border-slate-300 px-2 py-1.5 text-xs focus:border-brand-500 focus:outline-none"
              />
              <button
                type="button"
                onclick={saveUrl}
                class="shrink-0 rounded bg-brand-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-brand-700"
              >Save</button>
            </div>
            {#if hasUrlOverride}
              <button
                type="button"
                onclick={clearUrl}
                class="mt-1.5 text-xs text-slate-400 hover:text-slate-600"
              >Reset to default</button>
            {/if}
          </div>

          <hr class="border-slate-100" />

          <div class="flex items-center justify-between">
            <button
              type="button"
              onclick={signOut}
              class="flex items-center gap-1.5 rounded px-2 py-1.5 text-sm text-red-600 hover:bg-red-50"
            >
              <span class="icon-[ph--sign-out-duotone]" aria-hidden="true"></span>
              Sign out
            </button>
            <button
              type="button"
              onclick={quitApp}
              class="flex items-center gap-1.5 rounded px-2 py-1.5 text-sm text-slate-500 hover:bg-slate-50"
            >
              <span class="icon-[ph--x-circle-duotone]" aria-hidden="true"></span>
              Quit
            </button>
          </div>
        </div>
      </div>

      <footer class="border-t border-slate-200 px-4 py-2 text-center text-[11px] text-slate-400">
        TimeBill {appVersion}
      </footer>
    </div>
  {/if}
</div>

<style>
  /* Window is transparent + decorations:false in Tauri; let the desktop
     show through outside the rounded card so the corners visually clip. */
  :global(html),
  :global(body) {
    background: transparent !important;
    /* Native-app feel: no text-cursor on labels/buttons. Inputs opt back
       in via the rule below. */
    -webkit-user-select: none;
    user-select: none;
    /* Pin the popover. The chrome itself never scrolls — only the entries
       list and the picker dropdown's body do. Disables the rubber-band
       bounce that would otherwise reveal the desktop behind the popover. */
    overflow: hidden;
    overscroll-behavior: none;
    height: 100%;
    margin: 0;
  }
  /* Restore standard text input behaviour (selection, caret) — without
     this, triple-click-to-replace and search typing feel broken. */
  :global(input),
  :global(textarea) {
    -webkit-user-select: text;
    user-select: text;
  }
  /* Any inner scroll container must contain its overscroll so the wheel
     event doesn't propagate to the parent (and the rubber band doesn't
     bounce the whole popover). */
  :global(.menubar-scroll) {
    overscroll-behavior: contain;
  }
  /* Hide the spin buttons on the inline number inputs (they're tiny). */
  input[type='number']::-webkit-inner-spin-button,
  input[type='number']::-webkit-outer-spin-button {
    -webkit-appearance: none;
    margin: 0;
  }
  input[type='number'] {
    -moz-appearance: textfield;
    appearance: textfield;
  }
  /* Just the hands spin — face stays still. */
  .clock-hand {
    transform-origin: 12px 12px;
    animation: clock-hand-spin linear infinite;
  }
  .clock-hand--minute {
    animation-duration: 3s;
  }
  .clock-hand--hour {
    animation-duration: 36s;
  }
  @keyframes clock-hand-spin {
    to {
      transform: rotate(360deg);
    }
  }
</style>
