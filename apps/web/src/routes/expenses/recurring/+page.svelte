<script lang="ts">
  import { onMount } from 'svelte';
  import { api } from '$lib/api';
  import { pb } from '$lib/pb';
  import { workspace } from '$lib/workspace.svelte';
  import { formatUSD, parseUSDInput, centsToDollars } from '@timebill/shared/money';

  type Category = { id: string; name: string };
  type RecurringRow = {
    id: string;
    category: string;
    amount_cents: number;
    vendor: string;
    cadence: 'weekly' | 'monthly' | 'yearly';
    next_run: string;
    active: boolean;
    expand?: { category?: Category };
  };

  let rows = $state<RecurringRow[]>([]);
  let categories = $state<Category[]>([]);
  let loading = $state(true);
  let error = $state('');
  let runStatus = $state('');

  let form = $state({
    category: '',
    rateInput: '',
    vendor: '',
    cadence: 'monthly' as 'weekly' | 'monthly' | 'yearly',
    next_run: new Date().toISOString().slice(0, 10),
    active: true
  });

  async function load() {
    if (!workspace.current) return;
    loading = true;
    try {
      const [r, c] = await Promise.all([
        api.listRecurringExpenses(),
        api.listExpenseCategories()
      ]);
      rows = r as unknown as RecurringRow[];
      categories = c as unknown as Category[];
      if (!form.category && categories.length) form.category = categories[0]!.id;
    } finally {
      loading = false;
    }
  }

  async function submit(e: SubmitEvent) {
    e.preventDefault();
    error = '';
    const cents = parseUSDInput(form.rateInput);
    if (cents === null || cents <= 0) {
      error = 'Invalid amount';
      return;
    }
    try {
      await api.createRecurringExpense({
        category: form.category,
        amount_cents: cents,
        vendor: form.vendor,
        cadence: form.cadence,
        next_run: form.next_run,
        active: form.active
      });
      form.rateInput = '';
      form.vendor = '';
      await load();
    } catch (err) {
      error = err instanceof Error ? err.message : 'Save failed';
    }
  }

  async function toggleActive(r: RecurringRow) {
    await api.updateRecurringExpense(r.id, { active: !r.active });
    await load();
  }

  async function remove(r: RecurringRow) {
    if (!confirm(`Delete recurring "${r.vendor || r.expand?.category?.name}"?`)) return;
    await api.deleteRecurringExpense(r.id);
    await load();
  }

  async function runNow() {
    runStatus = 'Running…';
    try {
      const res = await pb.send('/api/timebill/run-recurring', { method: 'POST' });
      runStatus = `Materialized ${res.materialized} expense(s).`;
      await load();
    } catch (err) {
      runStatus = err instanceof Error ? err.message : 'Failed';
    }
  }

  function fmtDate(s: string): string {
    const ymd = s.slice(0, 10).split('-').map(Number);
    if (ymd.length === 3 && !ymd.some(Number.isNaN)) {
      const [y, m, d] = ymd as [number, number, number];
      return new Date(y, m - 1, d).toLocaleDateString('en-US', {
        month: 'short',
        day: 'numeric',
        year: 'numeric'
      });
    }
    return new Date(s).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
  }

  onMount(load);

  $effect(() => {
    if (workspace.current) load();
  });
</script>

<div class="flex items-end justify-between">
  <div>
    <p class="text-sm text-slate-600">
      Templates that auto-create an expense on their cadence (daily cron at 02:00 UTC).
    </p>
  </div>
  <button
    class="rounded-md border border-slate-300 bg-white px-3 py-1.5 text-sm font-medium text-slate-700 hover:bg-slate-50"
    onclick={runNow}
  >
    Run now
  </button>
