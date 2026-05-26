<script lang="ts">
  import '../app.css';
  import { auth } from '$lib/auth.svelte';
  import { workspace } from '$lib/workspace.svelte';
  import { timer } from '$lib/timer.svelte';
  import AppShell from '$lib/components/AppShell.svelte';
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
  });

  onDestroy(() => {
    timer.dispose();
  });
</script>

{#if isPublic || isChromeless || !auth.isLoggedIn}
  {@render children()}
{:else}
  <AppShell>{@render children()}</AppShell>
{/if}
