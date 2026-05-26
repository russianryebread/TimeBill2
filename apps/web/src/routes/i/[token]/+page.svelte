<script lang="ts">
  import { onMount } from 'svelte';
  import { page } from '$app/stores';
  import { pb } from '$lib/pb';
  import { formatUSD } from '@timebill/shared/money';

  type LineItem = {
    id: string;
    description: string;
    quantity: number;
    unit_price_cents: number;
    amount_cents: number;
  };
  type PublicInvoice = {
    invoice: {
      id: string;
      number: string;
      issue_date: string;
      due_date: string;
      status: string;
      subtotal_cents: number;
      tax_cents: number;
      total_cents: number;
      notes: string;
      pdf: string;
      public_token: string;
      workspace: string;
    };
    workspace: { name: string } | null;
    client: { name: string; email: string; address: string } | null;
    line_items: LineItem[];
  };

  let data = $state<PublicInvoice | null>(null);
  let loading = $state(true);
  let error = $state('');

  async function load() {
    const token = $page.params.token;
    loading = true;
    try {
      const res = await fetch(`/api/timebill/public-invoice/${token}`);
      if (!res.ok) {
        error = `Invoice not found.`;
        return;
      }
      data = (await res.json()) as PublicInvoice;
    } catch (err) {
      error = err instanceof Error ? err.message : 'Failed to load';
    } finally {
      loading = false;
    }
  }

  function fmtDate(s: string): string {
    const ymd = s.slice(0, 10).split('-').map(Number);
    if (ymd.length === 3 && !ymd.some(Number.isNaN)) {
      const [y, m, d] = ymd as [number, number, number];
      return new Date(y, m - 1, d).toLocaleDateString('en-US', {
        month: 'long',
        day: 'numeric',
        year: 'numeric'
      });
    }
    return s.slice(0, 10);
  }

  function pdfUrl(inv: PublicInvoice): string | null {
    if (!inv.invoice.pdf) return null;
    return pb.files.getUrl(
      { id: inv.invoice.id, collectionId: 'invoices_______' } as any,
      inv.invoice.pdf
    );
  }

  onMount(load);
</script>

<div class="min-h-screen bg-slate-100 py-10">
  <div class="mx-auto max-w-3xl px-6">
    {#if loading}
      <div class="rounded-xl bg-white p-12 text-center text-slate-500">Loading…</div>
    {:else if error || !data}
      <div class="rounded-xl bg-white p-12 text-center text-slate-500">
        {error || 'Not found'}
      </div>
    {:else}
      <div class="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
        <header class="bg-brand-800 px-8 py-6 text-white">
          <div class="flex items-end justify-between">
            <div>
              <div class="text-xs uppercase tracking-wider text-brand-200">Invoice</div>
              <div class="font-mono text-2xl font-bold">{data.invoice.number}</div>
            </div>
            <div class="text-right text-sm">
              <div class="text-brand-200">From</div>
              <div class="font-medium">{data.workspace?.name ?? 'TimeBill'}</div>
            </div>
          </div>
        </header>

        <section class="px-8 py-6 grid gap-6 sm:grid-cols-2">
          <div>
            <div class="text-xs uppercase tracking-wider text-slate-500">Bill to</div>
            <div class="mt-1 font-semibold text-slate-900">{data.client?.name ?? ''}</div>
            {#if data.client?.email}
              <div class="text-sm text-slate-600">{data.client.email}</div>
            {/if}
            {#if data.client?.address}
              <pre class="mt-1 whitespace-pre-wrap font-sans text-sm text-slate-600">{data.client.address}</pre>
            {/if}
          </div>
          <div class="sm:text-right">
            <div class="text-xs uppercase tracking-wider text-slate-500">Issue date</div>
            <div class="text-slate-800">{fmtDate(data.invoice.issue_date)}</div>
            <div class="mt-3 text-xs uppercase tracking-wider text-slate-500">Due date</div>
            <div class="font-medium text-slate-800">{fmtDate(data.invoice.due_date)}</div>
          </div>
        </section>

        <section class="px-8">
          <table class="w-full text-sm">
            <thead class="border-b border-slate-200 text-left text-xs uppercase tracking-wider text-slate-500">
              <tr>
                <th class="py-2 pr-2 font-medium">Description</th>
                <th class="py-2 px-2 text-right font-medium">Qty</th>
                <th class="py-2 px-2 text-right font-medium">Rate</th>
                <th class="py-2 pl-2 text-right font-medium">Amount</th>
              </tr>
            </thead>
            <tbody>
              {#each data.line_items as li (li.id)}
                <tr class="border-b border-slate-100">
                  <td class="py-2 pr-2 text-slate-800">{li.description}</td>
                  <td class="py-2 px-2 text-right font-mono text-slate-700">{li.quantity}</td>
                  <td class="py-2 px-2 text-right font-mono text-slate-700">{formatUSD(li.unit_price_cents)}</td>
                  <td class="py-2 pl-2 text-right font-mono text-slate-900">{formatUSD(li.amount_cents)}</td>
                </tr>
              {/each}
            </tbody>
          </table>
        </section>

        <section class="px-8 py-6">
          <div class="flex justify-end">
            <div class="w-64 space-y-1 text-sm">
              <div class="flex justify-between text-slate-600">
                <span>Subtotal</span>
                <span class="font-mono">{formatUSD(data.invoice.subtotal_cents)}</span>
              </div>
              {#if data.invoice.tax_cents > 0}
                <div class="flex justify-between text-slate-600">
                  <span>Tax</span>
                  <span class="font-mono">{formatUSD(data.invoice.tax_cents)}</span>
                </div>
              {/if}
              <div class="flex justify-between border-t border-slate-200 pt-1 text-base font-semibold text-brand-800">
                <span>Total due</span>
                <span class="font-mono">{formatUSD(data.invoice.total_cents)}</span>
              </div>
            </div>
          </div>
        </section>

        {#if data.invoice.notes}
          <section class="border-t border-slate-100 bg-slate-50 px-8 py-5">
            <div class="text-xs uppercase tracking-wider text-slate-500">Notes</div>
            <p class="mt-1 whitespace-pre-wrap text-sm text-slate-700">{data.invoice.notes}</p>
          </section>
        {/if}

        {#if pdfUrl(data)}
          <section class="border-t border-slate-100 bg-slate-50 px-8 py-4 text-center">
            <a
              href={pdfUrl(data) ?? '#'}
              target="_blank"
              rel="noopener"
              class="inline-block rounded bg-brand-800 px-4 py-2 text-sm font-medium text-white hover:bg-brand-900"
            >
              Download PDF
            </a>
          </section>
        {/if}
      </div>

      <p class="mt-4 text-center text-xs text-slate-500">
        Generated by TimeBill · {data.invoice.public_token.slice(0, 8)}…
      </p>
    {/if}
  </div>
</div>
