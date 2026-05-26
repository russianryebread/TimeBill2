<script lang="ts">
  import { onMount } from 'svelte';
  import { goto } from '$app/navigation';
  import { page } from '$app/stores';
  import { pb } from '$lib/pb';
  import { api } from '$lib/api';
  import { workspace } from '$lib/workspace.svelte';
  import { formatUSD, formatHours, hoursDecimal, parseUSDInput } from '@timebill/shared/money';
  import { roundHours } from '@timebill/shared/invoice';
  import { renderInvoicePdf } from '$lib/pdf';

  type Invoice = {
    id: string;
    number: string;
    client: string;
    issue_date: string;
    due_date: string;
    status: 'draft' | 'sent' | 'viewed' | 'paid' | 'overdue' | 'void';
    subtotal_cents: number;
    tax_cents: number;
    total_cents: number;
    notes: string;
    public_token: string;
    pdf: string;
    expand?: { client?: { id: string; name: string; email: string; address: string; default_rate_cents: number } };
  };
  type LineItem = {
    id: string;
    description: string;
    quantity: number;
    unit_price_cents: number;
    amount_cents: number;
    source: 'time_entry' | 'expense' | 'mileage' | 'manual';
    source_id: string;
    sort_order: number;
  };

  type UnbilledTime = {
    id: string;
    description: string;
    started_at: string;
    ended_at: string;
    rate_cents_snapshot: number | null;
    expand?: { project?: { name: string; rate_cents: number | null }; task?: { name: string } };
  };
  type UnbilledExpense = {
    id: string;
    date: string;
    vendor: string;
    description: string;
    amount_cents: number;
    expand?: { category?: { name: string } };
  };
  type UnbilledMileage = {
    id: string;
    date: string;
    miles: number;
    purpose: string;
    rate_cents_snapshot: number;
  };

  type Payment = {
    id: string;
    date: string;
    amount_cents: number;
    method: string;
    reference: string;
  };

  let invoice = $state<Invoice | null>(null);
  let lineItems = $state<LineItem[]>([]);
  let payments = $state<Payment[]>([]);
  let loading = $state(true);
  let saveError = $state('');

  let activeTab = $state<'time' | 'expense' | 'mileage'>('time');
  let unbilledTime = $state<UnbilledTime[]>([]);
  let unbilledExpenses = $state<UnbilledExpense[]>([]);
  let unbilledMileage = $state<UnbilledMileage[]>([]);
  let selected = $state<Record<string, boolean>>({});

  let manualForm = $state({ description: '', qty: '1', priceInput: '' });
  let paymentForm = $state({
    date: new Date().toISOString().slice(0, 10),
    amountInput: '',
    method: 'check' as 'check' | 'ach' | 'cash' | 'card' | 'other',
    reference: ''
  });
  let pdfStatus = $state('');

  const invoiceId = $derived($page.params.id);

  async function load() {
    if (!workspace.current || !invoiceId) return;
    loading = true;
    try {
      const inv = (await api.getInvoice(invoiceId)) as unknown as Invoice;
      invoice = inv;
      const [li, pay] = await Promise.all([
        api.listLineItems(invoiceId),
        api.listPayments(invoiceId)
      ]);
      lineItems = li as unknown as LineItem[];
      payments = pay as unknown as Payment[];
      await loadUnbilled();
    } finally {
      loading = false;
    }
  }

  async function loadUnbilled() {
    if (!invoice) return;
    const cid = invoice.client;
    const [t, e, m] = await Promise.all([
      api.listUnbilledTimeForClient(cid),
      api.listUnbilledExpensesForClient(cid),
      api.listUnbilledMileageForClient(cid)
    ]);
    unbilledTime = t as unknown as UnbilledTime[];
    unbilledExpenses = e as unknown as UnbilledExpense[];
    unbilledMileage = m as unknown as UnbilledMileage[];
    selected = {};
  }

  function entryHours(e: UnbilledTime): number {
    const ms = new Date(e.ended_at).getTime() - new Date(e.started_at).getTime();
    return hoursDecimal(ms);
  }

  function entryRate(e: UnbilledTime): number {
    return e.rate_cents_snapshot ?? e.expand?.project?.rate_cents ?? invoice?.expand?.client?.default_rate_cents ?? 0;
  }

  function entryAmount(e: UnbilledTime): number {
    return Math.round(entryRate(e) * entryHours(e));
  }

  async function recomputeTotals() {
    if (!invoice) return;
    const subtotal = lineItems.reduce((s, l) => s + l.amount_cents, 0);
    const total = subtotal + (invoice.tax_cents || 0);
    await api.updateInvoice(invoice.id, {
      subtotal_cents: subtotal,
      total_cents: total
    });
    invoice = { ...invoice, subtotal_cents: subtotal, total_cents: total };
  }

  async function addSelectedTime() {
    if (!invoice) return;
    const rounding = workspace.current?.billing_rounding_minutes ?? 0;
    const targets = unbilledTime.filter((e) => selected[`time-${e.id}`]);
    for (const e of targets) {
      const actualHours = entryHours(e);
      // Billing rounding (UP to nearest configured granularity, if any).
      const billedHours = roundHours(actualHours, rounding);
      const rate = entryRate(e);
      const actualMs = new Date(e.ended_at).getTime() - new Date(e.started_at).getTime();
      const desc = `${e.expand?.project?.name ?? 'Time'}${e.expand?.task ? ` — ${e.expand.task.name}` : ''}${e.description ? ` · ${e.description}` : ''} (${formatHours(actualMs)} actual)`;
      await api.addLineItem({
        invoice: invoice.id,
        description: desc,
        quantity: billedHours,
        unit_price_cents: rate,
        source: 'time_entry',
        source_id: e.id,
        sort_order: lineItems.length
      });
      await api.markTimeEntryBilled(e.id, invoice.id);
    }
    await reload();
  }

  async function addSelectedExpenses() {
    if (!invoice) return;
    const targets = unbilledExpenses.filter((e) => selected[`exp-${e.id}`]);
    for (const e of targets) {
      await api.addLineItem({
        invoice: invoice.id,
        description: `${e.vendor || e.expand?.category?.name || 'Expense'}${e.description ? ` · ${e.description}` : ''}`,
        quantity: 1,
        unit_price_cents: e.amount_cents,
        source: 'expense',
        source_id: e.id,
        sort_order: lineItems.length
      });
      await api.markExpenseBilled(e.id, invoice.id);
    }
    await reload();
  }

  async function addSelectedMileage() {
    if (!invoice) return;
    const targets = unbilledMileage.filter((e) => selected[`mile-${e.id}`]);
    for (const e of targets) {
      await api.addLineItem({
        invoice: invoice.id,
        description: `Mileage — ${e.purpose || 'travel'}`,
        quantity: e.miles,
        unit_price_cents: e.rate_cents_snapshot,
        source: 'mileage',
        source_id: e.id,
        sort_order: lineItems.length
      });
      await api.markMileageBilled(e.id, invoice.id);
    }
    await reload();
  }

  async function addManual(e: SubmitEvent) {
    e.preventDefault();
    saveError = '';
    if (!invoice) return;
    const qty = Number(manualForm.qty);
    const cents = parseUSDInput(manualForm.priceInput);
    if (!qty || Number.isNaN(qty) || cents === null) {
      saveError = 'Invalid quantity or amount';
      return;
    }
    await api.addLineItem({
      invoice: invoice.id,
      description: manualForm.description,
      quantity: qty,
      unit_price_cents: cents,
      source: 'manual',
      sort_order: lineItems.length
    });
    manualForm = { description: '', qty: '1', priceInput: '' };
    await reload();
  }

  async function removeLine(li: LineItem) {
    if (!invoice) return;
    if (!confirm('Remove this line?')) return;
    // Un-mark the source so it shows up in unbilled again
    if (li.source === 'time_entry' && li.source_id) {
      try { await pb.collection('time_entries').update(li.source_id, { invoice: null }); } catch (_) {}
    } else if (li.source === 'expense' && li.source_id) {
      try { await pb.collection('expenses').update(li.source_id, { invoice: null }); } catch (_) {}
    } else if (li.source === 'mileage' && li.source_id) {
      try { await pb.collection('mileage_entries').update(li.source_id, { invoice: null }); } catch (_) {}
    }
    await api.deleteLineItem(li.id);
    await reload();
  }

  async function reload() {
    if (!invoice) return;
    lineItems = (await api.listLineItems(invoice.id)) as unknown as LineItem[];
    await recomputeTotals();
    await loadUnbilled();
  }

  async function generatePdf(): Promise<File> {
    if (!invoice) throw new Error('No invoice');
    const ws = workspace.current!;
    const blob = renderInvoicePdf({
      invoice: {
        number: invoice.number,
        issue_date: invoice.issue_date,
        due_date: invoice.due_date,
        status: invoice.status,
        subtotal_cents: invoice.subtotal_cents,
        tax_cents: invoice.tax_cents,
        total_cents: invoice.total_cents,
        notes: invoice.notes,
        public_token: invoice.public_token
      },
      client: {
        name: invoice.expand?.client?.name ?? '',
        email: invoice.expand?.client?.email,
        address: invoice.expand?.client?.address
      },
      workspace: { name: ws.name },
      lineItems: lineItems.map((l) => ({
        description: l.description,
        quantity: l.quantity,
        unit_price_cents: l.unit_price_cents,
        amount_cents: l.amount_cents
      }))
    });
    return new File([blob], `${invoice.number}.pdf`, { type: 'application/pdf' });
  }

  async function downloadPdf() {
    if (!invoice) return;
    const file = await generatePdf();
    const url = URL.createObjectURL(file);
    const a = document.createElement('a');
    a.href = url;
    a.download = file.name;
    a.click();
    URL.revokeObjectURL(url);
  }

  async function sendInvoice() {
    if (!invoice) return;
    pdfStatus = 'Generating PDF…';
    try {
      const file = await generatePdf();
      const form = new FormData();
      form.append('pdf', file);
      form.append('status', 'sent');
      await pb.collection('invoices').update(invoice.id, form);
      pdfStatus = 'Sent (PDF attached). Share the public link with your client.';
      await load();
    } catch (err) {
      pdfStatus = err instanceof Error ? err.message : 'Failed';
    }
  }

  async function markVoid() {
    if (!invoice) return;
    if (!confirm('Void this invoice?')) return;
    await api.updateInvoice(invoice.id, { status: 'void' });
    await load();
  }

  async function addPayment(e: SubmitEvent) {
    e.preventDefault();
    if (!invoice) return;
    const cents = parseUSDInput(paymentForm.amountInput);
    if (cents === null || cents <= 0) return;
    await api.addPayment({
      invoice: invoice.id,
      date: paymentForm.date,
      amount_cents: cents,
      method: paymentForm.method,
      reference: paymentForm.reference
    });
    paymentForm = {
      date: new Date().toISOString().slice(0, 10),
      amountInput: '',
      method: 'check',
      reference: ''
    };
    await load();
  }

  async function deletePayment(p: Payment) {
    if (!confirm(`Delete payment of ${formatUSD(p.amount_cents)}?`)) return;
    await api.deletePayment(p.id);
    await load();
  }

  function copyPublicLink() {
    if (!invoice) return;
    const url = `${window.location.origin}/i/${invoice.public_token}`;
    navigator.clipboard.writeText(url);
    pdfStatus = `Link copied: ${url}`;
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
    return s.slice(0, 10);
  }

  let paidTotal = $derived(payments.reduce((s, p) => s + p.amount_cents, 0));
  let balance = $derived((invoice?.total_cents ?? 0) - paidTotal);

  onMount(load);
  $effect(() => {
    if (workspace.current && invoiceId) load();
  });

  const STATUS_STYLE: Record<string, string> = {
    draft: 'bg-slate-100 text-slate-600',
    sent: 'bg-brand-100 text-brand-800',
    viewed: 'bg-brand-200 text-brand-900',
    paid: 'bg-emerald-100 text-emerald-700',
    overdue: 'bg-red-100 text-red-700',
    void: 'bg-slate-200 text-slate-500'
  };
