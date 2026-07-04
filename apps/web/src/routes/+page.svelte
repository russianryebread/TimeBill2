<script lang="ts">
  import { onMount } from 'svelte';
  import { pb, toPbDate } from '$lib/pb';
  import { workspace } from '$lib/workspace.svelte';
  import { auth } from '$lib/auth.svelte';
  import { formatUSD, formatHours, hoursDecimal } from '@timebill/shared/money';
  import LandingPage from '$lib/components/LandingPage.svelte';

  let weekHours = $state(0);
  let weekBillableCents = $state(0);
  let outstandingCents = $state(0);
  let clientCount = $state(0);
  let activeProjectCount = $state(0);

  function startOfWeek(d: Date): Date {
    const day = d.getDay();
    const diff = (day + 6) % 7; // make Monday start
    const start = new Date(d);
    start.setDate(d.getDate() - diff);
    start.setHours(0, 0, 0, 0);
    return start;
  }

  async function loadStats() {
    if (!workspace.current) return;
    const wsId = workspace.current.id;
    const weekStart = toPbDate(startOfWeek(new Date()));

    const entries = await pb.collection('time_entries').getFullList({
      filter: `workspace = "${wsId}" && started_at >= "${weekStart}"`
    });
    let totalMs = 0;
    let billableCents = 0;
    for (const e of entries) {
      if (!e.ended_at) continue;
      const ms = new Date(e.ended_at).getTime() - new Date(e.started_at).getTime();
      totalMs += ms;
      if (e.billable && e.rate_cents_snapshot) {
        billableCents += Math.round((e.rate_cents_snapshot * hoursDecimal(ms)));
      }
    }
    weekHours = totalMs;
    weekBillableCents = billableCents;

    const clients = await pb.collection('clients').getList(1, 1, {
      filter: `workspace = "${wsId}" && archived = false`
    });
    clientCount = clients.totalItems;

    const projects = await pb.collection('projects').getList(1, 1, {
      filter: `workspace = "${wsId}" && status = "active"`
    });
    activeProjectCount = projects.totalItems;

    const invoices = await pb.collection('invoices').getFullList({
      filter: `workspace = "${wsId}" && (status = "sent" || status = "viewed" || status = "overdue")`
    });
    outstandingCents = invoices.reduce((sum, inv) => sum + (inv.total_cents ?? 0), 0);
  }

  onMount(() => {
    loadStats();
  });

  $effect(() => {
    if (workspace.current) loadStats();
  });
</script>

{#if !auth.isLoggedIn}
  <LandingPage />
{:else}
<div class="mx-auto max-w-6xl px-8 py-8">
  <h1 class="text-2xl font-bold text-slate-900">Dashboard</h1>
  <p class="mt-1 text-sm text-slate-600">This week at a glance.</p>

  <section class="mt-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
    <div class="rounded-xl border border-slate-200 bg-white p-5">
      <div class="text-xs font-medium uppercase tracking-wider text-slate-500">Week hours</div>
      <div class="mt-2 font-mono text-3xl font-semibold text-brand-800">{formatHours(weekHours)}</div>
    </div>
    <div class="rounded-xl border border-slate-200 bg-white p-5">
      <div class="text-xs font-medium uppercase tracking-wider text-slate-500">Week billable</div>
      <div class="mt-2 font-mono text-3xl font-semibold text-brand-800">{formatUSD(weekBillableCents)}</div>
    </div>
    <div class="rounded-xl border border-slate-200 bg-white p-5">
      <div class="text-xs font-medium uppercase tracking-wider text-slate-500">Outstanding A/R</div>
      <div class="mt-2 font-mono text-3xl font-semibold text-brand-800">{formatUSD(outstandingCents)}</div>
    </div>
    <div class="rounded-xl border border-slate-200 bg-white p-5">
      <div class="text-xs font-medium uppercase tracking-wider text-slate-500">Active projects</div>
      <div class="mt-2 text-3xl font-semibold text-brand-800">
        {activeProjectCount}
        <span class="text-base text-slate-400">/ {clientCount} clients</span>
      </div>
    </div>
  </section>

  <section class="mt-8 rounded-xl border border-slate-200 bg-white p-6">
    <h2 class="font-semibold text-slate-900">Get started</h2>
    <ol class="mt-3 space-y-1 text-sm text-slate-600">
      <li>1. <a href="/clients" class="text-brand-600 hover:underline">Add a client</a></li>
      <li>2. <a href="/projects" class="text-brand-600 hover:underline">Create a project</a> with an hourly rate</li>
      <li>3. <a href="/time" class="text-brand-600 hover:underline">Start a timer</a> on the time page</li>
    </ol>
  </section>
</div>
{/if}
