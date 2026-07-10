<script lang="ts">
  import { onMount } from 'svelte';
  import { pb } from '$lib/pb';
  import { workspace } from '$lib/workspace.svelte';
  import { GIT_SHA, APP_VERSION } from '$lib/env';

  let name = $state('');
  let saving = $state(false);
  let status = $state('');
  let error = $state('');

  function load() {
    name = workspace.current?.name ?? '';
  }

  async function save(e: SubmitEvent) {
    e.preventDefault();
    if (!workspace.current) return;
    error = '';
    status = '';
    saving = true;
    try {
      const updated = await pb.collection('workspaces').update(workspace.current.id, { name });
      workspace.current = updated as unknown as typeof workspace.current;
      status = 'Saved. This name now appears on invoices.';
    } catch (err) {
      error = err instanceof Error ? err.message : 'Save failed';
    } finally {
      saving = false;
    }
  }

  onMount(load);
  $effect(() => {
    if (workspace.current) load();
  });
</script>

<div>
  <h2 class="text-lg font-semibold text-slate-900">Workspace</h2>
  <p class="mt-1 text-sm text-slate-600">
    This name appears as the <em>From</em> on every invoice (web view + PDF) and
    in the sidebar header.
  </p>

  <form
    onsubmit={save}
    class="mt-5 max-w-xl space-y-4 rounded-xl border border-slate-200 bg-white p-5"
  >
    <label class="block">
      <span class="text-sm text-slate-700">Company / workspace name</span>
      <input
        required
        bind:value={name}
        placeholder="Your Company, LLC"
        class="mt-1 w-full rounded border border-slate-300 px-3 py-2 text-sm focus:border-brand-500 focus:outline-none"
      />
    </label>

    {#if status}<p class="rounded bg-emerald-50 px-3 py-2 text-xs text-emerald-800">{status}</p>{/if}
    {#if error}<p class="rounded bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>{/if}

    <button
      type="submit"
      disabled={saving || !name.trim() || name === workspace.current?.name}
      class="rounded bg-brand-800 px-4 py-2 text-sm font-medium text-white hover:bg-brand-900 disabled:opacity-50"
    >
      {saving ? 'Saving…' : 'Save'}
    </button>
  </form>

  <!-- Build info — handy for desktop users checking what's deployed. -->
  <p class="mt-4 max-w-xl text-xs text-slate-400">
    v{APP_VERSION} · <code class="font-mono">{GIT_SHA}</code>
  </p>
</div>
