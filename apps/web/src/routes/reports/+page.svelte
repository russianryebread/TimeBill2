<script lang="ts">
  import { onMount } from 'svelte';
  import { goto } from '$app/navigation';
  import { page } from '$app/stores';
  import { pb, toPbDate } from '$lib/pb';
  import { workspace } from '$lib/workspace.svelte';
  import { formatUSD, formatHours, hoursDecimal } from '@timebill/shared/money';

  type Entry = {
    id: string;
    started_at: string;
    ended_at: string;
    description: string;
    billable: boolean;
    rate_cents_snapshot: number | null;
    project: string;
    expand?: {
      project?: { id: string; name: string; color: string; client: string; expand?: { client?: { id: string; name: string } } };
    };
  };
  type Expense = { id: string; date: string; amount_cents: number; billable: boolean; description: string; vendor: string; expand?: { category?: { name: string; schedule_c_line: string } } };
  type Mileage = { id: string; date: string; miles: number; rate_cents_snapshot: number; billable: boolean; purpose: string };
  type Invoice = { id: string; number: string; issue_date: string; due_date: string; status: string; total_cents: number; expand?: { client?: { name: string } } };
  type Payment = { id: string; date: string; amount_cents: number; method: string; invoice: string };

  // Initial month/year come from `?ym=YYYY-MM` if present in the URL,
  // otherwise default to the current month. Keeps reports shareable as
  // links — paste a URL, land on the same month another teammate is
  // looking at.
  function parseYm(s: string | null): { y: number; m: number } | null {
    if (!s) return null;
    const m = /^(\d{4})-(\d{1,2})$/.exec(s);
    if (!m) return null;
    const y = Number(m[1]);
    const mo = Number(m[2]) - 1;
    if (mo < 0 || mo > 11) return null;
    return { y, m: mo };
  }
  function ymFromUrl(): { y: number; m: number } {
    const fromUrl = typeof window !== 'undefined' ? parseYm(new URLSearchParams(window.location.search).get('ym')) : null;
    if (fromUrl) return fromUrl;
    const now = new Date();
    return { y: now.getFullYear(), m: now.getMonth() };
  }
  const initial = ymFromUrl();
  let year = $state(initial.y);
  let month = $state(initial.m); // 0-11

  // Write the current selection back to the URL whenever it changes so
  // a back/forward arrow or a copy-link reflects what the user is
  // looking at. `replaceState` keeps history clean (we're not adding a
  // new entry per month-bump).
  $effect(() => {
    if (typeof window === 'undefined') return;
    const want = `${year}-${String(month + 1).padStart(2, '0')}`;
    const have = new URLSearchParams(window.location.search).get('ym');
    if (have === want) return;
    const url = new URL(window.location.href);
    url.searchParams.set('ym', want);
    goto(url.pathname + url.search, { replaceState: true, keepFocus: true, noScroll: true });
  });

  function bumpMonth(delta: number) {
    let m = month + delta;
    let y = year;
    while (m < 0) {
      m += 12;
      y -= 1;
    }
    while (m > 11) {
      m -= 12;
      y += 1;
    }
    month = m;
    year = y;
  }
  let entries = $state<Entry[]>([]);
  let yearEntries = $state<Entry[]>([]);
  let loading = $state(true);

  let csvStatus = $state('');

  function startOfMonth(y: number, m: number): Date {
    return new Date(y, m, 1, 0, 0, 0, 0);
  }
  function endOfMonth(y: number, m: number): Date {
    return new Date(y, m + 1, 1, 0, 0, 0, 0);
  }
  function sameDay(a: Date, b: Date) {
    return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
  }
  function durationMs(e: Entry): number {
    return Math.max(0, new Date(e.ended_at).getTime() - new Date(e.started_at).getTime());
  }

  async function load() {
    if (!workspace.current) return;
    loading = true;
    try {
      const wsId = workspace.current.id;
      const [monthStart, monthEnd] = [startOfMonth(year, month), endOfMonth(year, month)];
      const [yearStart, yearEnd] = [new Date(year, 0, 1), new Date(year + 1, 0, 1)];

      const [m, y] = await Promise.all([
        pb.collection('time_entries').getFullList({
          filter: `workspace = "${wsId}" && started_at >= "${toPbDate(monthStart)}" && started_at < "${toPbDate(monthEnd)}" && ended_at != ""`,
          sort: 'started_at',
          expand: 'project,project.client'
        }),
        pb.collection('time_entries').getFullList({
          filter: `workspace = "${wsId}" && started_at >= "${toPbDate(yearStart)}" && started_at < "${toPbDate(yearEnd)}" && ended_at != ""`,
          sort: 'started_at'
        })
      ]);
      entries = m as unknown as Entry[];
      yearEntries = y as unknown as Entry[];
    } finally {
      loading = false;
    }
  }

  // ----- Aggregations -----

  let monthTotalMs = $derived(entries.reduce((s, e) => s + durationMs(e), 0));
  let monthBillableCents = $derived(
    entries
      .filter((e) => e.billable && e.rate_cents_snapshot)
      .reduce((s, e) => s + Math.round((e.rate_cents_snapshot! * durationMs(e)) / 3_600_000), 0)
  );

  type DayCell = { date: Date; ms: number; inYear: boolean };

  // ----- GitHub-style year heatmap -----
  //
  // 7 rows (Mon→Sun, top→bottom) × however-many weeks (~52-54) fit the
  // selected year. The grid starts on the Monday on/before Jan 1 and
  // ends on the Sunday on/after Dec 31 so each column is a complete week.
  // Cells outside the year are still rendered (greyed) so the grid is
  // a clean rectangle.
  let yearHeatmap = $derived.by(() => {
    const totals = new Map<string, number>(); // yyyy-mm-dd → ms
    for (const e of yearEntries) {
      const d = new Date(e.started_at);
      const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
      totals.set(key, (totals.get(key) || 0) + durationMs(e));
    }
    const yearStart = new Date(year, 0, 1);
    const yearEnd = new Date(year, 11, 31);
    const startOffset = (yearStart.getDay() + 6) % 7; // 0 = Mon
    const endOffset = (7 - (((yearEnd.getDay() + 6) % 7) + 1)) % 7;
    const gridStart = new Date(year, 0, 1 - startOffset);
    const gridEnd = new Date(year, 11, 31 + endOffset);
    const days = Math.round((gridEnd.getTime() - gridStart.getTime()) / 86_400_000) + 1;
    const cells: DayCell[] = [];
    for (let i = 0; i < days; i++) {
      const d = new Date(gridStart);
      d.setDate(gridStart.getDate() + i);
      const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
      cells.push({ date: d, ms: totals.get(key) || 0, inYear: d.getFullYear() === year });
    }
    return cells;
  });

  let heatmapWeeks = $derived(yearHeatmap.length / 7);

  // GitHub-style green ramp (light → dark). Fixed thresholds instead of
  // percent-of-max so the colors mean the same thing day to day:
  // 0h, <2h, <4h, <6h, ≥6h.
  function heatmapColor(ms: number): string {
    if (ms <= 0) return '#ebedf0';
    const h = ms / 3_600_000;
    if (h < 2) return '#9be9a8';
    if (h < 4) return '#40c463';
    if (h < 6) return '#30a14e';
    return '#216e39';
  }

  // Month labels above the heatmap — show the abbreviation in the column
  // where the first cell of each month lands. Only label a month if it
  // has at least 3 weeks of room to the next (avoids overlap on partial
  // months at the very start of the grid).
  let heatmapMonthLabels = $derived.by(() => {
    const seen = new Set<number>();
    const labels: { month: number; col: number }[] = [];
    for (let i = 0; i < yearHeatmap.length; i++) {
      const c = yearHeatmap[i]!;
      if (!c.inYear) continue;
      const m = c.date.getMonth();
      if (seen.has(m)) continue;
      seen.add(m);
      labels.push({ month: m, col: Math.floor(i / 7) });
    }
    return labels;
  });

  // Used by the "Active days" summary card — count days in the selected
  // month that had any tracked time.
  let activeDaysInMonth = $derived(
    yearHeatmap.filter(
      (c) => c.inYear && c.date.getMonth() === month && c.ms > 0
    ).length
  );

  // Small per-month calendar (right column of the heatmap section). 6×7
  // Monday-start grid for the selected month; reuses the same fixed
  // hour-threshold color ramp as the year heatmap so the two read the
  // same. Days outside the selected month render dimmed.
  type MonthCell = { date: Date; ms: number; inMonth: boolean };
  let monthCalendar = $derived.by(() => {
    const first = startOfMonth(year, month);
    const last = new Date(year, month + 1, 0);
    const offset = (first.getDay() + 6) % 7; // 0 = Mon
    const totalCells = Math.ceil((offset + last.getDate()) / 7) * 7;
    const totals = new Map<string, number>();
    for (const e of entries) {
      const d = new Date(e.started_at);
      const key = `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
      totals.set(key, (totals.get(key) || 0) + durationMs(e));
    }
    const cells: MonthCell[] = [];
    for (let i = 0; i < totalCells; i++) {
      const d = new Date(year, month, i - offset + 1);
      const key = `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
      cells.push({ date: d, ms: totals.get(key) || 0, inMonth: d.getMonth() === month });
    }
    return cells;
  });

  function shortDate(d: Date): string {
    return d.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' });
  }

  type ProjBreak = {
    id: string;
    name: string;
    color: string;
    clientName: string;
    ms: number;
    billableCents: number;
  };
  let projectBreakdown = $derived.by(() => {
    const map = new Map<string, ProjBreak>();
    for (const e of entries) {
      const p = e.expand?.project;
      if (!p) continue;
      const key = p.id;
      const existing = map.get(key);
      const ms = durationMs(e);
      const cents =
        e.billable && e.rate_cents_snapshot
          ? Math.round((e.rate_cents_snapshot * ms) / 3_600_000)
          : 0;
      if (existing) {
        existing.ms += ms;
        existing.billableCents += cents;
      } else {
        map.set(key, {
          id: p.id,
          name: p.name,
          color: p.color,
          clientName: p.expand?.client?.name ?? '—',
          ms,
          billableCents: cents
        });
      }
    }
    return Array.from(map.values()).sort((a, b) => b.ms - a.ms);
  });

  type ClientBreak = { id: string; name: string; ms: number; billableCents: number };
  let clientBreakdown = $derived.by(() => {
    const map = new Map<string, ClientBreak>();
    for (const e of entries) {
      const c = e.expand?.project?.expand?.client;
      if (!c) continue;
      const ms = durationMs(e);
      const cents =
        e.billable && e.rate_cents_snapshot
          ? Math.round((e.rate_cents_snapshot * ms) / 3_600_000)
          : 0;
      const existing = map.get(c.id);
      if (existing) {
        existing.ms += ms;
        existing.billableCents += cents;
      } else {
        map.set(c.id, { id: c.id, name: c.name, ms, billableCents: cents });
      }
    }
    return Array.from(map.values()).sort((a, b) => b.ms - a.ms);
  });

  // Donut for project breakdown
  type DonutSeg = { color: string; pct: number; startAngle: number; endAngle: number };
  let donutSegments = $derived.by(() => {
    const total = projectBreakdown.reduce((s, p) => s + p.ms, 0);
    if (total <= 0) return [] as DonutSeg[];
    let angle = -90; // start at top
    return projectBreakdown.map((p) => {
      const pct = p.ms / total;
      const sweep = pct * 360;
      const seg: DonutSeg = {
        color: p.color,
        pct,
        startAngle: angle,
        endAngle: angle + sweep
      };
      angle += sweep;
      return seg;
    });
  });

  function arcPath(seg: DonutSeg, cx: number, cy: number, r: number, ri: number): string {
    const toRad = (deg: number) => (deg * Math.PI) / 180;
    const a0 = toRad(seg.startAngle);
    const a1 = toRad(seg.endAngle);
    const x0 = cx + r * Math.cos(a0);
    const y0 = cy + r * Math.sin(a0);
    const x1 = cx + r * Math.cos(a1);
    const y1 = cy + r * Math.sin(a1);
    const xi0 = cx + ri * Math.cos(a0);
    const yi0 = cy + ri * Math.sin(a0);
    const xi1 = cx + ri * Math.cos(a1);
    const yi1 = cy + ri * Math.sin(a1);
    const large = seg.endAngle - seg.startAngle > 180 ? 1 : 0;
    return `M ${x0} ${y0} A ${r} ${r} 0 ${large} 1 ${x1} ${y1} L ${xi1} ${yi1} A ${ri} ${ri} 0 ${large} 0 ${xi0} ${yi0} Z`;
  }

  // Year overview: 12 months
  let yearOverview = $derived.by(() => {
    const months = Array.from({ length: 12 }, () => ({ ms: 0, billableCents: 0 }));
    for (const e of yearEntries) {
      const m = new Date(e.started_at).getMonth();
      const ms = durationMs(e);
      months[m]!.ms += ms;
      if (e.billable && e.rate_cents_snapshot) {
        months[m]!.billableCents += Math.round((e.rate_cents_snapshot * ms) / 3_600_000);
      }
    }
    return months;
  });
  let yearMaxMs = $derived(Math.max(1, ...yearOverview.map((m) => m.ms)));

  // ----- CSV exports -----

  function escapeCsv(v: unknown): string {
    if (v === null || v === undefined) return '';
    const s = String(v);
    if (/[",\n]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
    return s;
  }
  function downloadCsv(filename: string, rows: (string | number | null | undefined)[][]) {
    const csv = rows.map((r) => r.map(escapeCsv).join(',')).join('\n');
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    a.click();
    URL.revokeObjectURL(url);
  }

  async function exportTimeCsv() {
    csvStatus = 'Exporting time…';
    const rows: (string | number | null | undefined)[][] = [
      ['Date', 'Start', 'End', 'Hours', 'Client', 'Project', 'Description', 'Billable', 'Rate ($/hr)', 'Amount ($)']
    ];
    for (const e of yearEntries) {
      const ws = workspace.current!.id;
      const full = await pb.collection('time_entries').getOne(e.id, { expand: 'project,project.client,task' });
      void ws;
      const ms = new Date(full.ended_at).getTime() - new Date(full.started_at).getTime();
      const hrs = ms / 3_600_000;
      const start = new Date(full.started_at);
      const end = new Date(full.ended_at);
      const rate = (full.rate_cents_snapshot ?? 0) / 100;
      const amount = full.billable ? rate * hrs : 0;
      rows.push([
        start.toLocaleDateString('en-US'),
        start.toLocaleTimeString('en-US'),
        end.toLocaleTimeString('en-US'),
        hrs.toFixed(2),
        full.expand?.project?.expand?.client?.name ?? '',
        full.expand?.project?.name ?? '',
        full.description ?? '',
        full.billable ? 'Yes' : 'No',
        rate.toFixed(2),
        amount.toFixed(2)
      ]);
    }
    downloadCsv(`time-entries-${year}.csv`, rows);
    csvStatus = `Exported ${rows.length - 1} time entries.`;
  }

  async function exportExpensesCsv() {
    if (!workspace.current) return;
    csvStatus = 'Exporting expenses…';
    const yearStart = new Date(year, 0, 1);
    const yearEnd = new Date(year + 1, 0, 1);
    const exps = (await pb.collection('expenses').getFullList({
      filter: `workspace = "${workspace.current.id}" && date >= "${toPbDate(yearStart)}" && date < "${toPbDate(yearEnd)}"`,
      sort: 'date',
      expand: 'category,client'
    })) as unknown as Expense[];
    const rows: (string | number | null | undefined)[][] = [
      ['Date', 'Vendor', 'Description', 'Category', 'Schedule C Line', 'Amount ($)', 'Billable', 'Client']
    ];
    for (const e of exps) {
      rows.push([
        e.date.slice(0, 10),
        e.vendor ?? '',
        e.description ?? '',
        e.expand?.category?.name ?? '',
        e.expand?.category?.schedule_c_line ?? '',
        (e.amount_cents / 100).toFixed(2),
        e.billable ? 'Yes' : 'No',
        (e as any).expand?.client?.name ?? ''
      ]);
    }
    downloadCsv(`expenses-${year}.csv`, rows);
    csvStatus = `Exported ${rows.length - 1} expenses.`;
  }

  async function exportMileageCsv() {
    if (!workspace.current) return;
    csvStatus = 'Exporting mileage…';
    const yearStart = new Date(year, 0, 1);
    const yearEnd = new Date(year + 1, 0, 1);
    const ms = (await pb.collection('mileage_entries').getFullList({
      filter: `workspace = "${workspace.current.id}" && date >= "${toPbDate(yearStart)}" && date < "${toPbDate(yearEnd)}"`,
      sort: 'date',
      expand: 'client'
    })) as unknown as (Mileage & { expand?: { client?: { name: string } } })[];
    const rows: (string | number | null | undefined)[][] = [
      ['Date', 'Miles', 'Rate ($/mi)', 'Deduction ($)', 'Purpose', 'Billable', 'Client']
    ];
    for (const m of ms) {
      const rate = m.rate_cents_snapshot / 100;
      rows.push([
        m.date.slice(0, 10),
        m.miles.toFixed(1),
        rate.toFixed(2),
        (rate * m.miles).toFixed(2),
        m.purpose ?? '',
        m.billable ? 'Yes' : 'No',
        m.expand?.client?.name ?? ''
      ]);
    }
    downloadCsv(`mileage-${year}.csv`, rows);
    csvStatus = `Exported ${rows.length - 1} mileage entries.`;
  }

  async function exportInvoicesCsv() {
    if (!workspace.current) return;
    csvStatus = 'Exporting invoices…';
    const yearStart = new Date(year, 0, 1);
    const yearEnd = new Date(year + 1, 0, 1);
    const invs = (await pb.collection('invoices').getFullList({
      filter: `workspace = "${workspace.current.id}" && issue_date >= "${toPbDate(yearStart)}" && issue_date < "${toPbDate(yearEnd)}"`,
      sort: 'issue_date',
      expand: 'client'
    })) as unknown as Invoice[];
    const rows: (string | number | null | undefined)[][] = [
      ['Number', 'Client', 'Issued', 'Due', 'Status', 'Total ($)']
    ];
    for (const inv of invs) {
      rows.push([
        inv.number,
        inv.expand?.client?.name ?? '',
        inv.issue_date.slice(0, 10),
        inv.due_date.slice(0, 10),
        inv.status,
        (inv.total_cents / 100).toFixed(2)
      ]);
    }
    downloadCsv(`invoices-${year}.csv`, rows);
    csvStatus = `Exported ${rows.length - 1} invoices.`;
  }

  async function exportPaymentsCsv() {
    if (!workspace.current) return;
    csvStatus = 'Exporting payments…';
    const yearStart = new Date(year, 0, 1);
    const yearEnd = new Date(year + 1, 0, 1);
    const pays = (await pb.collection('payments').getFullList({
      filter: `workspace = "${workspace.current.id}" && date >= "${toPbDate(yearStart)}" && date < "${toPbDate(yearEnd)}"`,
      sort: 'date'
    })) as unknown as Payment[];
    const rows: (string | number | null | undefined)[][] = [
      ['Date', 'Invoice', 'Method', 'Amount ($)']
    ];
    for (const p of pays) {
      let invNumber = '';
      try {
        const inv = await pb.collection('invoices').getOne(p.invoice);
        invNumber = inv.number;
      } catch (_) {}
      rows.push([
        p.date.slice(0, 10),
        invNumber,
        p.method,
        (p.amount_cents / 100).toFixed(2)
      ]);
    }
    downloadCsv(`payments-${year}.csv`, rows);
    csvStatus = `Exported ${rows.length - 1} payments.`;
  }

  const MONTHS = [
    'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
    'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'
  ];
  const WEEK_LABELS = ['M', 'T', 'W', 'T', 'F', 'S', 'S'];

  function monthLabel(): string {
    return startOfMonth(year, month).toLocaleDateString('en-US', { month: 'long', year: 'numeric' });
  }

  onMount(load);
  $effect(() => {
    void year;
    void month;
    if (workspace.current) load();
  });
</script>

<div class="mx-auto max-w-8xl px-8 py-8">
  <div class="flex flex-wrap items-end justify-between gap-4">
    <div>
      <h1 class="text-2xl font-bold text-slate-900">Reports</h1>
      <p class="mt-1 text-sm text-slate-600">Where your time and money go.</p>
    </div>
    <div class="flex items-end gap-2">
      <button
        type="button"
        class="flex h-9 w-9 items-center justify-center rounded border border-slate-300 text-slate-600 hover:border-brand-500 hover:text-brand-700"
        onclick={() => bumpMonth(-1)}
        aria-label="Previous month"
      >
        <span class="icon-[ph--caret-left]" aria-hidden="true"></span>
      </button>
      <label class="block">
        <span class="text-xs text-slate-500">Month</span>
        <select
          bind:value={month}
          class="mt-1 rounded border border-slate-300 px-3 py-1.5 text-sm focus:border-brand-500 focus:outline-none"
        >
          {#each MONTHS as label, i}
            <option value={i}>{label}</option>
          {/each}
        </select>
      </label>
      <label class="block">
        <span class="text-xs text-slate-500">Year</span>
        <input
          type="number"
          bind:value={year}
          class="mt-1 w-24 rounded border border-slate-300 px-3 py-1.5 text-sm focus:border-brand-500 focus:outline-none"
        />
      </label>
      <button
        type="button"
        class="flex h-9 w-9 items-center justify-center rounded border border-slate-300 text-slate-600 hover:border-brand-500 hover:text-brand-700"
        onclick={() => bumpMonth(1)}
        aria-label="Next month"
      >
        <span class="icon-[ph--caret-right]" aria-hidden="true"></span>
      </button>
    </div>
  </div>

  <!-- Summary cards -->
  <section class="mt-6 grid gap-4 sm:grid-cols-3">
    <div class="rounded-xl border border-slate-200 bg-white p-5">
      <div class="text-xs uppercase tracking-wider text-slate-500">Hours · {monthLabel()}</div>
      <div class="mt-1 font-mono text-2xl font-semibold text-brand-800">{formatHours(monthTotalMs)}</div>
    </div>
    <div class="rounded-xl border border-slate-200 bg-white p-5">
      <div class="text-xs uppercase tracking-wider text-slate-500">Billable revenue</div>
      <div class="mt-1 font-mono text-2xl font-semibold text-brand-800">{formatUSD(monthBillableCents)}</div>
    </div>
    <div class="rounded-xl border border-slate-200 bg-white p-5">
      <div class="text-xs uppercase tracking-wider text-slate-500">Active days</div>
      <div class="mt-1 font-mono text-2xl font-semibold text-brand-800">
        {activeDaysInMonth}
      </div>
    </div>
  </section>

  <!-- Heatmap: year (GitHub-style contributions) on the left,
       focused month calendar on the right (same color ramp). -->
  <section class="mt-6 grid gap-4 lg:grid-cols-3">
    <div class="rounded-xl border border-slate-200 bg-white p-5 lg:col-span-2">
      <div class="mb-3 flex items-center justify-between">
        <h2 class="text-sm font-medium text-slate-700">Daily hours · {year}</h2>
        <div class="flex items-center gap-1 text-[10px] uppercase tracking-wider text-slate-500">
          <span>less</span>
          <span class="h-2.5 w-2.5 rounded-sm" style:background-color="#ebedf0"></span>
          <span class="h-2.5 w-2.5 rounded-sm" style:background-color="#9be9a8"></span>
          <span class="h-2.5 w-2.5 rounded-sm" style:background-color="#40c463"></span>
          <span class="h-2.5 w-2.5 rounded-sm" style:background-color="#30a14e"></span>
          <span class="h-2.5 w-2.5 rounded-sm" style:background-color="#216e39"></span>
          <span>more</span>
        </div>
      </div>
      <div class="overflow-x-auto">
        <div class="inline-flex gap-2">
          <!-- Mon/Wed/Fri labels in the left margin -->
          <div class="grid grid-rows-7 gap-[2px] pt-[14px] text-[9px] text-slate-400">
            <span></span>
            <span>Mon</span>
            <span></span>
            <span>Wed</span>
            <span></span>
            <span>Fri</span>
            <span></span>
          </div>
          <div>
            <!-- Month labels above the grid -->
            <div
              class="relative mb-[2px] h-3 text-[9px] uppercase tracking-wider text-slate-500"
              style:width="{heatmapWeeks * 13}px"
            >
              {#each heatmapMonthLabels as lbl}
                <span class="absolute" style:left="{lbl.col * 13}px">{MONTHS[lbl.month]}</span>
              {/each}
            </div>
            <!-- The cells: 7 rows × N columns, column-major fill order. -->
            <div
              class="grid grid-rows-7 gap-[2px]"
              style:grid-auto-flow="column"
              style:grid-auto-columns="11px"
            >
              {#each yearHeatmap as cell}
                <span
                  class="h-[11px] w-[11px] rounded-sm {cell.inYear ? '' : 'opacity-30'}"
                  style:background-color={heatmapColor(cell.ms)}
                  title={`${shortDate(cell.date)} — ${cell.ms > 0 ? formatHours(cell.ms) + ' tracked' : 'no time tracked'}`}
                ></span>
              {/each}
            </div>
          </div>
        </div>
      </div>
    </div>

    <!-- Focused month mini-calendar — full day grid for the selected
         month, using the same hour-threshold color ramp. -->
    <div class="rounded-xl border border-slate-200 bg-white p-5">
      <div class="mb-3 flex items-center justify-between">
        <h2 class="text-sm font-medium text-slate-700">{monthLabel()}</h2>
        <span class="font-mono text-xs text-slate-500">{formatHours(monthTotalMs)}</span>
      </div>
      <div class="grid grid-cols-7 gap-1 text-[10px]">
        {#each WEEK_LABELS as w}
          <div class="text-center uppercase tracking-wider text-slate-400">{w}</div>
        {/each}
        {#each monthCalendar as cell}
          <div
            class="flex aspect-square flex-col items-center justify-center rounded font-medium
              {cell.inMonth ? 'text-slate-700' : 'text-slate-300 opacity-50'}"
            style:background-color={cell.inMonth ? heatmapColor(cell.ms) : '#f8fafc'}
            title={`${shortDate(cell.date)} — ${cell.ms > 0 ? formatHours(cell.ms) + ' tracked' : 'no time tracked'}`}
          >
            <span class={cell.ms / 3_600_000 >= 4 && cell.inMonth ? 'text-white' : ''}>
              {cell.date.getDate()}
            </span>
          </div>
        {/each}
      </div>
    </div>
  </section>

  <!-- Project breakdown -->
  <section class="mt-6 grid gap-6 lg:grid-cols-5">
    <div class="rounded-xl border border-slate-200 bg-white p-5 lg:col-span-2">
      <h2 class="text-sm font-medium text-slate-700">Project mix · {monthLabel()}</h2>
      {#if projectBreakdown.length === 0}
        <div class="flex h-48 items-center justify-center text-xs text-slate-400">
          No time tracked.
        </div>
      {:else}
        <div class="mt-2 flex items-center justify-center">
          <svg viewBox="0 0 200 200" class="h-44 w-44">
            {#each donutSegments as seg, i (i)}
              <path d={arcPath(seg, 100, 100, 90, 55)} fill={seg.color} />
            {/each}
            <text x="100" y="95" text-anchor="middle" class="fill-slate-500 text-[12px] font-medium">{formatHours(monthTotalMs)}</text>
            <text x="100" y="112" text-anchor="middle" class="fill-slate-400 text-[10px]">total</text>
          </svg>
        </div>
      {/if}
    </div>
    <div class="overflow-hidden rounded-xl border border-slate-200 bg-white lg:col-span-3">
      {#if projectBreakdown.length === 0}
        <div class="flex h-48 items-center justify-center text-xs text-slate-400">
          No time tracked this month.
        </div>
      {:else}
        <table class="w-full text-sm">
          <thead class="border-b border-slate-100 bg-slate-50 text-left text-xs uppercase tracking-wider text-slate-500">
            <tr>
              <th class="px-5 py-2 font-medium">Project</th>
              <th class="px-3 py-2 text-right font-medium">Hours</th>
              <th class="px-3 py-2 text-right font-medium">Billable</th>
            </tr>
          </thead>
          <tbody>
            {#each projectBreakdown as p (p.id)}
              <tr class="border-b border-slate-100 last:border-0">
                <td class="px-5 py-2">
                  <span class="flex items-center gap-2">
                    <span class="inline-block h-3 w-3 rounded-full" style:background-color={p.color}></span>
                    <span class="font-medium text-slate-900">{p.name}</span>
                    <span class="text-xs text-slate-500">· {p.clientName}</span>
                  </span>
                </td>
                <td class="px-3 py-2 text-right font-mono text-slate-800">{formatHours(p.ms)}</td>
                <td class="px-3 py-2 text-right font-mono text-slate-800">{formatUSD(p.billableCents)}</td>
              </tr>
            {/each}
          </tbody>
        </table>
      {/if}
    </div>
  </section>

  <!-- Client breakdown -->
  <section class="mt-6 overflow-hidden rounded-xl border border-slate-200 bg-white">
    <div class="border-b border-slate-100 px-5 py-3 text-sm font-medium text-slate-700">
      Clients · {monthLabel()}
    </div>
    {#if clientBreakdown.length === 0}
      <div class="px-5 py-6 text-center text-xs text-slate-400">No time tracked.</div>
    {:else}
      <table class="w-full text-sm">
        <thead class="border-b border-slate-100 bg-slate-50 text-left text-xs uppercase tracking-wider text-slate-500">
          <tr>
            <th class="px-5 py-2 font-medium">Client</th>
            <th class="px-3 py-2 text-right font-medium">Hours</th>
            <th class="px-3 py-2 text-right font-medium">Billable</th>
            <th class="px-5 py-2 font-medium">Share</th>
          </tr>
        </thead>
        <tbody>
          {#each clientBreakdown as c (c.id)}
            <tr class="border-b border-slate-100 last:border-0">
              <td class="px-5 py-2 font-medium text-slate-900">{c.name}</td>
              <td class="px-3 py-2 text-right font-mono text-slate-800">{formatHours(c.ms)}</td>
              <td class="px-3 py-2 text-right font-mono text-slate-800">{formatUSD(c.billableCents)}</td>
              <td class="px-5 py-2">
                <div class="h-2 w-full rounded-full bg-slate-100">
                  <div
                    class="h-2 rounded-full bg-brand-500"
                    style:width="{monthTotalMs > 0 ? (c.ms / monthTotalMs) * 100 : 0}%"
                  ></div>
                </div>
              </td>
            </tr>
          {/each}
        </tbody>
      </table>
    {/if}
  </section>

  <!-- Year overview -->
  <section class="mt-6 rounded-xl border border-slate-200 bg-white p-5">
    <h2 class="text-sm font-medium text-slate-700">{year} hours by month</h2>
    <div class="mt-4 flex gap-2">
      {#each yearOverview as m, i}
        {@const heightPct = yearMaxMs > 0 ? (m.ms / yearMaxMs) * 100 : 0}
        <button
          class="group flex flex-1 flex-col items-center gap-1"
          onclick={() => (month = i)}
          aria-label={`Switch to ${MONTHS[i]}`}
        >
          <span class="font-mono text-[10px] text-slate-500 opacity-0 group-hover:opacity-100">
            {formatHours(m.ms)}
          </span>
          <div class="flex h-32 w-full items-end">
            <div
              class="w-full rounded-t transition
                {i === month ? 'bg-brand-800' : 'bg-brand-400 hover:bg-brand-500'}"
              style:height="{Math.max(heightPct, m.ms > 0 ? 4 : 0)}%"
            ></div>
          </div>
          <span class="text-[10px] text-slate-500">{MONTHS[i]}</span>
        </button>
      {/each}
    </div>
  </section>

  <!-- CSV exports -->
  <section class="mt-6 rounded-xl border border-slate-200 bg-white p-5">
    <h2 class="text-sm font-medium text-slate-700">CSV exports · {year}</h2>
    <p class="mt-1 text-xs text-slate-500">Drop into TurboTax, your accountant's workflow, or any spreadsheet.</p>
    <div class="mt-3 flex flex-wrap gap-2">
      <button class="rounded border border-slate-300 bg-white px-3 py-1.5 text-sm font-medium text-slate-700 hover:bg-slate-50" onclick={exportTimeCsv}>
        <span class="icon-[ph--download-simple-duotone] mr-1 text-base" aria-hidden="true"></span>
        Time entries
      </button>
      <button class="rounded border border-slate-300 bg-white px-3 py-1.5 text-sm font-medium text-slate-700 hover:bg-slate-50" onclick={exportExpensesCsv}>
        <span class="icon-[ph--download-simple-duotone] mr-1 text-base" aria-hidden="true"></span>
        Expenses
      </button>
      <button class="rounded border border-slate-300 bg-white px-3 py-1.5 text-sm font-medium text-slate-700 hover:bg-slate-50" onclick={exportMileageCsv}>
        <span class="icon-[ph--download-simple-duotone] mr-1 text-base" aria-hidden="true"></span>
        Mileage
      </button>
      <button class="rounded border border-slate-300 bg-white px-3 py-1.5 text-sm font-medium text-slate-700 hover:bg-slate-50" onclick={exportInvoicesCsv}>
        <span class="icon-[ph--download-simple-duotone] mr-1 text-base" aria-hidden="true"></span>
        Invoices
      </button>
      <button class="rounded border border-slate-300 bg-white px-3 py-1.5 text-sm font-medium text-slate-700 hover:bg-slate-50" onclick={exportPaymentsCsv}>
        <span class="icon-[ph--download-simple-duotone] mr-1 text-base" aria-hidden="true"></span>
        Payments
      </button>
    </div>
    {#if csvStatus}
      <p class="mt-2 text-xs text-slate-500">{csvStatus}</p>
    {/if}
  </section>
</div>
