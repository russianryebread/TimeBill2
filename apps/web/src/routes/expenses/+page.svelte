<script lang="ts">
  import { onMount } from 'svelte';
  import { api } from '$lib/api';
  import { pb } from '$lib/pb';
  import { workspace } from '$lib/workspace.svelte';
  import { formatUSD, parseUSDInput, centsToDollars } from '@timebill/shared/money';

  type Category = { id: string; name: string; schedule_c_line: string };
  type ClientLite = { id: string; name: string };
  type ProjectLite = { id: string; name: string };
  type ExpenseRow = {
    id: string;
    date: string;
    amount_cents: number;
    vendor: string;
    description: string;
    category: string;
    client: string | null;
    project: string | null;
    billable: boolean;
    reimbursable: boolean;
    receipt: string;
    expand?: {
      category?: Category;
      client?: { name: string };
      project?: { name: string };
    };
  };

  let expenses = $state<ExpenseRow[]>([]);
  let categories = $state<Category[]>([]);
  let clients = $state<ClientLite[]>([]);
  let projects = $state<ProjectLite[]>([]);
  let loading = $state(true);
  let showForm = $state(false);
  let editing = $state<ExpenseRow | null>(null);
  let error = $state('');

  // Filters
  let month = $state(new Date().toISOString().slice(0, 7));
  let categoryFilter = $state('');

  // Form
  let form = $state({
    date: new Date().toISOString().slice(0, 10),
    category: '',
    rateInput: '',
    vendor: '',
    description: '',
    client: '',
    project: '',
    billable: false,
    reimbursable: false,
    receiptFile: null as File | null
  });

  async function load() {
    if (!workspace.current) return;
    loading = true;
    try {
      const [from, to] = monthRange(month);
      const [exp, cats, cls, projs] = await Promise.all([
        api.listExpenses({
          from,
          to,
          categoryId: categoryFilter || undefined
        }),
        api.listExpenseCategories(),
        api.listClients(),
        api.listProjects()
      ]);
      expenses = exp as unknown as ExpenseRow[];
      categories = cats as unknown as Category[];
      clients = cls as unknown as ClientLite[];
      projects = projs as unknown as ProjectLite[];
    } finally {
      loading = false;
    }
  }

  function monthRange(ym: string): [string, string] {
    const [y, m] = ym.split('-').map(Number);
    const from = new Date(y!, m! - 1, 1).toISOString().slice(0, 10);
    const to = new Date(y!, m!, 1).toISOString().slice(0, 10);
    return [from, to];
  }

  function openCreate() {
    editing = null;
    form = {
      date: new Date().toISOString().slice(0, 10),
      category: categories[0]?.id ?? '',
      rateInput: '',
      vendor: '',
      description: '',
      client: '',
      project: '',
      billable: false,
      reimbursable: false,
      receiptFile: null
    };
    showForm = true;
    error = '';
  }

  function openEdit(x: ExpenseRow) {
    editing = x;
    form = {
      date: x.date.slice(0, 10),
      category: x.category,
      rateInput: centsToDollars(x.amount_cents).toString(),
      vendor: x.vendor,
      description: x.description,
      client: x.client ?? '',
      project: x.project ?? '',
      billable: x.billable,
      reimbursable: x.reimbursable,
      receiptFile: null
    };
    showForm = true;
    error = '';
  }

  function onFile(e: Event) {
    const input = e.currentTarget as HTMLInputElement;
    form.receiptFile = input.files?.[0] ?? null;
  }

  async function submit(e: SubmitEvent) {
    e.preventDefault();
    error = '';
    const cents = parseUSDInput(form.rateInput);
    if (cents === null || cents < 0) {
      error = 'Invalid amount';
      return;
    }
    try {
      const payload = {
        date: form.date,
        category: form.category,
        amount_cents: cents,
        vendor: form.vendor,
        description: form.description,
        client: form.client || null,
        project: form.project || null,
        billable: form.billable,
        reimbursable: form.reimbursable
      };
      if (editing) {
        await api.updateExpense(editing.id, payload, form.receiptFile);
      } else {
        await api.createExpense({ ...payload, receipt: form.receiptFile });
      }
      showForm = false;
      await load();
    } catch (err) {
      error = err instanceof Error ? err.message : 'Save failed';
    }
  }

  async function remove(x: ExpenseRow) {
    if (!confirm(`Delete this $${centsToDollars(x.amount_cents).toFixed(2)} expense?`)) return;
    await api.deleteExpense(x.id);
    await load();
  }

  function receiptUrl(x: ExpenseRow): string | null {
    if (!x.receipt) return null;
    return pb.files.getUrl({ id: x.id, collectionId: 'expenses_______' } as any, x.receipt, {
      thumb: '200x200'
    });
  }

  let monthTotal = $derived(
    expenses.reduce((sum, x) => sum + x.amount_cents, 0)
  );
  let monthBillable = $derived(
    expenses.filter((x) => x.billable).reduce((sum, x) => sum + x.amount_cents, 0)
  );

  function fmtDate(s: string): string {
    // PocketBase stores date-only fields as "YYYY-MM-DD 00:00:00.000Z" (UTC
    // midnight). Parsing via `new Date()` then localizing back can shift the
    // displayed day by one in timezones west of UTC. Treat the YYYY-MM-DD
    // prefix as a local date instead.
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
    void month;
    void categoryFilter;
    if (workspace.current) load();
  });
