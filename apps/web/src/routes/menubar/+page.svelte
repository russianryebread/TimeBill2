<script lang="ts">
  import TimeTracker from '$lib/components/TimeTracker.svelte';
</script>

<div class="flex h-screen w-screen flex-col overflow-hidden bg-white">
  <TimeTracker isMenubar={true} />
</div>

<style>
  :global(html),
  :global(body) {
    background: transparent !important;
    -webkit-user-select: none;
    user-select: none;
    overflow: hidden;
    overscroll-behavior: none;
    height: 100%;
    margin: 0;
  }
  :global(input),
  :global(textarea) {
    -webkit-user-select: text;
    user-select: text;
  }
</style>
