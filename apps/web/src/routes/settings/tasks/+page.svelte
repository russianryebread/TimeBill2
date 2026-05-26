<script lang="ts">
  import { onMount } from 'svelte';
  import { api } from '$lib/api';
  import { workspace } from '$lib/workspace.svelte';
  import { formatUSD, parseUSDInput, centsToDollars } from '@timebill/shared/money';

  type TaskRow = {
    id: string;
    name: string;
    rate_cents: number | null;
    billable_default: boolean;
  };

  let tasks = $state<TaskRow[]>([]);
  let loading = $state(true);
  let error = $state('');

  let newName = $state('');
  let newRateInput = $state('');
  let newBillable = $state(true);

  async function load() {
    if (!workspace.current) return;
    loading = true;
    try {
      tasks = (await api.listTasks()) as unknown as TaskRow[];
    } finally {
      loading = false;
    }
  }

  async function create(e: SubmitEvent) {
    e.preventDefault();
    error = '';
    const rateCents = newRateInput ? parseUSDInput(newRateInput) : null;
    if (newRateInput && rateCents === null) {
      error = 'Invalid rate';
      return;
    }
    try {
      await api.createTask({
        name: newName,
        rate_cents: rateCents,
        billable_default: newBillable
      });
      newName = '';
      newRateInput = '';
      newBillable = true;
      await load();
    } catch (err) {
      error = err instanceof Error ? err.message : 'Save failed';
    }
  }

  async function remove(t: TaskRow) {
    if (!confirm(`Delete task "${t.name}"? Past time entries will keep their rate snapshot.`)) {
      return;
    }
    await api.deleteTask(t.id);
    await load();
  }

  onMount(load);

  $effect(() => {
    if (workspace.current) load();
  });
</script>

<div>
  <h2 class="text-lg font-semibold text-slate-900">Activity types</h2>
  <p class="mt-1 text-sm text-slate-600">
    Categories of work (Programming, Meetings, Design…). Optional per-task rate
    overrides the project rate when used.
  </p>

  <form
    onsubmit={create}
    class="mt-6 grid grid-cols-12 gap-3 rounded-xl border border-slate-200 bg-white p-5"
  >
    <label class="col-span-6">
      <span class="text-xs text-slate-500">Name</span>
      <input
        required
        placeholder="Programming"
        bind:value={newName}
        class="mt-1 w-full rounded border border-slate-300 px-3 py-2 text-sm focus:border-brand-500 focus:outline-none"
      />
    </label>
    <label class="col-span-3">
      <span class="text-xs text-slate-500">Rate (USD/hr)</span>
      <input
        inputmode="decimal"
        placeholder="optional"
        bind:value={newRateInput}
        class="mt-1 w-full rounded border border-slate-300 px-3 py-2 text-sm focus:border-brand-500 focus:outline-none"
      />
    </label>
    <div class="col-span-3 flex items-end">
      <label class="flex w-full items-center gap-2 rounded border border-slate-200 px-3 py-2 text-sm">
        <input type="checkbox" bind:checked={newBillable} />
        <span class="whitespace-nowrap">Billable</span>
      </label>
    </div>
    {#if error}
      <p class="col-span-12 rounded bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>
    {/if}
    <button
      class="col-span-12 mt-2 rounded bg-brand-800 px-4 py-2 text-sm font-medium text-white hover:bg-brand-900"
    >
      Add activity type
    </button>
  </form>

  <div class="mt-6 overflow-hidden rounded-xl border border-slate-200 bg-white">
    {#if loading}
      <div class="p-6 text-center text-sm text-slate-500">Loading…</div>
    {:else if tasks.length === 0}
      <div class="p-8 text-center text-sm text-slate-500">No activity types yet.</div>
    {:else}
      <table class="w-full text-sm">
        <thead class="border-b border-slate-200 bg-slate-50 text-left text-xs uppercase tracking-wider text-slate-500">
          <tr>
            <th class="px-5 py-3 font-medium">Name</th>
            <th class="px-5 py-3 text-right font-medium">Rate</th>
            <th class="px-5 py-3 font-medium">Billable</th>
            <th class="px-5 py-3"></th>
          </tr>
        </thead>
        <tbody>
          {#each tasks as t (t.id)}
            <tr class="border-b border-slate-100 last:border-0">
              <td class="px-5 py-3 font-medium text-slate-900">{t.name}</td>
              <td class="px-5 py-3 text-right font-mono text-slate-700">
                {t.rate_cents ? `${formatUSD(t.rate_cents)}/hr` : '—'}
              </td>
              <td class="px-5 py-3 text-slate-600">{t.billable_default ? 'Yes' : 'No'}</td>
              <td class="px-5 py-3 text-right">
                <button class="text-xs text-red-600 hover:underline" onclick={() => remove(t)}>
                  Delete
                </button>
              </td>
            </tr>
          {/each}
        </tbody>
      </table>
    {/if}
  </div>
</div>
