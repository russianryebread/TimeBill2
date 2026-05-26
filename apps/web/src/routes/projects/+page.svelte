<script lang="ts">
  import { onMount } from 'svelte';
  import { api } from '$lib/api';
  import { workspace } from '$lib/workspace.svelte';
  import { formatUSD, parseUSDInput, centsToDollars } from '@timebill/shared/money';

  type ProjectRow = {
    id: string;
    name: string;
    client: string;
    rate_cents: number | null;
    status: 'active' | 'paused' | 'archived';
    color: string;
    budget_hours: number | null;
    expand?: { client?: { id: string; name: string } };
  };

  type ClientOption = { id: string; name: string; default_rate_cents: number };

  let projects = $state<ProjectRow[]>([]);
  let clients = $state<ClientOption[]>([]);
  let loading = $state(true);
  let showForm = $state(false);
  let editing = $state<ProjectRow | null>(null);
  let error = $state('');

  // Brand row + contrasting secondaries for visual differentiation across projects
  const PALETTE = [
    // brand
    '#004e64',
    '#00a5cf',
    '#25a18e',
    '#7ae582',
    '#9fffcb',
    // warm contrasts
    '#f97316', // orange
    '#ef4444', // red
    '#eab308', // amber
    // cool contrasts (different hues)
    '#8b5cf6', // violet
    '#ec4899', // pink
    '#6366f1', // indigo
    // neutral
    '#64748b' // slate
  ];

  let form = $state({
    client: '',
    name: '',
    rateInput: '',
    status: 'active',
    color: PALETTE[0]!,
    budgetInput: ''
  });

  async function load() {
    if (!workspace.current) return;
    loading = true;
    try {
      const [p, c] = await Promise.all([api.listProjects(), api.listClients()]);
      projects = p as unknown as ProjectRow[];
      clients = c as unknown as ClientOption[];
    } finally {
      loading = false;
    }
  }

  function openCreate() {
    editing = null;
    form = {
      client: clients[0]?.id ?? '',
      name: '',
      rateInput: '',
      status: 'active',
      color: PALETTE[Math.floor(Math.random() * PALETTE.length)]!,
      budgetInput: ''
    };
    showForm = true;
    error = '';
  }

  function openEdit(p: ProjectRow) {
    editing = p;
    form = {
      client: p.client,
      name: p.name,
      rateInput: p.rate_cents ? centsToDollars(p.rate_cents).toString() : '',
      status: p.status,
      color: p.color || PALETTE[0]!,
      budgetInput: p.budget_hours?.toString() ?? ''
    };
    showForm = true;
    error = '';
  }

  async function submit(e: SubmitEvent) {
    e.preventDefault();
    error = '';
    const rateCents = form.rateInput ? parseUSDInput(form.rateInput) : null;
    if (form.rateInput && rateCents === null) {
      error = 'Invalid rate';
      return;
    }
    const budget = form.budgetInput ? Number(form.budgetInput) : null;
    if (form.budgetInput && (budget === null || Number.isNaN(budget))) {
      error = 'Invalid budget hours';
      return;
    }
    try {
      const payload = {
        client: form.client,
        name: form.name,
        rate_cents: rateCents,
        status: form.status,
        color: form.color,
        budget_hours: budget
      };
      if (editing) {
        await api.updateProject(editing.id, payload);
      } else {
        await api.createProject(payload);
      }
      showForm = false;
      await load();
    } catch (err) {
      error = err instanceof Error ? err.message : 'Save failed';
    }
  }

  function clientById(id: string): string {
    return clients.find((c) => c.id === id)?.name ?? '—';
  }

  function effectiveRate(p: ProjectRow): number {
    if (p.rate_cents) return p.rate_cents;
    const c = clients.find((c) => c.id === p.client);
    return c?.default_rate_cents ?? 0;
  }

  onMount(load);

  $effect(() => {
    if (workspace.current) load();
  });
</script>

