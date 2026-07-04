<script lang="ts">
  import '../app.css';
  import { auth } from '$lib/auth.svelte';
  import { workspace } from '$lib/workspace.svelte';
  import { timer } from '$lib/timer.svelte';
  import { idle } from '$lib/idle.svelte';
  import AppShell from '$lib/components/AppShell.svelte';
  import IdleReturnModal from '$lib/components/IdleReturnModal.svelte';
  import ConfirmDialog from '$lib/components/ConfirmDialog.svelte';
  import { goto } from '$app/navigation';
  import { page } from '$app/stores';
  import { onMount, onDestroy } from 'svelte';

  let { children } = $props();

  const publicPaths = ['/login', '/signup', '/'];
  // / is only "public" (no AppShell) when the visitor isn't logged in.
  // When logged in, / is the dashboard and needs the full shell.
  let isPublic = $derived(
    publicPaths.includes($page.url.pathname) &&
    ($page.url.pathname !== '/' || !auth.isLoggedIn)
  );
  let isChromeless = $derived($page.url.pathname.startsWith('/menubar') || $page.url.pathname.startsWith('/i/'));

  $effect(() => {
    const path = $page.url.pathname;
    if (!auth.isLoggedIn && !publicPaths.includes(path)) {
      goto('/login');
    } else if (auth.isLoggedIn && publicPaths.includes(path) && path !== '/') {
      goto('/');
    }
  });

  let timerInitialized = false;
  $effect(() => {
    if (auth.isLoggedIn && !workspace.loaded && !workspace.loading) {
      workspace.load().then(() => {
        if (!timerInitialized) {
          timer.init();
          timerInitialized = true;
        }
      });
    }
    if (!auth.isLoggedIn && timerInitialized) {
      timer.dispose();
      timerInitialized = false;
    }
  });

  onMount(async () => {
    // Hooks up the Tauri `idle-detected` event listener — silently no-ops
    // outside the Tauri shell, so safe to call in the web build.
    idle.init();

    // In the Tauri menubar window, redirect to /menubar. (adapter-static's
    // SPA fallback always serves index.html, so the Tauri `url: "/menubar"`
    // config lands here at `/` instead of the menubar route.)
    if (typeof (window as any).__TAURI_INTERNALS__ !== 'undefined') {
      try {
        const { getCurrentWindow } = await import('@tauri-apps/api/window');
        const label = getCurrentWindow().label;
        if (label === 'menubar' && !$page.url.pathname.startsWith('/menubar')) {
          goto('/menubar');
        }
      } catch (_) {}
    }
  });

  onDestroy(() => {
    timer.dispose();
    idle.dispose();
  });
</script>

{#if isPublic || isChromeless || !auth.isLoggedIn}
  {@render children()}
{:else}
  <AppShell>{@render children()}</AppShell>
{/if}

<!-- Surfaced everywhere (including the chromeless /menubar route). -->
<IdleReturnModal />
<ConfirmDialog />
