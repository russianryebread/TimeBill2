<script lang="ts">
  import { onMount } from 'svelte';
  import { auth } from '$lib/auth.svelte';
  import { workspace } from '$lib/workspace.svelte';
  import { goto } from '$app/navigation';
  import { pb, pbUrl } from '$lib/pb';

  let email = $state('');
  let password = $state('');
  let error = $state('');
  let submitting = $state(false);

  let isTauri = $state(false);
  let serverOpen = $state(false);
  let urlDraft = $state(pbUrl);

  onMount(() => {
    isTauri = typeof (window as any).__TAURI_INTERNALS__ !== 'undefined';
    if (isTauri && !localStorage.getItem('pb_url')) {
      serverOpen = true;
    }
  });

  function saveServerUrl() {
    const trimmed = urlDraft.trim();
    if (!trimmed) return;
    localStorage.setItem('pb_url', trimmed);
    pb.authStore.clear();
    window.location.reload();
  }

  async function submit(e: SubmitEvent) {
    e.preventDefault();
    error = '';
    submitting = true;
    try {
      await auth.signUp(email, password);
      await workspace.load();

      // Detect if we're in the menubar window and redirect accordingly
      let redirectPath = '/';
      if (typeof (window as any).__TAURI_INTERNALS__ !== 'undefined') {
        try {
          const { getCurrentWindow } = await import('@tauri-apps/api/window');
          const label = getCurrentWindow().label;
          if (label === 'menubar') {
            redirectPath = '/menubar';
          }
        } catch (_) {}
      }
      goto(redirectPath);
    } catch (err) {
      error = err instanceof Error ? err.message : 'Signup failed';
    } finally {
      submitting = false;
    }
  }
</script>

<div class="flex min-h-screen items-center justify-center bg-slate-50 px-6">
  <div class="w-full max-w-sm">
    <div class="mb-6 flex items-center justify-center gap-2">
      <img src="/logo.png" alt="" class="h-10 w-10 rounded-md" />
      <span class="text-xl font-semibold">TimeBill</span>
    </div>
    <form
      onsubmit={submit}
      class="space-y-4 rounded-xl border border-slate-200 bg-white p-6 shadow-sm"
    >
      <h1 class="text-lg font-semibold">Create account</h1>

      <label class="block">
        <span class="text-sm text-slate-700">Email</span>
        <input
          type="email"
          required
          bind:value={email}
          class="mt-1 w-full rounded border border-slate-300 px-3 py-2 text-sm focus:border-brand-500 focus:outline-none"
        />
      </label>

      <label class="block">
        <span class="text-sm text-slate-700">Password</span>
        <input
          type="password"
          required
          minlength="8"
          bind:value={password}
          class="mt-1 w-full rounded border border-slate-300 px-3 py-2 text-sm focus:border-brand-500 focus:outline-none"
        />
        <span class="mt-1 block text-xs text-slate-500">At least 8 characters.</span>
      </label>

      {#if error}
        <p class="rounded bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>
      {/if}

      <button
        type="submit"
        disabled={submitting}
        class="w-full rounded bg-brand-600 px-3 py-2 text-sm font-medium text-white hover:bg-brand-700 disabled:opacity-50"
      >
        {submitting ? 'Creating account…' : 'Create account'}
      </button>

      <p class="text-center text-sm text-slate-600">
        Already have an account?
        <a href="/login" class="font-medium text-brand-600 hover:underline">Sign in</a>
      </p>

      {#if isTauri}
      <div class="border-t border-slate-100 pt-2">
        <button
          type="button"
          onclick={() => (serverOpen = !serverOpen)}
          class="flex items-center gap-1 text-xs text-slate-400 hover:text-slate-600"
        >
          <span
            class={serverOpen ? 'icon-[ph--caret-down]' : 'icon-[ph--caret-right]'}
            aria-hidden="true"
          ></span>
          Server
        </button>
        {#if serverOpen}
          <div class="mt-2">
            <label class="block text-xs text-slate-600">
              Server URL
              <div class="mt-1 flex gap-2">
                <input
                  type="url"
                  bind:value={urlDraft}
                  placeholder="http://..."
                  class="min-w-0 flex-1 rounded border border-slate-300 px-2 py-1.5 text-xs focus:border-brand-500 focus:outline-none"
                />
                <button
                  type="button"
                  onclick={saveServerUrl}
                  class="shrink-0 rounded bg-brand-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-brand-700"
                >Save</button>
              </div>
            </label>
          </div>
        {/if}
      </div>
      {/if}
    </form>
  </div>
</div>
