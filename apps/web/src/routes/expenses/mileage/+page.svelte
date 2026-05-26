<script lang="ts">
  import { onMount } from 'svelte';
  import { api } from '$lib/api';
  import { workspace } from '$lib/workspace.svelte';
  import { formatUSD } from '@timebill/shared/money';

  type ClientLite = { id: string; name: string };
  type ProjectLite = { id: string; name: string };
  type MileageRow = {
    id: string;
    date: string;
    miles: number;
    purpose: string;
    client: string | null;
    project: string | null;
    billable: boolean;
    rate_cents_snapshot: number;
    expand?: { client?: { name: string }; project?: { name: string } };
  };

  let entries = $state<MileageRow[]>([]);
  let clients = $state<ClientLite[]>([]);
  let projects = $state<ProjectLite[]>([]);
  let loading = $state(true);
  let error = $state('');
  let taxRate = $state(70);

  let year = $state(new Date().getFullYear());

  let form = $state({
    date: new Date().toISOString().slice(0, 10),
    miles: '',
    purpose: '',
    client: '',
    project: '',
    billable: false
  });

  async function load() {
    if (!workspace.current) return;
    loading = true;
    try {
      const from = `${year}-01-01`;
      const to = `${year + 1}-01-01`;
      const [m, cs, ps, ts] = await Promise.all([
        api.listMileage({ from, to }),
        api.listClients(),
        api.listProjects(),
        api.getTaxSettings()
      ]);
      entries = m as unknown as MileageRow[];
      clients = cs as unknown as ClientLite[];
      projects = ps as unknown as ProjectLite[];
      if (ts) taxRate = ts.mileage_rate_cents_per_mile ?? 70;
    } finally {
      loading = false;
    }
  }

  async function submit(e: SubmitEvent) {
    e.preventDefault();
    error = '';
    const miles = Number(form.miles);
    if (!miles || miles <= 0) {
      error = 'Miles must be a positive number';
      return;
    }
    try {
      await api.createMileage({
        date: form.date,
        miles,
        purpose: form.purpose,
        client: form.client || null,
        project: form.project || null,
        billable: form.billable
      });
      form = {
        date: new Date().toISOString().slice(0, 10),
        miles: '',
        purpose: '',
        client: '',
        project: '',
        billable: false
      };
      await load();
    } catch (err) {
      error = err instanceof Error ? err.message : 'Save failed';
    }
  }

  async function remove(x: MileageRow) {
    if (!confirm(`Delete this ${x.miles}-mile entry?`)) return;
    await api.deleteMileage(x.id);
    await load();
  }

  let totalMiles = $derived(entries.reduce((sum, e) => sum + e.miles, 0));
  let totalDeductionCents = $derived(
    entries.reduce((sum, e) => sum + Math.round(e.miles * e.rate_cents_snapshot), 0)
  );
  let billableMiles = $derived(
    entries.filter((e) => e.billable).reduce((sum, e) => sum + e.miles, 0)
  );

  function fmtDate(s: string): string {
    const ymd = s.slice(0, 10).split('-').map(Number);
    if (ymd.length === 3 && !ymd.some(Number.isNaN)) {
      const [y, m, d] = ymd as [number, number, number];
      return new Date(y, m - 1, d).toLocaleDateString('en-US', {
        month: 'short',
        day: 'numeric'
      });
    }
    return new Date(s).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
  }

  onMount(load);

  $effect(() => {
    void year;
    if (workspace.current) load();
  });
</script>

<div class="flex items-end justify-between">
  <label class="block">
    <span class="text-xs text-slate-500">Year</span>
    <input
      type="number"
      bind:value={year}
      class="mt-1 w-24 rounded border border-slate-300 px-3 py-2 text-sm focus:border-brand-500 focus:outline-none"
    />
  </label>
  <div class="text-xs text-slate-500">
    Current IRS rate: <span class="font-mono font-medium text-slate-700">{(taxRate / 100).toFixed(2)}¢/mi</span>
    · adjust in
    <a href="/settings/tasks" class="text-brand-600 hover:underline">Settings</a>
  </div>
</div>

<div class="mt-4 grid gap-3 sm:grid-cols-3">
  <div class="rounded-lg border border-slate-200 bg-white p-4">
    <div class="text-xs uppercase tracking-wider text-slate-500">YTD miles</div>
    <div class="mt-1 font-mono text-2xl font-semibold text-brand-800">{totalMiles.toFixed(1)}</div>
  </div>
  <div class="rounded-lg border border-slate-200 bg-white p-4">
    <div class="text-xs uppercase tracking-wider text-slate-500">YTD deduction</div>
    <div class="mt-1 font-mono text-2xl font-semibold text-brand-800">{formatUSD(totalDeductionCents)}</div>
  </div>
  <div class="rounded-lg border border-slate-200 bg-white p-4">
    <div class="text-xs uppercase tracking-wider text-slate-500">Billable miles</div>
    <div class="mt-1 font-mono text-2xl font-semibold text-brand-800">{billableMiles.toFixed(1)}</div>
  </div>
