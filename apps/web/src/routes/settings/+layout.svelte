<script lang="ts">
  import { page } from '$app/stores';
  let { children } = $props();

  const tabs = [
    { href: '/settings/workspace', label: 'Workspace' },
    { href: '/settings/tasks', label: 'Activity types' },
    { href: '/settings/billing', label: 'Billing' },
    { href: '/settings/email', label: 'Email' },
    { href: '/settings/import', label: 'Import' }
  ];

  function isActive(href: string) {
    return $page.url.pathname.startsWith(href);
  }
</script>

<div class="mx-auto max-w-6xl px-8 py-8">
  <h1 class="text-2xl font-bold text-slate-900">Settings</h1>

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
