<script lang="ts">
  import { onMount } from 'svelte';
  import { pb } from '$lib/pb';
  import { workspace } from '$lib/workspace.svelte';
  import { ROUNDING_OPTIONS, roundHours } from '@timebill/shared/invoice';

  let saving = $state(false);
  let status = $state('');
  let current = $state<number>(0);

  function load() {
    current = workspace.current?.billing_rounding_minutes ?? 0;
  }

  async function setRounding(minutes: number) {
    if (!workspace.current) return;
    saving = true;
    status = '';
    try {
      const updated = await pb.collection('workspaces').update(workspace.current.id, {
        billing_rounding_minutes: minutes
      });
      // Sync the store
      workspace.current = updated as unknown as typeof workspace.current;
      current = minutes;
      status = 'Saved.';
    } catch (err) {
      status = err instanceof Error ? err.message : 'Save failed';
    } finally {
      saving = false;
    }
  }

  // Live preview of how rounding behaves
  const PREVIEW = [
    { label: '12 minutes', hours: 12 / 60 },
    { label: '47 minutes', hours: 47 / 60 },
    { label: '1 hour 5 minutes', hours: 65 / 60 },
    { label: '2 hours 33 minutes', hours: 153 / 60 }
  ];

  onMount(load);
  $effect(() => {
    if (workspace.current) load();
  });

  function fmtHours(h: number): string {
    return h.toFixed(2);
  }
</script>

<div>
  <h2 class="text-lg font-semibold text-slate-900">Billing rounding</h2>
  <p class="mt-1 text-sm text-slate-600">
    Round time-entry hours <em>up</em> to the nearest interval when pulling them
    onto an invoice. The underlying time entry keeps its exact duration, so
    Reports always show the truth — only invoice line items are rounded.
  </p>

  <div class="mt-5 flex flex-wrap gap-2">
    {#each ROUNDING_OPTIONS as opt}
      <button
        class="rounded-md border px-3 py-2 text-sm font-medium transition
          {current === opt.value
            ? 'border-brand-800 bg-brand-800 text-white'
            : 'border-slate-300 bg-white text-slate-700 hover:bg-slate-50'}"
        disabled={saving}
        onclick={() => setRounding(opt.value)}
      >
        {opt.label}
      </button>
    {/each}
  </div>

  {#if status}
    <p class="mt-2 text-xs text-slate-500">{status}</p>
  {/if}

  <div class="mt-8 overflow-hidden rounded-xl border border-slate-200 bg-white">
    <div class="border-b border-slate-100 px-5 py-3 text-sm font-medium text-slate-700">
      Preview · how durations get rounded for billing
    </div>
    <table class="w-full text-sm">
      <thead class="bg-slate-50 text-left text-xs uppercase tracking-wider text-slate-500">
        <tr>
          <th class="px-5 py-2 font-medium">Actual</th>
          <th class="px-5 py-2 text-right font-medium">Decimal hours</th>
          <th class="px-5 py-2 text-right font-medium">Billed (current setting)</th>
        </tr>
      </thead>
      <tbody>
        {#each PREVIEW as p}
          <tr class="border-t border-slate-100">
            <td class="px-5 py-2 text-slate-700">{p.label}</td>
            <td class="px-5 py-2 text-right font-mono text-slate-600">{fmtHours(p.hours)}</td>
            <td class="px-5 py-2 text-right font-mono text-slate-900">{fmtHours(roundHours(p.hours, current))}</td>
          </tr>
        {/each}
      </tbody>
    </table>
  </div>
</div>
