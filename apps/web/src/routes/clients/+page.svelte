<script lang="ts">
  import { onMount } from 'svelte';
  import { api } from '$lib/api';
  import { workspace } from '$lib/workspace.svelte';
  import { formatUSD, parseUSDInput, centsToDollars } from '@timebill/shared/money';

  type ClientRow = {
    id: string;
    name: string;
    email: string;
    address: string;
    default_rate_cents: number;
    notes: string;
    archived: boolean;
  };

  let clients = $state<ClientRow[]>([]);
  let loading = $state(true);
  let showForm = $state(false);
  let editing = $state<ClientRow | null>(null);
  let error = $state('');

  let form = $state({
    name: '',
    email: '',
    address: '',
    rateInput: '',
    notes: ''
  });

  async function load() {
    if (!workspace.current) return;
    loading = true;
    try {
      clients = (await api.listClients()) as unknown as ClientRow[];
    } finally {
      loading = false;
    }
  }

  function openCreate() {
    editing = null;
    form = { name: '', email: '', address: '', rateInput: '', notes: '' };
    showForm = true;
    error = '';
  }

  function openEdit(c: ClientRow) {
    editing = c;
    form = {
      name: c.name,
      email: c.email,
      address: c.address,
      rateInput: c.default_rate_cents ? centsToDollars(c.default_rate_cents).toString() : '',
      notes: c.notes
    };
    showForm = true;
    error = '';
  }

  async function submit(e: SubmitEvent) {
    e.preventDefault();
    error = '';
    const rateCents = form.rateInput ? parseUSDInput(form.rateInput) : 0;
    if (rateCents === null) {
      error = 'Invalid rate';
      return;
    }
    try {
      const payload = {
        name: form.name,
        email: form.email,
        address: form.address,
        default_rate_cents: rateCents ?? 0,
        notes: form.notes
      };
      if (editing) {
        await api.updateClient(editing.id, payload);
      } else {
        await api.createClient(payload);
      }
      showForm = false;
      await load();
    } catch (err) {
      error = err instanceof Error ? err.message : 'Save failed';
    }
  }

  async function archive(c: ClientRow) {
    await api.updateClient(c.id, { archived: true });
    await load();
  }

  onMount(load);

  $effect(() => {
    if (workspace.current) load();
  });
</script>

<div class="mx-auto max-w-6xl px-8 py-8">
  <div class="flex items-center justify-between">
    <div>
      <h1 class="text-2xl font-bold text-slate-900">Clients</h1>
      <p class="mt-1 text-sm text-slate-600">People and companies you bill.</p>
    </div>
    <button
      class="rounded-md bg-brand-800 px-4 py-2 text-sm font-medium text-white hover:bg-brand-900"
      onclick={openCreate}
    >
      + New client
    </button>
  </div>

  <div class="mt-6 overflow-hidden rounded-xl border border-slate-200 bg-white">
    {#if loading}
      <div class="p-8 text-center text-sm text-slate-500">Loading…</div>
    {:else if clients.length === 0}
      <div class="p-12 text-center">
        <p class="text-slate-500">No clients yet.</p>
        <button
          class="mt-3 text-sm text-brand-600 hover:underline"
          onclick={openCreate}
        >
          Add your first client →
        </button>
      </div>
    {:else}
      <table class="w-full text-sm">
        <thead class="border-b border-slate-200 bg-slate-50 text-left text-xs uppercase tracking-wider text-slate-500">
          <tr>
            <th class="px-5 py-3 font-medium">Name</th>
            <th class="px-5 py-3 font-medium">Email</th>
            <th class="px-5 py-3 text-right font-medium">Default rate</th>
            <th class="px-5 py-3"></th>
          </tr>
        </thead>
        <tbody>
          {#each clients as c (c.id)}
            <tr class="border-b border-slate-100 last:border-0">
              <td class="px-5 py-3 font-medium text-slate-900">{c.name}</td>
              <td class="px-5 py-3 text-slate-600">{c.email || '—'}</td>
              <td class="px-5 py-3 text-right font-mono text-slate-700">
                {c.default_rate_cents ? `${formatUSD(c.default_rate_cents)}/hr` : '—'}
              </td>
              <td class="px-5 py-3 text-right">
                <button class="text-xs text-brand-600 hover:underline" onclick={() => openEdit(c)}>
                  Edit
                </button>
                <button
                  class="ml-3 text-xs text-slate-500 hover:underline"
                  onclick={() => archive(c)}
                >
                  Archive
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
        {editing ? 'Edit client' : 'New client'}
      </h2>

      <label class="block">
        <span class="text-sm text-slate-700">Name</span>
        <input
          required
          bind:value={form.name}
          class="mt-1 w-full rounded border border-slate-300 px-3 py-2 text-sm focus:border-brand-500 focus:outline-none"
        />
      </label>

      <label class="block">
        <span class="text-sm text-slate-700">Email</span>
        <input
          type="email"
          bind:value={form.email}
          class="mt-1 w-full rounded border border-slate-300 px-3 py-2 text-sm focus:border-brand-500 focus:outline-none"
        />
      </label>

      <label class="block">
        <span class="text-sm text-slate-700">Default hourly rate (USD)</span>
        <input
          inputmode="decimal"
          placeholder="0.00"
          bind:value={form.rateInput}
          class="mt-1 w-full rounded border border-slate-300 px-3 py-2 text-sm focus:border-brand-500 focus:outline-none"
        />
      </label>

      <label class="block">
        <span class="text-sm text-slate-700">Address</span>
        <textarea
          rows="2"
          bind:value={form.address}
          class="mt-1 w-full rounded border border-slate-300 px-3 py-2 text-sm focus:border-brand-500 focus:outline-none"
        ></textarea>
      </label>

      <label class="block">
        <span class="text-sm text-slate-700">Notes</span>
        <textarea
          rows="2"
          bind:value={form.notes}
          class="mt-1 w-full rounded border border-slate-300 px-3 py-2 text-sm focus:border-brand-500 focus:outline-none"
        ></textarea>
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
          {editing ? 'Save changes' : 'Create client'}
        </button>
      </div>
    </form>
  </div>
{/if}