</div>

<form
  onsubmit={submit}
  class="mt-6 grid grid-cols-12 gap-3 rounded-xl border border-slate-200 bg-white p-5"
>
  <label class="col-span-3">
    <span class="text-xs text-slate-500">Date</span>
    <input
      type="date"
      required
      bind:value={form.date}
      class="mt-1 w-full rounded border border-slate-300 px-3 py-2 text-sm focus:border-brand-500 focus:outline-none"
    />
  </label>
  <label class="col-span-2">
    <span class="text-xs text-slate-500">Miles</span>
    <input
      inputmode="decimal"
      required
      placeholder="0"
      bind:value={form.miles}
      class="mt-1 w-full rounded border border-slate-300 px-3 py-2 text-sm focus:border-brand-500 focus:outline-none"
    />
  </label>
  <label class="col-span-7">
    <span class="text-xs text-slate-500">Purpose</span>
    <input
      placeholder="e.g. Client site visit"
      bind:value={form.purpose}
      class="mt-1 w-full rounded border border-slate-300 px-3 py-2 text-sm focus:border-brand-500 focus:outline-none"
    />
  </label>

  <label class="col-span-4">
    <span class="text-xs text-slate-500">Client</span>
    <select
      bind:value={form.client}
      class="mt-1 w-full rounded border border-slate-300 px-3 py-2 text-sm focus:border-brand-500 focus:outline-none"
    >
      <option value="">—</option>
      {#each clients as c}<option value={c.id}>{c.name}</option>{/each}
    </select>
  </label>
  <label class="col-span-4">
    <span class="text-xs text-slate-500">Project</span>
    <select
      bind:value={form.project}
      class="mt-1 w-full rounded border border-slate-300 px-3 py-2 text-sm focus:border-brand-500 focus:outline-none"
    >
      <option value="">—</option>
      {#each projects as p}<option value={p.id}>{p.name}</option>{/each}
    </select>
  </label>
  <div class="col-span-4 flex items-end">
    <label class="flex w-full items-center gap-2 rounded border border-slate-200 px-3 py-2 text-sm">
      <input type="checkbox" bind:checked={form.billable} />
      Billable
    </label>
  </div>

  {#if error}
    <p class="col-span-12 rounded bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>
  {/if}
  <button
    class="col-span-12 mt-1 rounded bg-brand-800 px-4 py-2 text-sm font-medium text-white hover:bg-brand-900"
  >
    Add mileage entry
  </button>
</form>

<div class="mt-6 overflow-hidden rounded-xl border border-slate-200 bg-white">
  {#if loading}
    <div class="p-8 text-center text-sm text-slate-500">Loading…</div>
  {:else if entries.length === 0}
    <div class="p-12 text-center text-sm text-slate-500">No mileage logged this year.</div>
  {:else}
    <table class="w-full text-sm">
      <thead class="border-b border-slate-200 bg-slate-50 text-left text-xs uppercase tracking-wider text-slate-500">
        <tr>
          <th class="px-5 py-3 font-medium">Date</th>
          <th class="px-5 py-3 text-right font-medium">Miles</th>
          <th class="px-5 py-3 font-medium">Purpose</th>
          <th class="px-5 py-3 font-medium">Client</th>
          <th class="px-5 py-3 text-right font-medium">Deduction</th>
          <th class="px-5 py-3"></th>
        </tr>
      </thead>
      <tbody>
        {#each entries as x (x.id)}
          <tr class="border-b border-slate-100 last:border-0">
            <td class="px-5 py-3 whitespace-nowrap text-slate-600">{fmtDate(x.date)}</td>
            <td class="px-5 py-3 text-right font-mono text-slate-800">{x.miles.toFixed(1)}</td>
            <td class="px-5 py-3 text-slate-700">{x.purpose || '—'}</td>
            <td class="px-5 py-3 text-slate-600">
              {x.expand?.client?.name ?? '—'}
              {#if x.billable}
                <span class="ml-1 rounded-full bg-brand-100 px-1.5 py-0.5 text-[10px] font-medium text-brand-800">billable</span>
              {/if}
            </td>
            <td class="px-5 py-3 text-right font-mono text-slate-800">
              {formatUSD(Math.round(x.miles * x.rate_cents_snapshot))}
              <div class="text-[10px] text-slate-400">@ {(x.rate_cents_snapshot / 100).toFixed(2)}¢/mi</div>
            </td>
            <td class="px-5 py-3 text-right">
              <button class="text-xs text-red-600 hover:underline" onclick={() => remove(x)}>
                Delete
              </button>
            </td>
          </tr>
        {/each}
      </tbody>
    </table>
  {/if}
</div>