</div>
{#if runStatus}
  <p class="mt-2 text-xs text-slate-500">{runStatus}</p>
{/if}

<form
  onsubmit={submit}
  class="mt-6 grid grid-cols-12 gap-3 rounded-xl border border-slate-200 bg-white p-5"
>
  <label class="col-span-4">
    <span class="text-xs text-slate-500">Vendor</span>
    <input
      bind:value={form.vendor}
      placeholder="e.g. Adobe CC"
      class="mt-1 w-full rounded border border-slate-300 px-3 py-2 text-sm focus:border-brand-500 focus:outline-none"
    />
  </label>
  <label class="col-span-4">
    <span class="text-xs text-slate-500">Category</span>
    <select
      required
      bind:value={form.category}
      class="mt-1 w-full rounded border border-slate-300 px-3 py-2 text-sm focus:border-brand-500 focus:outline-none"
    >
      {#each categories as c}
        <option value={c.id}>{c.name}</option>
      {/each}
    </select>
  </label>
  <label class="col-span-4">
    <span class="text-xs text-slate-500">Amount (USD)</span>
    <input
      inputmode="decimal"
      required
      placeholder="0.00"
      bind:value={form.rateInput}
      class="mt-1 w-full rounded border border-slate-300 px-3 py-2 text-sm focus:border-brand-500 focus:outline-none"
    />
  </label>
  <label class="col-span-4">
    <span class="text-xs text-slate-500">Cadence</span>
    <select
      bind:value={form.cadence}
      class="mt-1 w-full rounded border border-slate-300 px-3 py-2 text-sm focus:border-brand-500 focus:outline-none"
    >
      <option value="weekly">Weekly</option>
      <option value="monthly">Monthly</option>
      <option value="yearly">Yearly</option>
    </select>
  </label>
  <label class="col-span-4">
    <span class="text-xs text-slate-500">Next run</span>
    <input
      type="date"
      required
      bind:value={form.next_run}
      class="mt-1 w-full rounded border border-slate-300 px-3 py-2 text-sm focus:border-brand-500 focus:outline-none"
    />
  </label>
  <div class="col-span-4 flex items-end">
    <label class="flex w-full items-center gap-2 rounded border border-slate-200 px-3 py-2 text-sm">
      <input type="checkbox" bind:checked={form.active} />
      Active
    </label>
  </div>
  {#if error}
    <p class="col-span-12 rounded bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>
  {/if}
  <button class="col-span-12 mt-1 rounded bg-brand-800 px-4 py-2 text-sm font-medium text-white hover:bg-brand-900">
    Add recurring expense
  </button>
</form>

<div class="mt-6 overflow-hidden rounded-xl border border-slate-200 bg-white">
  {#if loading}
    <div class="p-8 text-center text-sm text-slate-500">Loading…</div>
  {:else if rows.length === 0}
    <div class="p-12 text-center text-sm text-slate-500">No recurring expenses set up.</div>
  {:else}
    <table class="w-full text-sm">
      <thead class="border-b border-slate-200 bg-slate-50 text-left text-xs uppercase tracking-wider text-slate-500">
        <tr>
          <th class="px-5 py-3 font-medium">Vendor</th>
          <th class="px-5 py-3 font-medium">Category</th>
          <th class="px-5 py-3 text-right font-medium">Amount</th>
          <th class="px-5 py-3 font-medium">Cadence</th>
          <th class="px-5 py-3 font-medium">Next run</th>
          <th class="px-5 py-3 font-medium">Active</th>
          <th class="px-5 py-3"></th>
        </tr>
      </thead>
      <tbody>
        {#each rows as r (r.id)}
          <tr class="border-b border-slate-100 last:border-0">
            <td class="px-5 py-3 font-medium text-slate-900">{r.vendor || '—'}</td>
            <td class="px-5 py-3 text-slate-600">{r.expand?.category?.name ?? '—'}</td>
            <td class="px-5 py-3 text-right font-mono text-slate-800">{formatUSD(r.amount_cents)}</td>
            <td class="px-5 py-3 text-slate-700 capitalize">{r.cadence}</td>
            <td class="px-5 py-3 text-slate-700">{fmtDate(r.next_run)}</td>
            <td class="px-5 py-3">
              <button
                class="rounded-full px-2 py-0.5 text-xs font-medium
                  {r.active ? 'bg-brand-200 text-brand-800' : 'bg-slate-100 text-slate-500'}"
                onclick={() => toggleActive(r)}
              >
                {r.active ? 'Active' : 'Paused'}
              </button>
            </td>
            <td class="px-5 py-3 text-right">
              <button class="text-xs text-red-600 hover:underline" onclick={() => remove(r)}>
                Delete
              </button>
            </td>
          </tr>
        {/each}
      </tbody>
    </table>
  {/if}
</div>