</script>

<div class="mx-auto max-w-6xl px-8 py-8">
  <a href="/invoices" class="text-xs text-brand-600 hover:underline">← All invoices</a>

  {#if loading || !invoice}
    <div class="mt-6 rounded-xl border border-slate-200 bg-white p-8 text-center text-slate-500">Loading…</div>
  {:else}
    <!-- Header -->
    <div class="mt-3 flex flex-wrap items-end justify-between gap-3">
      <div>
        <div class="flex items-center gap-3">
          <h1 class="font-mono text-2xl font-bold text-slate-900">{invoice.number}</h1>
          <span class="rounded-full px-2.5 py-0.5 text-xs font-medium capitalize {STATUS_STYLE[invoice.status] ?? ''}">
            {invoice.status}
          </span>
        </div>
        <p class="mt-1 text-sm text-slate-600">
          <span class="font-medium text-slate-800">{invoice.expand?.client?.name ?? 'Client'}</span>
          · Issued {fmtDate(invoice.issue_date)} · Due {fmtDate(invoice.due_date)}
        </p>
      </div>
      <div class="flex flex-wrap gap-2">
        <button
          class="rounded border border-slate-300 bg-white px-3 py-1.5 text-sm font-medium text-slate-700 hover:bg-slate-50"
          onclick={downloadPdf}
        >
          Download PDF
        </button>
        <button
          class="rounded border border-slate-300 bg-white px-3 py-1.5 text-sm font-medium text-slate-700 hover:bg-slate-50"
          onclick={copyPublicLink}
        >
          Copy public link
        </button>
        {#if invoice.status === 'draft'}
          <button
            class="rounded bg-brand-800 px-4 py-1.5 text-sm font-medium text-white hover:bg-brand-900"
            onclick={sendInvoice}
            disabled={lineItems.length === 0}
          >
            Send
          </button>
        {/if}
        {#if invoice.status !== 'void' && invoice.status !== 'paid'}
          <button
            class="rounded border border-slate-300 bg-white px-3 py-1.5 text-sm text-slate-500 hover:bg-slate-50"
            onclick={markVoid}
          >
            Void
          </button>
        {/if}
      </div>
    </div>
    {#if pdfStatus}
      <p class="mt-2 text-xs text-slate-500">{pdfStatus}</p>
    {/if}

    <div class="mt-6 grid gap-6 lg:grid-cols-3">
      <!-- Line items -->
      <div class="lg:col-span-2">
        <div class="overflow-hidden rounded-xl border border-slate-200 bg-white">
          <div class="border-b border-slate-100 px-5 py-3 text-sm font-medium text-slate-700">
            Line items
          </div>
          {#if lineItems.length === 0}
            <div class="px-5 py-8 text-center text-sm text-slate-500">
              Add time, expenses, or mileage from the side panel, or use the manual row below.
            </div>
          {:else}
            <table class="w-full text-sm">
              <thead class="border-b border-slate-100 bg-slate-50 text-left text-xs uppercase tracking-wider text-slate-500">
                <tr>
                  <th class="px-5 py-2 font-medium">Description</th>
                  <th class="px-3 py-2 text-right font-medium">Qty</th>
                  <th class="px-3 py-2 text-right font-medium">Rate</th>
                  <th class="px-5 py-2 text-right font-medium">Amount</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {#each lineItems as li (li.id)}
                  <tr class="border-b border-slate-100 last:border-0">
                    <td class="px-5 py-2">
                      <div class="text-slate-800">{li.description}</div>
                      <div class="text-[10px] uppercase text-slate-400">{li.source.replace('_', ' ')}</div>
                    </td>
                    <td class="px-3 py-2 text-right font-mono text-slate-700">{li.quantity}</td>
                    <td class="px-3 py-2 text-right font-mono text-slate-700">{formatUSD(li.unit_price_cents)}</td>
                    <td class="px-5 py-2 text-right font-mono text-slate-900">{formatUSD(li.amount_cents)}</td>
                    <td class="px-3 py-2 text-right">
                      <button class="text-xs text-red-600 hover:underline" onclick={() => removeLine(li)}>
                        ✕
                      </button>
                    </td>
                  </tr>
                {/each}
              </tbody>
            </table>
          {/if}

          <!-- Manual add row -->
          {#if invoice.status === 'draft'}
            <form onsubmit={addManual} class="grid grid-cols-12 gap-2 border-t border-slate-100 p-4">
              <input
                placeholder="Manual line description"
                bind:value={manualForm.description}
                required
                class="col-span-6 rounded border border-slate-300 px-2 py-1.5 text-sm"
              />
              <input
                placeholder="Qty"
                inputmode="decimal"
                bind:value={manualForm.qty}
                required
                class="col-span-1 rounded border border-slate-300 px-2 py-1.5 text-right text-sm"
              />
              <input
                placeholder="Rate"
                inputmode="decimal"
                bind:value={manualForm.priceInput}
                required
                class="col-span-2 rounded border border-slate-300 px-2 py-1.5 text-right text-sm"
              />
              <button class="col-span-3 rounded bg-slate-100 px-3 py-1.5 text-sm font-medium text-slate-800 hover:bg-slate-200">
                + Add line
              </button>
              {#if saveError}
                <p class="col-span-12 rounded bg-red-50 px-3 py-2 text-sm text-red-700">{saveError}</p>
              {/if}
            </form>
          {/if}

          <!-- Totals -->
          <div class="border-t border-slate-200 px-5 py-4 text-sm">
            <div class="flex justify-end">
              <div class="w-64 space-y-1">
                <div class="flex justify-between text-slate-600">
                  <span>Subtotal</span>
                  <span class="font-mono">{formatUSD(invoice.subtotal_cents)}</span>
                </div>
                {#if invoice.tax_cents > 0}
                  <div class="flex justify-between text-slate-600">
                    <span>Tax</span>
                    <span class="font-mono">{formatUSD(invoice.tax_cents)}</span>
                  </div>
                {/if}
                <div class="flex justify-between border-t border-slate-200 pt-1 text-base font-semibold text-brand-800">
                  <span>Total</span>
                  <span class="font-mono">{formatUSD(invoice.total_cents)}</span>
                </div>
                {#if paidTotal > 0}
                  <div class="flex justify-between text-emerald-700">
                    <span>Paid</span>
                    <span class="font-mono">- {formatUSD(paidTotal)}</span>
                  </div>
                  <div class="flex justify-between border-t border-slate-200 pt-1 text-slate-800">
                    <span>Balance</span>
                    <span class="font-mono">{formatUSD(Math.max(0, balance))}</span>
                  </div>
                {/if}
              </div>
            </div>
          </div>
        </div>

        <!-- Payments -->
        <div class="mt-6 overflow-hidden rounded-xl border border-slate-200 bg-white">
          <div class="border-b border-slate-100 px-5 py-3 text-sm font-medium text-slate-700">
            Payments
          </div>
          {#if payments.length === 0}
            <div class="px-5 py-4 text-sm text-slate-500">No payments recorded.</div>
          {:else}
            <table class="w-full text-sm">
              <thead class="border-b border-slate-100 bg-slate-50 text-left text-xs uppercase tracking-wider text-slate-500">
                <tr>
                  <th class="px-5 py-2 font-medium">Date</th>
                  <th class="px-3 py-2 font-medium">Method</th>
                  <th class="px-3 py-2 font-medium">Reference</th>
                  <th class="px-5 py-2 text-right font-medium">Amount</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {#each payments as p (p.id)}
                  <tr class="border-b border-slate-100 last:border-0">
                    <td class="px-5 py-2 text-slate-700">{fmtDate(p.date)}</td>
                    <td class="px-3 py-2 capitalize text-slate-700">{p.method}</td>
                    <td class="px-3 py-2 text-slate-600">{p.reference || '—'}</td>
                    <td class="px-5 py-2 text-right font-mono text-slate-900">{formatUSD(p.amount_cents)}</td>
                    <td class="px-3 py-2 text-right">
                      <button class="text-xs text-red-600 hover:underline" onclick={() => deletePayment(p)}>
                        ✕
                      </button>
                    </td>
                  </tr>
                {/each}
              </tbody>
            </table>
          {/if}
          {#if invoice.status !== 'draft' && invoice.status !== 'void' && balance > 0}
            <form onsubmit={addPayment} class="grid grid-cols-12 gap-2 border-t border-slate-100 p-4">
              <input
                type="date"
                bind:value={paymentForm.date}
                required
                class="col-span-3 rounded border border-slate-300 px-2 py-1.5 text-sm"
              />
              <input
                placeholder="Amount"
                inputmode="decimal"
                bind:value={paymentForm.amountInput}
                required
                class="col-span-2 rounded border border-slate-300 px-2 py-1.5 text-right text-sm"
              />
              <select
                bind:value={paymentForm.method}
                class="col-span-2 rounded border border-slate-300 px-2 py-1.5 text-sm"
              >
                <option value="check">Check</option>
                <option value="ach">ACH</option>
                <option value="cash">Cash</option>
                <option value="card">Card</option>
                <option value="other">Other</option>
              </select>
              <input
                placeholder="Reference (optional)"
                bind:value={paymentForm.reference}
                class="col-span-3 rounded border border-slate-300 px-2 py-1.5 text-sm"
              />
              <button class="col-span-2 rounded bg-emerald-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-emerald-700">
                + Payment
              </button>
            </form>
          {/if}
        </div>
      </div>

      <!-- Side panel: pull unbilled -->
      {#if invoice.status === 'draft'}
        <aside class="overflow-hidden rounded-xl border border-slate-200 bg-white">
          <div class="border-b border-slate-100 px-4 py-3 text-sm font-medium text-slate-700">
            Pull unbilled
          </div>
          <div class="flex gap-1 border-b border-slate-100 bg-slate-50 px-2 py-1 text-xs">
            {#each [['time', 'Time'], ['expense', 'Expenses'], ['mileage', 'Mileage']] as [v, l]}
              <button
                class="rounded px-3 py-1 font-medium transition
                  {activeTab === v ? 'bg-white text-brand-800 shadow-sm' : 'text-slate-600 hover:text-slate-900'}"
                onclick={() => (activeTab = v as typeof activeTab)}
              >
                {l}
              </button>
            {/each}
          </div>

          <div class="max-h-[480px] overflow-auto">
            {#if activeTab === 'time'}
              {#if unbilledTime.length === 0}
                <p class="px-4 py-6 text-center text-xs text-slate-500">No unbilled time for this client.</p>
              {:else}
                <ul>
                  {#each unbilledTime as e (e.id)}
                    <li class="flex gap-3 border-b border-slate-100 px-4 py-2.5 last:border-0">
                      <input
                        type="checkbox"
                        class="mt-1"
                        bind:checked={selected[`time-${e.id}`]}
                      />
                      <div class="flex-1 min-w-0">
                        <div class="truncate text-xs text-slate-500">
                          {e.expand?.project?.name ?? ''}{e.expand?.task ? ` · ${e.expand.task.name}` : ''}
                        </div>
                        <div class="truncate text-sm text-slate-800">
                          {e.description || '—'}
                        </div>
                        <div class="text-xs text-slate-500">
                          {formatHours(new Date(e.ended_at).getTime() - new Date(e.started_at).getTime())} @ {formatUSD(entryRate(e))}/hr
                        </div>
                      </div>
                      <div class="font-mono text-sm text-slate-800">{formatUSD(entryAmount(e))}</div>
                    </li>
                  {/each}
                </ul>
                <button
                  class="w-full bg-brand-800 px-3 py-2 text-sm font-medium text-white hover:bg-brand-900 disabled:opacity-50"
                  onclick={addSelectedTime}
                  disabled={!unbilledTime.some((e) => selected[`time-${e.id}`])}
                >
                  Add selected to invoice
                </button>
              {/if}
            {:else if activeTab === 'expense'}
              {#if unbilledExpenses.length === 0}
                <p class="px-4 py-6 text-center text-xs text-slate-500">No unbilled expenses for this client.</p>
              {:else}
                <ul>
                  {#each unbilledExpenses as e (e.id)}
                    <li class="flex gap-3 border-b border-slate-100 px-4 py-2.5 last:border-0">
                      <input
                        type="checkbox"
                        class="mt-1"
                        bind:checked={selected[`exp-${e.id}`]}
                      />
                      <div class="flex-1 min-w-0">
                        <div class="truncate text-xs text-slate-500">{fmtDate(e.date)} · {e.expand?.category?.name ?? ''}</div>
                        <div class="truncate text-sm text-slate-800">{e.vendor || e.description || '—'}</div>
                      </div>
                      <div class="font-mono text-sm text-slate-800">{formatUSD(e.amount_cents)}</div>
                    </li>
                  {/each}
                </ul>
                <button
                  class="w-full bg-brand-800 px-3 py-2 text-sm font-medium text-white hover:bg-brand-900 disabled:opacity-50"
                  onclick={addSelectedExpenses}
                  disabled={!unbilledExpenses.some((e) => selected[`exp-${e.id}`])}
                >
                  Add selected to invoice
                </button>
              {/if}
            {:else}
              {#if unbilledMileage.length === 0}
                <p class="px-4 py-6 text-center text-xs text-slate-500">No unbilled mileage for this client.</p>
              {:else}
                <ul>
                  {#each unbilledMileage as e (e.id)}
                    <li class="flex gap-3 border-b border-slate-100 px-4 py-2.5 last:border-0">
                      <input
                        type="checkbox"
                        class="mt-1"
                        bind:checked={selected[`mile-${e.id}`]}
                      />
                      <div class="flex-1 min-w-0">
                        <div class="truncate text-xs text-slate-500">{fmtDate(e.date)}</div>
                        <div class="truncate text-sm text-slate-800">{e.purpose || 'travel'}</div>
                        <div class="text-xs text-slate-500">{e.miles.toFixed(1)} mi @ {(e.rate_cents_snapshot / 100).toFixed(2)}¢/mi</div>
                      </div>
                      <div class="font-mono text-sm text-slate-800">{formatUSD(Math.round(e.miles * e.rate_cents_snapshot))}</div>
                    </li>
                  {/each}
                </ul>
                <button
                  class="w-full bg-brand-800 px-3 py-2 text-sm font-medium text-white hover:bg-brand-900 disabled:opacity-50"
                  onclick={addSelectedMileage}
                  disabled={!unbilledMileage.some((e) => selected[`mile-${e.id}`])}
                >
                  Add selected to invoice
                </button>
              {/if}
            {/if}
          </div>
        </aside>
      {/if}
    </div>
  {/if}
</div>
