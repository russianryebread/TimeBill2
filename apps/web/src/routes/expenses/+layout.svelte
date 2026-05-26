<script lang="ts">
  import { page } from '$app/stores';
  let { children } = $props();

  const tabs = [
    { href: '/expenses', label: 'Expenses' },
    { href: '/expenses/mileage', label: 'Mileage' },
    { href: '/expenses/recurring', label: 'Recurring' }
  ];

  function isActive(href: string) {
    if (href === '/expenses') return $page.url.pathname === '/expenses';
    return $page.url.pathname.startsWith(href);
  }
</script>

<div class="mx-auto max-w-5xl px-8 py-8">
  <h1 class="text-2xl font-bold text-slate-900">Expenses</h1>
  <p class="mt-1 text-sm text-slate-600">Business spending, mileage, and recurring charges.</p>

  <nav class="mt-5 flex gap-1 border-b border-slate-200">
    {#each tabs as t}
      <a
        href={t.href}
        class="border-b-2 px-4 py-2 text-sm font-medium transition
          {isActive(t.href)
            ? 'border-brand-800 text-brand-800'
            : 'border-transparent text-slate-600 hover:text-slate-900'}"
      >
        {t.label}
      </a>
    {/each}
  </nav>

  <div class="mt-6">
    {@render children()}
  </div>
</div>
