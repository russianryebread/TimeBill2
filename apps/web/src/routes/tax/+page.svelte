<script lang="ts">
  import { onMount } from 'svelte';
  import { pb, toPbDate } from '$lib/pb';
  import { api } from '$lib/api';
  import { workspace } from '$lib/workspace.svelte';
  import { formatUSD, hoursDecimal } from '@timebill/shared/money';
  import {
    estimateAnnualTax,
    quarterlyEstimate,
    quarterDueDate,
    type FilingStatus
  } from '@timebill/shared/tax';

  type Entry = {
    id: string;
    started_at: string;
    ended_at: string;
    billable: boolean;
    rate_cents_snapshot: number | null;
  };
  type Expense = { id: string; date: string; amount_cents: number };
  type Mileage = { id: string; date: string; miles: number; rate_cents_snapshot: number };
  type TaxSettings = {
    id: string;
    filing_status: FilingStatus;
    state?: string;
    estimated_other_income_cents?: number;
    mileage_rate_cents_per_mile?: number;
    quarterly_safe_harbor_pct?: number;
  };

  let year = $state(new Date().getFullYear());
  let entries = $state<Entry[]>([]);
  let expenses = $state<Expense[]>([]);
  let mileage = $state<Mileage[]>([]);
  let taxSettings = $state<TaxSettings | null>(null);
  let loading = $state(true);
  let saving = $state(false);
  let saveStatus = $state('');

  // Local editable mirrors of the tax_settings fields shown at the top.
  let filingStatus = $state<FilingStatus>('single');
  let otherIncomeInput = $state('0');

  // Forecast mode. When set to "trailing90", the estimate uses YTD plus a
  // projection of the rest of the year built from the trailing 90 days'
  // monthly run-rate. Defaults to YTD-only so early-year numbers don't
  // mislead with a small denominator extrapolated wildly.
  type ForecastMode = 'ytd' | 'trailing90';
  let forecastMode = $state<ForecastMode>('ytd');

  function durationMs(e: Entry): number {
    return Math.max(0, new Date(e.ended_at).getTime() - new Date(e.started_at).getTime());
  }

  async function load() {
    if (!workspace.current) return;
    loading = true;
    try {
      const wsId = workspace.current.id;
      const yearStart = new Date(year, 0, 1);
      const yearEnd = new Date(year + 1, 0, 1);

      const [tEntries, exps, miles, settings] = await Promise.all([
        pb.collection('time_entries').getFullList({
          filter: `workspace = "${wsId}" && started_at >= "${toPbDate(yearStart)}" && started_at < "${toPbDate(yearEnd)}" && ended_at != "" && billable = true`,
          sort: 'started_at'
        }),
        pb.collection('expenses').getFullList({
          filter: `workspace = "${wsId}" && date >= "${toPbDate(yearStart)}" && date < "${toPbDate(yearEnd)}"`,
          sort: 'date'
        }),
        pb.collection('mileage_entries').getFullList({
          filter: `workspace = "${wsId}" && date >= "${toPbDate(yearStart)}" && date < "${toPbDate(yearEnd)}"`,
          sort: 'date'
        }),
        api.getTaxSettings()
      ]);
      entries = tEntries as unknown as Entry[];
      expenses = exps as unknown as Expense[];
      mileage = miles as unknown as Mileage[];
      taxSettings = settings as unknown as TaxSettings | null;
      if (taxSettings) {
        filingStatus = taxSettings.filing_status ?? 'single';
        otherIncomeInput = ((taxSettings.estimated_other_income_cents ?? 0) / 100).toString();
      }
    } finally {
      loading = false;
    }
  }

  // ---- Aggregations -------------------------------------------------------

  let billableRevenueCents = $derived(
    entries
      .filter((e) => e.billable && e.rate_cents_snapshot)
      .reduce(
        (sum, e) => sum + Math.round((e.rate_cents_snapshot! * durationMs(e)) / 3_600_000),
        0
      )
  );

  let expenseDeductionsCents = $derived(
    expenses.reduce((sum, e) => sum + (e.amount_cents ?? 0), 0)
  );

  let mileageDeductionCents = $derived(
    mileage.reduce(
      (sum, m) => sum + Math.round(m.miles * (m.rate_cents_snapshot ?? 0)),
      0
    )
  );

  let totalDeductionsCents = $derived(expenseDeductionsCents + mileageDeductionCents);

  let netSEIncomeCents = $derived(billableRevenueCents - totalDeductionsCents);

  // ---- Trailing-90-day projection ----------------------------------------

  /** Filter helper: only items in the trailing 90 days from "now". */
  function withinTrailing90Days(isoLike: string): boolean {
    const t = new Date(isoLike).getTime();
    return t >= Date.now() - 90 * 24 * 60 * 60 * 1000;
  }

  let trailing90RevenueCents = $derived(
    entries
      .filter((e) => e.billable && e.rate_cents_snapshot && withinTrailing90Days(e.started_at))
      .reduce(
        (sum, e) => sum + Math.round((e.rate_cents_snapshot! * durationMs(e)) / 3_600_000),
        0
      )
  );
  let trailing90ExpenseCents = $derived(
    expenses.filter((e) => withinTrailing90Days(e.date)).reduce((s, e) => s + (e.amount_cents ?? 0), 0)
  );
  let trailing90MileageCents = $derived(
    mileage
      .filter((m) => withinTrailing90Days(m.date))
      .reduce((sum, m) => sum + Math.round(m.miles * (m.rate_cents_snapshot ?? 0)), 0)
  );
  let trailing90NetCents = $derived(
    trailing90RevenueCents - trailing90ExpenseCents - trailing90MileageCents
  );

  /** Months remaining in the calendar year, fractional (today through Dec 31). */
  let monthsRemaining = $derived.by(() => {
    const now = new Date();
    if (now.getFullYear() !== year) {
      // Looking at a past or future year — no "remainder" to project; project the
      // whole year from the trailing 90.
      return now.getFullYear() < year ? 12 : 0;
    }
    const yearEnd = new Date(year + 1, 0, 1).getTime();
    return Math.max(0, (yearEnd - now.getTime()) / (30.44 * 24 * 60 * 60 * 1000));
  });

  /** Net SE income projected forward from the trailing 90 days. */
  let projectedRemainderCents = $derived(
    Math.max(0, Math.round((trailing90NetCents / 3) * monthsRemaining))
  );

  let projectedRevenueRemainder = $derived(
    Math.max(0, Math.round((trailing90RevenueCents / 3) * monthsRemaining))
  );
  let projectedDeductionsRemainder = $derived(
    Math.max(
      0,
      Math.round(((trailing90ExpenseCents + trailing90MileageCents) / 3) * monthsRemaining)
    )
  );

  /** What the estimate actually feeds into estimateAnnualTax(). */
  let effectiveNetSEIncomeCents = $derived(
    forecastMode === 'trailing90'
      ? Math.max(0, netSEIncomeCents + projectedRemainderCents)
      : Math.max(0, netSEIncomeCents)
  );

  let otherIncomeCents = $derived(() => {
    const n = Number(otherIncomeInput.replace(/[$,\s]/g, ''));
    return Number.isFinite(n) ? Math.round(n * 100) : 0;
  });

  let estimate = $derived(
    estimateAnnualTax({
      netSEIncomeCents: effectiveNetSEIncomeCents,
      filingStatus,
      otherIncomeCents: otherIncomeCents()
    })
  );

  // Quarterly schedule for the active tax year. Q4 is paid in Jan of `year + 1`.
  type QRow = {
    quarter: 1 | 2 | 3 | 4;
    due: Date;
    amount: number;
    isNext: boolean;
    isPast: boolean;
  };
  let quarters = $derived.by(() => {
    const now = new Date();
    const rows: QRow[] = ([1, 2, 3, 4] as const).map((q) => ({
      quarter: q,
      due: quarterDueDate(year, q),
      amount: quarterlyEstimate(estimate.totalTax, q),
      isNext: false,
      isPast: false
    }));
    for (const r of rows) r.isPast = r.due.getTime() < now.getTime();
    const nextIdx = rows.findIndex((r) => !r.isPast);
    if (nextIdx >= 0) rows[nextIdx]!.isNext = true;
    return rows;
  });

  // ---- Persist settings ---------------------------------------------------

  async function persistSettings() {
    if (!taxSettings) return;
    saving = true;
    saveStatus = '';
    try {
      await api.updateTaxSettings(taxSettings.id, {
        filing_status: filingStatus,
        estimated_other_income_cents: otherIncomeCents()
      });
      saveStatus = 'Saved';
      setTimeout(() => (saveStatus = ''), 1500);
    } catch (err) {
      saveStatus = (err as Error).message ?? 'Save failed';
    } finally {
      saving = false;
    }
  }

  // ---- Misc ---------------------------------------------------------------

  const QUARTER_LABELS: Record<1 | 2 | 3 | 4, string> = {
    1: 'Q1 · Jan–Mar',
    2: 'Q2 · Apr–May',
    3: 'Q3 · Jun–Aug',
    4: 'Q4 · Sep–Dec'
  };

  function formatDueDate(d: Date): string {
    return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
  }

  let yearBillableHours = $derived(
    entries.reduce((s, e) => s + hoursDecimal(durationMs(e)), 0)
  );

  onMount(load);
  $effect(() => {
    void year;
    if (workspace.current) load();
  });
