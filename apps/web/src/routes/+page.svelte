<script lang="ts">
  import { onMount } from 'svelte';
  import { goto } from '$app/navigation';
  import { browser } from '$app/environment';
  import { auth } from '$lib/auth.svelte';
  import LandingPage from '$lib/components/LandingPage.svelte';

  onMount(() => {
    if (auth.isLoggedIn) {
      const isMobile = browser && window.innerWidth < 1024;
      goto(isMobile ? '/time' : '/dashboard', { replaceState: true });
    }
  });
</script>

<LandingPage />
