<script lang="ts">
  import { auth } from '$lib/auth.svelte';
  import { workspace } from '$lib/workspace.svelte';
  import { timer } from '$lib/timer.svelte';
  import { formatHMS } from '@timebill/shared/money';
  import { page } from '$app/stores';

  let { children } = $props();

  type NavItem = { href: string; label: string; icon: string; disabled?: boolean };
  // Iconify class names are written out in full so Tailwind's source scanner
  // picks them up (interpolated values like `icon-[${name}]` are NOT seen).
  const navItems: NavItem[] = [
    { href: '/', label: 'Dashboard', icon: 'icon-[ph--squares-four-duotone]' },
    { href: '/time', label: 'Time', icon: 'icon-[ph--clock-duotone]' },
    { href: '/clients', label: 'Clients', icon: 'icon-[ph--users-three-duotone]' },
    { href: '/projects', label: 'Projects', icon: 'icon-[ph--folders-duotone]' },
    { href: '/expenses', label: 'Expenses', icon: 'icon-[ph--currency-dollar-duotone]' },
    { href: '/invoices', label: 'Invoices', icon: 'icon-[ph--file-text-duotone]' },
    { href: '/reports', label: 'Reports', icon: 'icon-[ph--chart-bar-duotone]' },
    { href: '/settings/workspace', label: 'Settings', icon: 'icon-[ph--gear-duotone]' }
  ];

  function isActive(href: string) {
    if (href === '/') return $page.url.pathname === '/';
    return $page.url.pathname.startsWith(href);
  }
</script>

<div class="flex h-screen overflow-hidden bg-slate-50">
  <aside class="sticky top-0 flex h-screen w-56 flex-col border-r border-slate-200 bg-white">
    <div class="flex items-center gap-2 px-5 py-4">
      <img src="/logo.png" alt="" class="h-8 w-8 rounded-md" />
      <span class="text-lg font-semibold tracking-tight text-brand-800">TimeBill</span>
    </div>

    {#if workspace.current}
      <div class="border-t border-b border-slate-100 px-5 py-2 text-xs uppercase tracking-wider text-slate-500">
        {workspace.current.name}
      </div>
    {/if}

    <nav class="flex-1 space-y-0.5 overflow-y-auto py-3">
      {#each navItems as item}
        <a
          href={item.disabled ? undefined : item.href}
          class="mx-2 flex items-center justify-between rounded px-3 py-2 text-sm
            {isActive(item.href) ? 'bg-brand-50 text-brand-800 font-medium' : 'text-slate-700 hover:bg-slate-100'}
            {item.disabled ? 'pointer-events-none opacity-40' : ''}"
        >
          <span class="flex items-center gap-3">
            <span class="{item.icon} text-lg" aria-hidden="true"></span>
            <span>{item.label}</span>
          </span>
          {#if item.disabled}<span class="text-[10px] uppercase text-slate-400">soon</span>{/if}
        </a>
      {/each}
    </nav>

    {#if timer.running}
      <div class="mx-3 mb-3 rounded-lg border border-brand-400 bg-brand-50 p-3">
        <div class="flex items-center gap-2 text-xs font-medium text-brand-700">
          <span class="inline-block h-2 w-2 animate-pulse rounded-full bg-brand-400"></span>
          Timer running
        </div>
        <div class="mt-1 text-sm font-semibold text-brand-800">
          {timer.running.expand?.project?.name ?? 'Project'}
        </div>
        <div class="mt-1 font-mono text-lg text-brand-800">{formatHMS(timer.elapsedMs)}</div>
        <button
          class="mt-2 w-full rounded bg-brand-800 px-2 py-1 text-xs font-medium text-white hover:bg-brand-900"
          onclick={() => timer.stop()}
        >
          Stop
        </button>
      </div>
    {/if}

    <div class="flex items-center justify-between border-t border-slate-100 px-4 py-3">
      <span class="truncate text-xs text-slate-500" title={auth.user?.email ?? ''}>
        {auth.user?.email}
      </span>
      <button
        class="flex h-8 w-8 shrink-0 items-center justify-center rounded text-slate-500 hover:bg-slate-100 hover:text-brand-800"
        onclick={() => auth.logOut()}
        title="Sign out"
        aria-label="Sign out"
      >
        <span class="icon-[ph--sign-out-duotone] text-lg" aria-hidden="true"></span>
      </button>
    </div>
  </aside>

  <main class="flex-1 overflow-y-auto">
    {@render children()}
  </main>
</div>
