<script lang="ts">
  import { auth } from '$lib/auth.svelte';
  import { goto } from '$app/navigation';

  let email = $state('');
  let password = $state('');
  let error = $state('');
  let submitting = $state(false);

  async function submit(e: SubmitEvent) {
    e.preventDefault();
    error = '';
    submitting = true;
    try {
      await auth.logIn(email, password);
      goto('/');
    } catch (err) {
      error = err instanceof Error ? err.message : 'Login failed';
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
      <h1 class="text-lg font-semibold">Sign in</h1>

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
      </label>

      {#if error}
        <p class="rounded bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>
      {/if}

      <button
        type="submit"
        disabled={submitting}
        class="w-full rounded bg-brand-600 px-3 py-2 text-sm font-medium text-white hover:bg-brand-700 disabled:opacity-50"
      >
        {submitting ? 'Signing in…' : 'Sign in'}
      </button>

      <p class="text-center text-sm text-slate-600">
        No account? <a href="/signup" class="font-medium text-brand-600 hover:underline">Sign up</a>
      </p>
    </form>
  </div>
</div>