</script>

<div class="mx-auto max-w-6xl px-8 py-8">
  <div class="flex flex-wrap items-end justify-between gap-4">
    <div>
      <h1 class="text-2xl font-bold text-slate-900">Tax estimate</h1>
      <p class="mt-1 text-sm text-slate-600">
        Year-to-date self-employment tax projection for {year}.
      </p>
    </div>
    <div class="flex items-end gap-3">
      <label class="block">
        <span class="text-xs text-slate-500">Forecast</span>
        <select
          bind:value={forecastMode}
          class="mt-1 rounded border border-slate-300 px-3 py-1.5 text-sm focus:border-brand-500 focus:outline-none"
        >
          <option value="ytd">YTD actuals only</option>
          <option value="trailing90">Project from last 90 days</option>
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
    </div>
  </div>

  <!-- Disclaimer banner -->
  <div class="mt-4 rounded-lg border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-900">
    <div class="flex items-start gap-2">
      <span class="icon-[ph--warning-duotone] mt-0.5 text-lg text-amber-700" aria-hidden="true"></span>
      <div>
        <strong>Estimate only — not tax advice.</strong> Confirm with a CPA before filing or
        paying. Brackets reflect 2025 figures pending 2026 update. State income tax is not
        included.
      </div>
    </div>
  </div>

  <!-- Filing settings row -->
  <section class="mt-4 rounded-xl border border-slate-200 bg-white p-5">
    <div class="flex flex-wrap items-end gap-4">
      <label class="block">
        <span class="text-xs text-slate-500">Filing status</span>
        <select
          bind:value={filingStatus}
          class="mt-1 rounded border border-slate-300 px-3 py-1.5 text-sm focus:border-brand-500 focus:outline-none"
        >
          <option value="single">Single</option>
          <option value="mfj">Married filing jointly</option>
          <option value="mfs">Married filing separately</option>
          <option value="hoh">Head of household</option>
        </select>
      </label>
      <label class="block">
        <span class="text-xs text-slate-500">Estimated other income ($)</span>
        <input
          type="text"
          inputmode="decimal"
          bind:value={otherIncomeInput}
          class="mt-1 w-40 rounded border border-slate-300 px-3 py-1.5 text-sm focus:border-brand-500 focus:outline-none"
          placeholder="0.00"
        />
      </label>
      <button
        class="rounded bg-brand-800 px-3 py-1.5 text-sm font-medium text-white hover:bg-brand-900 disabled:opacity-50"
        onclick={persistSettings}
        disabled={saving || !taxSettings}
      >
        {saving ? 'Saving…' : 'Save settings'}
      </button>
      {#if saveStatus}
        <span class="text-xs text-slate-500">{saveStatus}</span>
      {/if}
      {#if !taxSettings && !loading}
        <span class="text-xs text-amber-700">
          No tax settings record found for this workspace.
        </span>
      {/if}
    </div>
  </section>

  <!-- YTD figures -->
  <section class="mt-6 grid gap-4 sm:grid-cols-3">
    <div class="rounded-xl border border-slate-200 bg-white p-5">
      <div class="text-xs uppercase tracking-wider text-slate-500">YTD billable revenue</div>
      <div class="mt-1 font-mono text-2xl font-semibold text-brand-800">
        {formatUSD(billableRevenueCents)}
      </div>
      <div class="mt-1 text-xs text-slate-500">
        {yearBillableHours.toFixed(1)} billable hours
      </div>
    </div>
    <div class="rounded-xl border border-slate-200 bg-white p-5">
      <div class="text-xs uppercase tracking-wider text-slate-500">YTD deductible</div>
      <div class="mt-1 font-mono text-2xl font-semibold text-brand-800">
        {formatUSD(totalDeductionsCents)}
      </div>
      <div class="mt-1 text-xs text-slate-500">
        {formatUSD(expenseDeductionsCents)} expenses
        + {formatUSD(mileageDeductionCents)} mileage
      </div>
    </div>
    <div class="rounded-xl border border-slate-200 bg-white p-5">
      <div class="text-xs uppercase tracking-wider text-slate-500">Net SE income</div>
      <div class="mt-1 font-mono text-2xl font-semibold text-brand-800">
        {formatUSD(Math.max(0, netSEIncomeCents))}
      </div>
      <div class="mt-1 text-xs text-slate-500">
        {netSEIncomeCents < 0 ? 'Below zero — no SE tax projected.' : 'Revenue − deductions'}
      </div>
    </div>
  </section>

  {#if forecastMode === 'trailing90'}
    <!-- Projection panel: trailing 90 days extrapolated for the rest of the year -->
    <section class="mt-6 rounded-xl border border-brand-200 bg-brand-50 p-5">
      <div class="flex items-start gap-3">
        <span class="icon-[ph--trend-up-duotone] mt-0.5 text-2xl text-brand-700" aria-hidden="true"></span>
        <div class="flex-1">
          <h2 class="text-sm font-semibold text-brand-900">
            Projected annual from trailing 90 days
          </h2>
          <p class="text-xs text-brand-800/80">
            Adds {monthsRemaining.toFixed(1)} months of projected activity onto
            YTD using your last-90-day monthly run-rate
            ({formatUSD(Math.round(trailing90NetCents / 3))}/mo net SE income).
            Tax estimate below uses these projected totals.
          </p>
        </div>
      </div>

      <div class="mt-4 grid gap-4 sm:grid-cols-3">
        <div class="rounded-lg border border-brand-200 bg-white p-4">
          <div class="text-xs uppercase tracking-wider text-slate-500">Projected revenue</div>
          <div class="mt-1 font-mono text-2xl font-semibold text-brand-800">
            {formatUSD(billableRevenueCents + projectedRevenueRemainder)}
          </div>
          <div class="mt-1 text-xs text-slate-500">
            {formatUSD(billableRevenueCents)} actual
            + {formatUSD(projectedRevenueRemainder)} projected
          </div>
        </div>
        <div class="rounded-lg border border-brand-200 bg-white p-4">
          <div class="text-xs uppercase tracking-wider text-slate-500">Projected deductible</div>
          <div class="mt-1 font-mono text-2xl font-semibold text-brand-800">
            {formatUSD(totalDeductionsCents + projectedDeductionsRemainder)}
          </div>
          <div class="mt-1 text-xs text-slate-500">
            {formatUSD(totalDeductionsCents)} actual
            + {formatUSD(projectedDeductionsRemainder)} projected
          </div>
        </div>
        <div class="rounded-lg border border-brand-300 bg-white p-4">
          <div class="text-xs uppercase tracking-wider text-slate-500">Projected net SE income</div>
          <div class="mt-1 font-mono text-2xl font-semibold text-brand-800">
            {formatUSD(effectiveNetSEIncomeCents)}
          </div>
          <div class="mt-1 text-xs text-slate-500">
            Used in the tax estimate below
          </div>
        </div>
      </div>
    </section>
  {/if}

  <!-- Tax estimate card -->
  <section class="mt-6 rounded-xl border border-slate-200 bg-white p-5">
    <h2 class="text-sm font-medium text-slate-700">
      Annual tax estimate
      {#if forecastMode === 'trailing90'}
        <span class="ml-1 rounded-full bg-brand-200 px-1.5 py-0.5 text-[10px] font-medium text-brand-900">
          projected
        </span>
      {:else}
        <span class="ml-1 rounded-full bg-slate-100 px-1.5 py-0.5 text-[10px] font-medium text-slate-600">
          YTD only
        </span>
      {/if}
    </h2>
    <div class="mt-4 grid gap-4 sm:grid-cols-4">
      <div>
        <div class="text-xs uppercase tracking-wider text-slate-500">SE tax</div>
        <div class="mt-1 font-mono text-xl font-semibold text-brand-800">
          {formatUSD(estimate.seTax)}
        </div>
      </div>
      <div>
        <div class="text-xs uppercase tracking-wider text-slate-500">Federal income tax</div>
        <div class="mt-1 font-mono text-xl font-semibold text-brand-800">
          {formatUSD(estimate.federalIncomeTax)}
        </div>
      </div>
      <div>
        <div class="text-xs uppercase tracking-wider text-slate-500">QBI deduction</div>
        <div class="mt-1 font-mono text-xl font-semibold text-slate-700">
          −{formatUSD(estimate.qbi)}
        </div>
      </div>
      <div>
        <div class="text-xs uppercase tracking-wider text-slate-500">Total tax owed</div>
        <div class="mt-1 font-mono text-2xl font-bold text-brand-800">
          {formatUSD(estimate.totalTax)}
        </div>
        <div class="mt-1 text-xs text-slate-500">
          Effective rate: {(estimate.effectiveRate * 100).toFixed(1)}%
        </div>
      </div>
    </div>
  </section>

  <!-- Quarterly schedule -->
  <section class="mt-6 overflow-hidden rounded-xl border border-slate-200 bg-white">
    <div class="border-b border-slate-100 px-5 py-3 text-sm font-medium text-slate-700">
      Quarterly schedule — IRS estimated tax payments
    </div>
    <table class="w-full text-sm">
      <thead class="border-b border-slate-100 bg-slate-50 text-left text-xs uppercase tracking-wider text-slate-500">
        <tr>
          <th class="px-5 py-2 font-medium">Quarter</th>
          <th class="px-3 py-2 font-medium">Due date</th>
          <th class="px-3 py-2 text-right font-medium">Recommended payment</th>
          <th class="px-5 py-2 font-medium">Status</th>
        </tr>
      </thead>
      <tbody>
        {#each quarters as q (q.quarter)}
          <tr
            class="border-b border-slate-100 last:border-0
              {q.isNext ? 'bg-brand-50' : ''}"
          >
            <td class="px-5 py-3 font-medium text-slate-900">
              {QUARTER_LABELS[q.quarter]}
            </td>
            <td class="px-3 py-3 text-slate-700">{formatDueDate(q.due)}</td>
            <td class="px-3 py-3 text-right font-mono font-semibold text-brand-800">
              {formatUSD(q.amount)}
            </td>
            <td class="px-5 py-3">
              {#if q.isNext}
                <span class="rounded-full bg-brand-800 px-2 py-0.5 text-xs font-medium text-white">
                  Next up
                </span>
              {:else if q.isPast}
                <span class="text-xs text-slate-400">Past due date</span>
              {:else}
                <span class="text-xs text-slate-500">Upcoming</span>
              {/if}
            </td>
          </tr>
        {/each}
      </tbody>
    </table>
    <div class="border-t border-slate-100 px-5 py-3 text-xs text-slate-500">
      Recommended payments are the projected annual total divided evenly across four quarters.
      Your actual safe-harbor target may differ — confirm with your CPA.
    </div>
  </section>
</div>