</script>

<!-- Top bar: filters + new -->
<div class="flex flex-wrap items-end justify-between gap-3">
  <div class="flex flex-wrap items-end gap-3">
    <label class="block">
      <span class="text-xs text-slate-500">Month</span>
      <input
        type="month"
        bind:value={month}
        class="mt-1 rounded border border-slate-300 px-3 py-2 text-sm focus:border-brand-500 focus:outline-none"
      />
    </label>
    <label class="block">
      <span class="text-xs text-slate-500">Category</span>
      <select
        bind:value={categoryFilter}
        class="mt-1 rounded border border-slate-300 px-3 py-2 text-sm focus:border-brand-500 focus:outline-none"
      >
        <option value="">All</option>
        {#each categories as c}
          <option value={c.id}>{c.name}</option>
        {/each}
      </select>
    </label>
  </div>
  <button
    class="rounded-md bg-brand-800 px-4 py-2 text-sm font-medium text-white hover:bg-brand-900"
    onclick={openCreate}
  >
    + New expense
  </button>
</div>

<!-- Summary -->
<div class="mt-4 grid gap-3 sm:grid-cols-2">
  <div class="rounded-lg border border-slate-200 bg-white p-4">
    <div class="text-xs uppercase tracking-wider text-slate-500">Month total</div>
    <div class="mt-1 font-mono text-2xl font-semibold text-brand-800">
      {formatUSD(monthTotal)}
    </div>
  </div>
  <div class="rounded-lg border border-slate-200 bg-white p-4">
    <div class="text-xs uppercase tracking-wider text-slate-500">Billable to clients</div>
    <div class="mt-1 font-mono text-2xl font-semibold text-brand-800">
      {formatUSD(monthBillable)}
    </div>
  </div>
</div>

<!-- List -->
<div class="mt-6 overflow-hidden rounded-xl border border-slate-200 bg-white">
  {#if loading}
    <div class="p-8 text-center text-sm text-slate-500">Loading…</div>
  {:else if expenses.length === 0}
    <div class="p-12 text-center">
      <p class="text-slate-500">No expenses in this month.</p>
      <button class="mt-3 text-sm text-brand-600 hover:underline" onclick={openCreate}>
        Add one →
      </button>
    </div>
  {:else}
    <table class="w-full text-sm">
      <thead
        class="border-b border-slate-200 bg-slate-50 text-left text-xs uppercase tracking-wider text-slate-500"
      >
        <tr>
          <th class="px-5 py-3 font-medium">Date</th>
          <th class="px-5 py-3 font-medium">Vendor / Description</th>
          <th class="px-5 py-3 font-medium">Category</th>
          <th class="px-5 py-3 font-medium">Receipt</th>
          <th class="px-5 py-3 text-right font-medium">Amount</th>
          <th class="px-5 py-3"></th>
        </tr>
      </thead>
      <tbody>
        {#each expenses as x (x.id)}
          <tr class="border-b border-slate-100 last:border-0">
            <td class="px-5 py-3 whitespace-nowrap text-slate-600">{fmtDate(x.date)}</td>
            <td class="px-5 py-3">
              <div class="font-medium text-slate-900">{x.vendor || '—'}</div>
              {#if x.description}
                <div class="text-xs text-slate-500">{x.description}</div>
              {/if}
              <div class="mt-1 flex gap-1.5">
                {#if x.billable}
                  <span class="rounded-full bg-brand-100 px-2 py-0.5 text-[10px] font-medium text-brand-800">
                    Billable
                  </span>
                {/if}
                {#if x.reimbursable}
                  <span class="rounded-full bg-amber-100 px-2 py-0.5 text-[10px] font-medium text-amber-900">
                    Reimbursable
                  </span>
                {/if}
              </div>
            </td>
            <td class="px-5 py-3">
              <div class="text-slate-700">{x.expand?.category?.name ?? '—'}</div>
              {#if x.expand?.category?.schedule_c_line}
                <div class="text-[10px] text-slate-400">{x.expand.category.schedule_c_line}</div>
              {/if}
            </td>
            <td class="px-5 py-3">
              {#if receiptUrl(x)}
                <a href={receiptUrl(x) ?? '#'} target="_blank" rel="noopener" class="inline-block">
                  <img
                    src={receiptUrl(x) ?? ''}
                    alt="Receipt"
                    class="h-10 w-10 rounded border border-slate-200 object-cover"
                  />
                </a>
              {:else}
                <span class="text-xs text-slate-400">—</span>
              {/if}
            </td>
            <td class="px-5 py-3 text-right font-mono text-slate-800">
              {formatUSD(x.amount_cents)}
            </td>
            <td class="px-5 py-3 text-right">
              <button class="text-xs text-brand-600 hover:underline" onclick={() => openEdit(x)}>
                Edit
              </button>
              <button
                class="ml-3 text-xs text-red-600 hover:underline"
                onclick={() => remove(x)}
              >
                Delete
              </button>
            </td>
          </tr>
        {/each}
      </tbody>
    </table>
  {/if}
</div>

{#if showForm}
  <div class="fixed inset-0 z-40 flex items-center justify-center bg-slate-900/40 p-4" role="dialog">
    <form
      onsubmit={submit}
      class="max-h-[90vh] w-full max-w-md space-y-3 overflow-auto rounded-xl bg-white p-6 shadow-xl"
    >
      <h2 class="text-lg font-semibold text-slate-900">
        {editing ? 'Edit expense' : 'New expense'}
      </h2>

      <div class="grid grid-cols-2 gap-3">
        <label class="block">
          <span class="text-sm text-slate-700">Date</span>
          <input
            type="date"
            required
            bind:value={form.date}
            class="mt-1 w-full rounded border border-slate-300 px-3 py-2 text-sm focus:border-brand-500 focus:outline-none"
          />
        </label>
        <label class="block">
          <span class="text-sm text-slate-700">Amount (USD)</span>
          <input
            inputmode="decimal"
            required
            placeholder="0.00"
            bind:value={form.rateInput}
            class="mt-1 w-full rounded border border-slate-300 px-3 py-2 text-sm focus:border-brand-500 focus:outline-none"
          />
        </label>
      </div>

      <label class="block">
        <span class="text-sm text-slate-700">Category</span>
        <select
          required
          bind:value={form.category}
          class="mt-1 w-full rounded border border-slate-300 px-3 py-2 text-sm focus:border-brand-500 focus:outline-none"
        >
          {#each categories as c}
            <option value={c.id}>{c.name} — {c.schedule_c_line}</option>
          {/each}
        </select>
      </label>

      <label class="block">
        <span class="text-sm text-slate-700">Vendor</span>
        <input
          bind:value={form.vendor}
          placeholder="e.g. AWS"
          class="mt-1 w-full rounded border border-slate-300 px-3 py-2 text-sm focus:border-brand-500 focus:outline-none"
        />
      </label>

      <label class="block">
        <span class="text-sm text-slate-700">Description</span>
        <input
          bind:value={form.description}
          class="mt-1 w-full rounded border border-slate-300 px-3 py-2 text-sm focus:border-brand-500 focus:outline-none"
        />
      </label>

      <div class="grid grid-cols-2 gap-3">
        <label class="block">
          <span class="text-sm text-slate-700">Client (optional)</span>
          <select
            bind:value={form.client}
            class="mt-1 w-full rounded border border-slate-300 px-3 py-2 text-sm focus:border-brand-500 focus:outline-none"
          >
            <option value="">—</option>
            {#each clients as c}
              <option value={c.id}>{c.name}</option>
            {/each}
          </select>
        </label>
        <label class="block">
          <span class="text-sm text-slate-700">Project (optional)</span>
          <select
            bind:value={form.project}
            class="mt-1 w-full rounded border border-slate-300 px-3 py-2 text-sm focus:border-brand-500 focus:outline-none"
          >
            <option value="">—</option>
            {#each projects as p}
              <option value={p.id}>{p.name}</option>
            {/each}
          </select>
        </label>
      </div>

      <div class="flex gap-4">
        <label class="flex items-center gap-2 text-sm">
          <input type="checkbox" bind:checked={form.billable} />
          Billable to client
        </label>
        <label class="flex items-center gap-2 text-sm">
          <input type="checkbox" bind:checked={form.reimbursable} />
          Reimbursable
        </label>
      </div>

      <label class="block">
        <span class="text-sm text-slate-700">Receipt (image or PDF)</span>
        <input
          type="file"
          accept="image/*,application/pdf"
          onchange={onFile}
          class="mt-1 w-full text-sm file:mr-3 file:rounded file:border-0 file:bg-brand-100 file:px-3 file:py-1.5 file:text-sm file:font-medium file:text-brand-800 hover:file:bg-brand-200"
        />
        {#if editing?.receipt && !form.receiptFile}
          <span class="mt-1 block text-xs text-slate-500">Current: {editing.receipt}</span>
        {/if}
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
          {editing ? 'Save changes' : 'Create expense'}
        </button>
      </div>
    </form>
  </div>
{/if}
