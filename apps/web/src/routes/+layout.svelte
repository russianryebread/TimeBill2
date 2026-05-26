<script lang="ts">
  import '../app.css';
  import { auth } from '$lib/auth.svelte';
  import { workspace } from '$lib/workspace.svelte';
  import { timer } from '$lib/timer.svelte';
  import { idle } from '$lib/idle.svelte';
  import AppShell from '$lib/components/AppShell.svelte';
  import IdleReturnModal from '$lib/components/IdleReturnModal.svelte';
  import { goto } from '$app/navigation';
  import { page } from '$app/stores';
  import { onMount, onDestroy } from 'svelte';

  let { children } = $props();

  const publicPaths = ['/login', '/signup'];
  let isPublic = $derived(publicPaths.includes($page.url.pathname));
  let isChromeless = $derived($page.url.pathname.startsWith('/menubar') || $page.url.pathname.startsWith('/i/'));

  $effect(() => {
    const path = $page.url.pathname;
    if (!auth.isLoggedIn && !publicPaths.includes(path)) {
      goto('/login');
    } else if (auth.isLoggedIn && publicPaths.includes(path)) {
      goto('/');
    }
  });

  let timerInitialized = false;
  $effect(() => {
    if (auth.isLoggedIn && !workspace.current && !workspace.loading) {
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

  onMount(() => {
    if (auth.isLoggedIn) workspace.load();
    // Hooks up the Tauri `idle-detected` event listener — silently no-ops
    // outside the Tauri shell, so safe to call in the web build.
    idle.init();
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
