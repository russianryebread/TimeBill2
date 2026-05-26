<script lang="ts">
  import { idle } from '$lib/idle.svelte';
  import { timer } from '$lib/timer.svelte';
  import { pb } from '$lib/pb';

  type Action = 'keep' | 'discard' | 'stop';

  let busy = $state(false);
  let error = $state('');

  function formatMinutes(secs: number): string {
    const m = Math.floor(secs / 60);
    const h = Math.floor(m / 60);
    if (h > 0) return `${h}h ${m % 60}m`;
    return `${m} min`;
  }

  /**
   * Idle period is `idle.idleSeconds`; the user has just returned (last input
   * event was that long ago + a few seconds at most, since we're polling at
   * 30s and the renderer reacts on event). We treat now − idleSeconds as the
   * "idle started at" timestamp.
   */
  async function act(action: Action) {
    if (!timer.running) {
      idle.dismiss();
      return;
    }
    busy = true;
    error = '';
    try {
      const idleMs = idle.idleSeconds * 1000;
      const idleStart = new Date(Date.now() - idleMs);
      if (action === 'keep') {
        // Nothing to do. Idle time stays on the running entry.
      } else if (action === 'discard') {
        // Stop the timer at the idle-start moment, throwing away the idle
        // span. The single-running-timer hook also handles rate snapshot.
        await pb.collection('time_entries').update(timer.running.id, {
          ended_at: idleStart.toISOString()
        });
      } else if (action === 'stop') {
        // Stop at idle start AND don't keep tracking — same write as
        // "discard"; semantically the same here, but we keep the action
        // separate so future-us could split into "stop here" vs
        // "discard and restart fresh".
        await pb.collection('time_entries').update(timer.running.id, {
          ended_at: idleStart.toISOString()
        });
      }
      idle.dismiss();
    } catch (err) {
      error = err instanceof Error ? err.message : 'Failed to update entry';
    } finally {
      busy = false;
    }
  }
</script>

{#if idle.prompt && timer.running}
  <div
    class="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 p-4"
    role="dialog"
    aria-modal="true"
  >
    <div class="w-full max-w-md rounded-xl bg-white p-6 shadow-xl">
      <div class="flex items-start gap-3">
        <span class="icon-[ph--moon-stars-duotone] text-3xl text-brand-700" aria-hidden="true"></span>
        <div class="flex-1">
          <h2 class="text-lg font-semibold text-slate-900">Welcome back</h2>
          <p class="mt-1 text-sm text-slate-600">
            You were idle for <strong>{formatMinutes(idle.idleSeconds)}</strong>
            while the timer kept running on
            <strong>{timer.running.expand?.project?.name ?? 'a project'}</strong>.
            What should we do with that time?
          </p>
        </div>
      </div>

      {#if error}
        <p class="mt-3 rounded bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>
      {/if}

      <div class="mt-5 grid gap-2">
        <button
          class="flex items-start gap-3 rounded-lg border border-slate-200 px-4 py-3 text-left hover:border-brand-500 hover:bg-brand-50 disabled:opacity-50"
          onclick={() => act('keep')}
          disabled={busy}
        >
          <span class="icon-[ph--check-circle-duotone] mt-0.5 text-xl text-emerald-700" aria-hidden="true"></span>
          <div class="flex-1">
            <div class="font-medium text-slate-900">Keep the time</div>
            <div class="text-xs text-slate-500">
              You were working through it. Timer keeps running.
            </div>
          </div>
        </button>
        <button
          class="flex items-start gap-3 rounded-lg border border-slate-200 px-4 py-3 text-left hover:border-brand-500 hover:bg-brand-50 disabled:opacity-50"
          onclick={() => act('discard')}
          disabled={busy}
        >
          <span class="icon-[ph--scissors-duotone] mt-0.5 text-xl text-amber-700" aria-hidden="true"></span>
          <div class="flex-1">
            <div class="font-medium text-slate-900">Discard idle time</div>
            <div class="text-xs text-slate-500">
              Stop the timer at the moment you stepped away.
            </div>
          </div>
        </button>
        <button
          class="flex items-start gap-3 rounded-lg border border-slate-200 px-4 py-3 text-left hover:border-brand-500 hover:bg-brand-50 disabled:opacity-50"
          onclick={() => act('stop')}
          disabled={busy}
        >
          <span class="icon-[ph--stop-circle-duotone] mt-0.5 text-xl text-slate-700" aria-hidden="true"></span>
          <div class="flex-1">
            <div class="font-medium text-slate-900">Stop the timer</div>
            <div class="text-xs text-slate-500">
              Stop at the idle-start moment. You can start a new one fresh.
            </div>
          </div>
        </button>
      </div>

      <div class="mt-4 flex justify-end">
        <button
          class="rounded px-3 py-1.5 text-xs text-slate-500 hover:bg-slate-100 disabled:opacity-50"
          onclick={() => idle.dismiss()}
          disabled={busy}
        >
          Ask again later
        </button>
      </div>
    </div>
  </div>
{/if}