<div class="mx-auto max-w-5xl px-8 py-8">
  <div class="flex items-center justify-between">
    <div>
      <h1 class="text-2xl font-bold text-slate-900">Projects</h1>
      <p class="mt-1 text-sm text-slate-600">Buckets of work under each client.</p>
    </div>
    <button
      class="rounded-md bg-brand-800 px-4 py-2 text-sm font-medium text-white hover:bg-brand-900 disabled:opacity-50"
      onclick={openCreate}
      disabled={clients.length === 0}
    >
      + New project
    </button>
  </div>

  {#if clients.length === 0 && !loading}
    <div class="mt-6 rounded-xl border border-amber-200 bg-amber-50 p-5 text-sm text-amber-900">
      Add a <a href="/clients" class="font-medium underline">client</a> before creating a project.
    </div>
  {/if}

  <div class="mt-6 overflow-hidden rounded-xl border border-slate-200 bg-white">
    {#if loading}
      <div class="p-8 text-center text-sm text-slate-500">Loading…</div>
    {:else if projects.length === 0}
      <div class="p-12 text-center text-slate-500">No projects yet.</div>
    {:else}
      <table class="w-full text-sm">
        <thead class="border-b border-slate-200 bg-slate-50 text-left text-xs uppercase tracking-wider text-slate-500">
          <tr>
            <th class="px-5 py-3 font-medium">Project</th>
            <th class="px-5 py-3 font-medium">Client</th>
            <th class="px-5 py-3 font-medium">Status</th>
            <th class="px-5 py-3 text-right font-medium">Rate</th>
            <th class="px-5 py-3"></th>
          </tr>
        </thead>
        <tbody>
          {#each projects as p (p.id)}
            <tr class="border-b border-slate-100 last:border-0">
              <td class="px-5 py-3">
                <span class="flex items-center gap-2">
                  <span class="inline-block h-3 w-3 rounded-full" style:background-color={p.color}></span>
                  <span class="font-medium text-slate-900">{p.name}</span>
                </span>
              </td>
              <td class="px-5 py-3 text-slate-600">{clientById(p.client)}</td>
              <td class="px-5 py-3">
                <span class="rounded-full bg-slate-100 px-2 py-0.5 text-xs text-slate-600">{p.status}</span>
              </td>
              <td class="px-5 py-3 text-right font-mono text-slate-700">
                {effectiveRate(p) ? `${formatUSD(effectiveRate(p))}/hr` : '—'}
                {#if !p.rate_cents}<span class="ml-1 text-xs text-slate-400">(client)</span>{/if}
              </td>
              <td class="px-5 py-3 text-right">
                <button class="text-xs text-brand-600 hover:underline" onclick={() => openEdit(p)}>
                  Edit
                </button>
              </td>
            </tr>
          {/each}
        </tbody>
      </table>
    {/if}
  </div>
</div>

{#if showForm}
  <div class="fixed inset-0 z-40 flex items-center justify-center bg-slate-900/40 p-4" role="dialog">
    <form
      onsubmit={submit}
      class="w-full max-w-md space-y-4 rounded-xl bg-white p-6 shadow-xl"
    >
      <h2 class="text-lg font-semibold text-slate-900">
        {editing ? 'Edit project' : 'New project'}
      </h2>

      <label class="block">
        <span class="text-sm text-slate-700">Client</span>
        <select
          required
          bind:value={form.client}
          class="mt-1 w-full rounded border border-slate-300 px-3 py-2 text-sm focus:border-brand-500 focus:outline-none"
        >
          {#each clients as c}
            <option value={c.id}>{c.name}</option>
          {/each}
        </select>
      </label>

      <label class="block">
        <span class="text-sm text-slate-700">Project name</span>
        <input
          required
          bind:value={form.name}
          class="mt-1 w-full rounded border border-slate-300 px-3 py-2 text-sm focus:border-brand-500 focus:outline-none"
        />
      </label>

      <label class="block">
        <span class="text-sm text-slate-700">Hourly rate (USD, blank to inherit client default)</span>
        <input
          inputmode="decimal"
          placeholder="0.00"
          bind:value={form.rateInput}
          class="mt-1 w-full rounded border border-slate-300 px-3 py-2 text-sm focus:border-brand-500 focus:outline-none"
        />
      </label>

      <label class="block">
        <span class="text-sm text-slate-700">Status</span>
        <select
          bind:value={form.status}
          class="mt-1 w-full rounded border border-slate-300 px-3 py-2 text-sm focus:border-brand-500 focus:outline-none"
        >
          <option value="active">Active</option>
          <option value="paused">Paused</option>
          <option value="archived">Archived</option>
        </select>
      </label>

      <div>
        <span class="text-sm text-slate-700">Color</span>
        <div class="mt-1 flex flex-wrap gap-2">
          {#each PALETTE as color}
            <button
              type="button"
              class="h-7 w-7 rounded-full border-2 transition {form.color === color ? 'border-slate-900' : 'border-transparent'}"
              style:background-color={color}
              aria-label="Color {color}"
              onclick={() => (form.color = color)}
            ></button>
          {/each}
        </div>
      </div>

      <label class="block">
        <span class="text-sm text-slate-700">Budget hours (optional)</span>
        <input
          inputmode="decimal"
          bind:value={form.budgetInput}
          class="mt-1 w-full rounded border border-slate-300 px-3 py-2 text-sm focus:border-brand-500 focus:outline-none"
        />
      </label>

      {#if error}
        <p class="rounded bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>
      {/if}

      <div class="flex justify-end gap-2 pt-2">
        <button
          type="button"
          class="rounded px-4 py-2 text-sm text-slate-600 hover:bg-slate-100"
          onclick={() => (showForm = false)}
        >
          Cancel
        </button>
        <button
          type="submit"
          class="rounded bg-brand-800 px-4 py-2 text-sm font-medium text-white hover:bg-brand-900"
        >
          {editing ? 'Save changes' : 'Create project'}
        </button>
      </div>
    </form>
  </div>
{/if}
