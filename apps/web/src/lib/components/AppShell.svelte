<script lang="ts">
  import { auth } from '$lib/auth.svelte';
  import { workspace } from '$lib/workspace.svelte';
  import { timer } from '$lib/timer.svelte';
  import { realtime } from '$lib/realtime.svelte';
  import { formatHMS } from '@timebill/shared/money';
  import { page } from '$app/stores';
  import { sidebar } from '$lib/sidebar.svelte';

  let { children } = $props();

  type NavItem = { href: string; label: string; icon: string; disabled?: boolean };
  const navItems: NavItem[] = [
    { href: '/dashboard', label: 'Dashboard', icon: 'icon-[ph--squares-four-duotone]' },
    { href: '/clients', label: 'Clients', icon: 'icon-[ph--users-three-duotone]' },
    { href: '/projects', label: 'Projects', icon: 'icon-[ph--folders-duotone]' },
    { href: '/expenses', label: 'Expenses', icon: 'icon-[ph--currency-dollar-duotone]' },
    { href: '/invoices', label: 'Invoices', icon: 'icon-[ph--file-text-duotone]' },
    { href: '/reports', label: 'Reports', icon: 'icon-[ph--chart-bar-duotone]' },
    { href: '/tax', label: 'Tax', icon: 'icon-[ph--calculator-duotone]' },
    { href: '/settings/workspace', label: 'Settings', icon: 'icon-[ph--gear-duotone]' }
  ];

  function isActive(href: string) {
    if (href === '/dashboard') return $page.url.pathname === '/dashboard';
    return $page.url.pathname.startsWith(href);
  }

  function navItemClick() {
    sidebar.close();
  }
</script>

{#snippet sidebarContent()}
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
        onclick={item.disabled ? undefined : navItemClick}
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
    <div class="flex items-center gap-2 truncate">
      {#if !realtime.connected}
        <span class="inline-block h-1.5 w-1.5 shrink-0 rounded-full bg-red-500" title="Realtime disconnected"></span>
      {/if}
      <span class="truncate text-xs text-slate-500" title={auth.user?.email ?? ''}>
        {auth.user?.email}
      </span>
    </div>
    <button
      class="flex h-8 w-8 shrink-0 items-center justify-center rounded text-slate-500 hover:bg-slate-100 hover:text-brand-800"
      onclick={() => auth.logOut()}
      title="Sign out" aria-label="Sign out"
    >
      <span class="icon-[ph--sign-out-duotone] text-lg" aria-hidden="true"></span>
    </button>
  </div>
{/snippet}

<div class="flex h-screen overflow-hidden bg-slate-50">
  <!-- Desktop: fixed sidebar -->
  <aside class="hidden lg:flex sticky top-0 w-56 h-screen flex-col border-r border-slate-200 bg-white">
    {@render sidebarContent()}
  </aside>

  <!-- Mobile: slide-out drawer -->
  {#if sidebar.open}
    <!-- Backdrop -->
    <button
      class="fixed inset-0 z-40 bg-slate-900/40 lg:hidden"
      onclick={() => sidebar.close()}
      aria-label="Close menu"
    ></button>
    <!-- Drawer -->
    <aside class="fixed inset-y-0 left-0 z-50 flex w-64 flex-col bg-white shadow-xl lg:hidden">
      {@render sidebarContent()}
    </aside>
  {/if}

  <!-- Main content -->
  <main class="flex-1 overflow-y-auto">
    <!-- Mobile top bar: hamburger + page title, visible on every route -->
    <header class="sticky top-0 z-30 flex items-center gap-3 border-b border-slate-200 bg-white px-4 py-2.5 lg:hidden">
      <button
        class="flex h-7 w-7 shrink-0 items-center justify-center rounded text-slate-600 hover:bg-slate-100"
        onclick={() => sidebar.toggle()}
        aria-label="Open menu"
      ><span class="icon-[ph--list-duotone] text-lg" aria-hidden="true"></span></button>
      <span class="truncate text-sm font-semibold text-slate-800">
        {#if $page.url.pathname === '/'}
          Time
        {:else if $page.url.pathname === '/dashboard'}
          Dashboard
        {:else if $page.url.pathname === '/time'}
          Time
        {:else if $page.url.pathname.startsWith('/clients')}
          Clients
        {:else if $page.url.pathname.startsWith('/projects')}
          Projects
        {:else if $page.url.pathname.startsWith('/expenses')}
          Expenses
        {:else if $page.url.pathname.startsWith('/invoices')}
          Invoices
        {:else if $page.url.pathname.startsWith('/reports')}
          Reports
        {:else if $page.url.pathname.startsWith('/tax')}
          Tax
        {:else if $page.url.pathname.startsWith('/settings')}
          Settings
        {:else}
          TimeBill
        {/if}
      </span>
      {#if !realtime.connected}
        <span class="ml-auto flex items-center gap-1 text-xs text-red-500" title="Realtime disconnected">
          <span class="inline-block h-1.5 w-1.5 rounded-full bg-red-500"></span>
          Offline
        </span>
      {/if}
    </header>
    {@render children()}
  </main>
</div>
