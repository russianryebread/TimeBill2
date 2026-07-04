<script lang="ts">
  import { goto } from '$app/navigation';
</script>

<div class="min-h-screen bg-white">
  <!-- Nav -->
  <nav class="flex items-center justify-between px-6 py-4">
    <a href="/" class="text-xl font-bold text-brand-800">TimeBill</a>
    <div class="flex items-center gap-4">
      <a href="/login" class="text-sm text-slate-600 hover:text-brand-700 transition">Sign in</a>
      <button
        onclick={() => goto('/signup')}
        class="rounded-lg bg-brand-800 px-4 py-2 text-sm font-medium text-white hover:bg-brand-700 transition"
      >
        Start free trial
      </button>
    </div>
  </nav>

  <!-- Hero -->
  <section class="px-6 pb-20 pt-16 text-center">
    <h1 class="mx-auto max-w-3xl text-4xl font-bold tracking-tight text-slate-900 sm:text-5xl">
      Track time, expenses, and invoices
      <span class="text-brand-800">without the bloat</span>
    </h1>
    <p class="mx-auto mt-6 max-w-xl text-lg text-slate-600">
      TimeBill is the all-in-one tool for hourly contractors — time tracking,
      expenses, invoicing, and tax estimation, all in a single Mac app that
      stays out of your way.
    </p>
    <div class="mt-10">
      <button
        onclick={() => goto('/signup')}
        class="rounded-xl bg-brand-800 px-8 py-3.5 text-base font-semibold text-white shadow-lg shadow-brand-800/25 hover:bg-brand-700 transition"
      >
        Start your free trial →
      </button>
      <p class="mt-3 text-xs text-slate-400">No credit card required. Self-host or use our cloud.</p>
    </div>
  </section>

  <!-- Features grid -->
  <section class="bg-slate-50 px-6 py-24">
    <div class="mx-auto max-w-5xl">
      <h2 class="text-center text-2xl font-bold text-slate-900">Everything you need to run your practice</h2>
      <p class="mt-3 text-center text-slate-600">One app. No subscriptions to juggle. No features you'll never use.</p>

      <div class="mt-14 grid gap-8 sm:grid-cols-2 lg:grid-cols-3">
        <!-- Time tracking -->
        <div class="rounded-xl bg-white p-6 shadow-sm border border-slate-100">
          <span class="icon-[ph--clock-duotone] text-2xl text-brand-500" aria-hidden="true"></span>
          <h3 class="mt-4 text-base font-semibold text-slate-900">Time tracking</h3>
          <p class="mt-2 text-sm text-slate-600">
            Start and stop timers from the menu bar. Switch projects instantly.
            Time is tracked to the second, visible at a glance.
          </p>
        </div>

        <!-- Menubar timer -->
        <div class="rounded-xl bg-white p-6 shadow-sm border border-slate-100">
          <span class="icon-[ph--monitor-duotone] text-2xl text-brand-500" aria-hidden="true"></span>
          <h3 class="mt-4 text-base font-semibold text-slate-900">Live menu bar timer</h3>
          <p class="mt-2 text-sm text-slate-600">
            See your running total right in the macOS menu bar. The red recording dot
            and compact time label keep you aware without opening a window.
          </p>
        </div>

        <!-- Automatic app tracking -->
        <div class="rounded-xl bg-white p-6 shadow-sm border border-slate-100">
          <span class="icon-[ph--app-window-duotone] text-2xl text-brand-500" aria-hidden="true"></span>
          <h3 class="mt-4 text-base font-semibold text-slate-900">Automatic app tracking</h3>
          <p class="mt-2 text-sm text-slate-600">
            TimeBill knows which app you're using. See exactly how your tracked hours
            split across VS&nbsp;Code, Chrome, Terminal, and more.
          </p>
        </div>

        <!-- Invoicing -->
        <div class="rounded-xl bg-white p-6 shadow-sm border border-slate-100">
          <span class="icon-[ph--invoice-duotone] text-2xl text-brand-500" aria-hidden="true"></span>
          <h3 class="mt-4 text-base font-semibold text-slate-900">Invoicing</h3>
          <p class="mt-2 text-sm text-slate-600">
            Generate professional PDF invoices from your tracked time and expenses.
            Email them to clients in one click, or share a public link.
          </p>
        </div>

        <!-- Expense tracking -->
        <div class="rounded-xl bg-white p-6 shadow-sm border border-slate-100">
          <span class="icon-[ph--receipt-duotone] text-2xl text-brand-500" aria-hidden="true"></span>
          <h3 class="mt-4 text-base font-semibold text-slate-900">Expense tracking</h3>
          <p class="mt-2 text-sm text-slate-600">
            Log expenses, track mileage with automatic IRS rate snapshots, and
            attach billable items directly to client invoices.
          </p>
        </div>

        <!-- Tax estimation -->
        <div class="rounded-xl bg-white p-6 shadow-sm border border-slate-100">
          <span class="icon-[ph--calculator-duotone] text-2xl text-brand-500" aria-hidden="true"></span>
          <h3 class="mt-4 text-base font-semibold text-slate-900">Tax estimation</h3>
          <p class="mt-2 text-sm text-slate-600">
            See your estimated quarterly tax bill in real time. TimeBill tracks
            income, expenses, and mileage so you're never surprised at tax time.
          </p>
        </div>
      </div>
    </div>
  </section>

  <!-- Pricing -->
  <section class="px-6 py-24">
    <div class="mx-auto max-w-lg text-center">
      <h2 class="text-2xl font-bold text-slate-900">Simple pricing</h2>
      <p class="mt-3 text-slate-600">Self-host for free, or use our managed cloud.</p>

      <div class="mt-10 rounded-2xl border border-brand-200 bg-white p-8 shadow-lg shadow-brand-100/50">
        <div class="text-sm font-medium uppercase tracking-wider text-brand-600">Cloud</div>
        <div class="mt-3 font-mono">
          <span class="text-4xl font-bold text-slate-900">$9</span>
          <span class="text-slate-500">/month</span>
        </div>
        <p class="mt-2 text-sm text-slate-600">
          Unlimited time entries, expenses, invoices, and clients. 30-day free trial.
        </p>
        <ul class="mt-6 space-y-2 text-left text-sm text-slate-700">
          <li class="flex items-center gap-2">
            <span class="icon-[ph--check-circle-duotone] text-brand-500" aria-hidden="true"></span>
            Unlimited projects & clients
          </li>
          <li class="flex items-center gap-2">
            <span class="icon-[ph--check-circle-duotone] text-brand-500" aria-hidden="true"></span>
            Automatic app tracking
          </li>
          <li class="flex items-center gap-2">
            <span class="icon-[ph--check-circle-duotone] text-brand-500" aria-hidden="true"></span>
            PDF invoicing & email delivery
          </li>
          <li class="flex items-center gap-2">
            <span class="icon-[ph--check-circle-duotone] text-brand-500" aria-hidden="true"></span>
            Mileage & expense tracking
          </li>
          <li class="flex items-center gap-2">
            <span class="icon-[ph--check-circle-duotone] text-brand-500" aria-hidden="true"></span>
            Tax estimation dashboard
          </li>
        </ul>
        <button
          onclick={() => goto('/signup')}
          class="mt-8 w-full rounded-xl bg-brand-800 px-6 py-3 text-sm font-semibold text-white hover:bg-brand-700 transition"
        >
          Start free trial
        </button>
      </div>

      <p class="mt-6 text-sm text-slate-500">
        Prefer to self-host?
        <a href="#" class="text-brand-600 hover:text-brand-800 underline">TimeBill is open source</a>
        &mdash; run it on your own server with Docker.
      </p>
    </div>
  </section>

  <!-- Footer CTA -->
  <section class="bg-brand-800 px-6 py-20 text-center">
    <h2 class="text-2xl font-bold text-white">Ready to take control of your time?</h2>
    <p class="mt-3 text-brand-200">
      Join hundreds of contractors who track smarter with TimeBill.
    </p>
    <div class="mt-8">
      <button
        onclick={() => goto('/signup')}
        class="rounded-xl bg-white px-8 py-3.5 text-base font-semibold text-brand-800 shadow-lg hover:bg-brand-50 transition"
      >
        Start your free trial →
      </button>
    </div>
    <p class="mt-6 text-sm text-brand-300">
      &copy; {new Date().getFullYear()} TimeBill. All rights reserved.
    </p>
  </section>
</div>
