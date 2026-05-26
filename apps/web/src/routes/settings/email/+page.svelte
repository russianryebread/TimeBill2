<script lang="ts">
  import { onMount } from 'svelte';
  import { pb } from '$lib/pb';
  import { workspace } from '$lib/workspace.svelte';

  let fromEmail = $state('');
  let fromName = $state('');
  let saving = $state(false);
  let status = $state('');
  let error = $state('');

  function load() {
    const w = workspace.current as
      | { invoice_from_email?: string; invoice_from_name?: string }
      | null
      | undefined;
    fromEmail = w?.invoice_from_email ?? '';
    fromName = w?.invoice_from_name ?? '';
  }

  async function save(e: SubmitEvent) {
    e.preventDefault();
    if (!workspace.current) return;
    error = '';
    status = '';
    saving = true;
    try {
      const updated = await pb.collection('workspaces').update(workspace.current.id, {
        invoice_from_email: fromEmail,
        invoice_from_name: fromName
      });
      workspace.current = updated as unknown as typeof workspace.current;
      status = 'Saved.';
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
  <h2 class="text-lg font-semibold text-slate-900">Email</h2>
  <p class="mt-1 text-sm text-slate-600">
    These values appear on outgoing invoice emails. SMTP itself (host, port,
    credentials) is configured in PocketBase admin —
    <a href="/_/" target="_blank" rel="noopener" class="text-brand-600 hover:underline">
      open admin
    </a>
    → Settings → Mail settings.
  </p>

  <form
    onsubmit={save}
    class="mt-5 max-w-xl space-y-4 rounded-xl border border-slate-200 bg-white p-5"
  >
    <label class="block">
      <span class="text-sm text-slate-700">From name</span>
      <input
        bind:value={fromName}
        placeholder="(defaults to workspace name)"
        class="mt-1 w-full rounded border border-slate-300 px-3 py-2 text-sm focus:border-brand-500 focus:outline-none"
      />
    </label>
    <label class="block">
      <span class="text-sm text-slate-700">From email</span>
      <input
        type="email"
        bind:value={fromEmail}
        placeholder="(defaults to SMTP sender configured in admin)"
        class="mt-1 w-full rounded border border-slate-300 px-3 py-2 text-sm focus:border-brand-500 focus:outline-none"
      />
    </label>

    {#if status}<p class="rounded bg-emerald-50 px-3 py-2 text-xs text-emerald-800">{status}</p>{/if}
    {#if error}<p class="rounded bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>{/if}

    <button
      type="submit"
      disabled={saving}
      class="rounded bg-brand-800 px-4 py-2 text-sm font-medium text-white hover:bg-brand-900 disabled:opacity-50"
    >
      {saving ? 'Saving…' : 'Save'}
    </button>
  </form>

  <div class="mt-6 max-w-xl rounded-xl border border-amber-200 bg-amber-50 p-4 text-xs text-amber-900">
    <strong>Heads up:</strong> if no SMTP is configured in PocketBase admin,
    "Send to client" still works — it just <em>logs</em> the email body to
    the PocketBase server output instead of actually delivering it. Useful for
    local testing.
  </div>
</div>
