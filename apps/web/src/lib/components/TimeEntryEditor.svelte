<script lang="ts">
  import { onMount } from 'svelte';
  import { pb } from '$lib/pb';
  import { confirmAction } from '$lib/confirm.svelte';
    import { tempDir } from '@tauri-apps/api/path';

  type Entry = {
    id: string;
    project: string;
    task: string;
    started_at: string;
    ended_at: string | null;
    description: string;
    billable: boolean;
    invoice: string;
    expand?: { project?: { name: string }; task?: { name: string } };
  };
  type ProjectOption = {
    id: string;
    name: string;
    expand?: { client?: { name: string } };
  };
  type TaskOption = { id: string; name: string };

  type Props = {
    entry: Entry;
    projects: ProjectOption[];
    tasks: TaskOption[];
    onClose: () => void;
    onSaved: () => void;
  };

  let { entry, projects, tasks, onClose, onSaved }: Props = $props();

  function toLocalInputValue(s: string): string {
    const d = new Date(s);
    const pad = (n: number) => n.toString().padStart(2, '0');
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
  }
  function fromLocalInputValue(s: string): string {
    return new Date(s).toISOString();
  }
  function hoursBetween(start: string, end: string): number {
    const ms = new Date(end).getTime() - new Date(start).getTime();
    return Math.max(0, ms / 3_600_000);
  }

  // Snapshot the initial entry — editor is opened on one entry at a time.
  const initial = entry;
  const locked = !!initial.invoice;

  let form = $state({
    project: initial.project,
    task: initial.task || '',
    started_at: toLocalInputValue(initial.started_at),
    ended_at: initial.ended_at ? toLocalInputValue(initial.ended_at) : '',
    description: initial.description,
    billable: initial.billable
  });

  // Decimal-hour mirror of (ended - started). When user edits this,
  // we adjust ended_at; when they edit clock times, we recompute this.
  let hoursInput = $state(
    initial.ended_at ? hoursBetween(initial.started_at, initial.ended_at).toFixed(2) : '0.00'
  );

  // Edits to clock-time inputs propagate into hours.
  // Edits to hours propagate into ended_at.
  let syncFrom: 'hours' | 'clocks' | null = null;

  function onHoursChange() {
    syncFrom = 'hours';
    const n = Number(hoursInput);
    if (Number.isNaN(n) || n < 0) return;
    const startMs = new Date(form.started_at).getTime();
    if (Number.isNaN(startMs)) return;
    const endMs = startMs + n * 3_600_000;
    form.ended_at = toLocalInputValue(new Date(endMs).toISOString());
  }

  function onClockChange() {
    if (syncFrom === 'hours') {
      syncFrom = null;
      return;
    }
    const h = hoursBetween(
      fromLocalInputValue(form.started_at),
      fromLocalInputValue(form.ended_at || form.started_at)
    );
    hoursInput = h.toFixed(2);
  }

  $effect(() => {
    // Trigger on clock-time edits.
    void form.started_at;
    void form.ended_at;
    onClockChange();
  });

  let error = $state('');
  let saving = $state(false);

  // Fetch the invoice number for locked entries so we can link to it.
  let invoiceNumber = $state('');
  onMount(async () => {
    if (locked && initial.invoice) {
      try {
        const inv = await pb.collection('invoices').getOne(initial.invoice);
        invoiceNumber = inv.number;
      } catch (_) {
        invoiceNumber = 'invoice';
      }
    }
  });

  async function save(e: SubmitEvent) {
    e.preventDefault();
    error = '';
    saving = true;
    try {
      const startMs = new Date(form.started_at).getTime();
      const endMs = new Date(form.ended_at).getTime();
      if (Number.isNaN(startMs) || Number.isNaN(endMs)) {
        error = 'Invalid dates';
        return;
      }
      if (endMs <= startMs) {
        error = 'End time must be after start time';
        return;
      }
      await pb.collection('time_entries').update(initial.id, {
        project: form.project,
        task: form.task || null,
        started_at: fromLocalInputValue(form.started_at),
        ended_at: fromLocalInputValue(form.ended_at),
        description: form.description,
        billable: form.billable
      });
      onSaved();
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Save failed';
      error = msg;
    } finally {
      saving = false;
    }
  }

  async function remove() {
    if (locked) return;
    if (!(await confirmAction({
      message: 'Delete this time entry?',
      detail: 'This permanently removes the entry. You can\'t undo this.',
      confirmLabel: 'Delete'
    }))) return;
    await pb.collection('time_entries').delete(initial.id);
    onSaved();
  }
</script>

<div
  class="fixed inset-0 z-40 flex items-center justify-center bg-slate-900/40 p-4"
  role="dialog"
  aria-modal="true"
>
  <form onsubmit={save} class="w-full max-w-sm space-y-1.5 rounded-xl bg-white p-3 shadow-xl">
    {#if locked}
      <div class="flex items-center gap-2 rounded bg-amber-50 px-2 py-1.5">
        {#if invoiceNumber}
          <a href={`/invoices/${initial.invoice}`} onclick={onClose}
            class="flex items-center gap-1 text-xs font-medium text-amber-800 hover:text-amber-900">
            <span class="icon-[ph--lock-key-duotone]" aria-hidden="true"></span>
            {invoiceNumber}
            <span class="icon-[ph--arrow-up-right]" aria-hidden="true"></span>
          </a>
        {:else}
          <span class="text-xs text-amber-800"><span class="icon-[ph--lock-key-duotone]" aria-hidden="true"></span> Invoiced</span>
        {/if}
      </div>
    {/if}

    <div class="grid grid-cols-2 gap-2">
      <!-- Primary: hours-first input -->
      <label class="block">
        <span class="text-xs text-slate-700">Decimal Hours</span>
        <input
          inputmode="decimal"
          step="0.05"
          min="0"
          required
          disabled={locked}
          bind:value={hoursInput}
          oninput={onHoursChange}
          class="mt-0.5 w-full rounded border border-slate-300 px-2 py-1 text-right font-mono text-sm focus:border-brand-500 focus:outline-none disabled:bg-slate-50 disabled:text-slate-500"
        />
      </label>

      <div class="flex items-center justify-end gap-2 text-xs text-slate-700">
        <span>Billable</span>
        <button type="button" disabled={locked}
          onclick={() => form.billable = !form.billable}
          class="inline-flex h-5 w-9 shrink-0 items-center rounded-full transition-colors disabled:opacity-40 {form.billable ? 'bg-brand-500' : 'bg-slate-300'}">
          <span class="inline-block h-3.5 w-3.5 rounded-full bg-white transition-transform"
            style="transform: translateX({form.billable ? '18px' : '2px'})"></span>
        </button>
      </div>
    </div>

    <label class="block">
      <span class="text-xs text-slate-700">Start Date/Time</span>
      <input
        type="datetime-local"
        required
        disabled={locked}
        bind:value={form.started_at}
        class="mt-0.5 w-full rounded border border-slate-300 px-2 py-1 text-sm focus:border-brand-500 focus:outline-none disabled:bg-slate-50 disabled:text-slate-500"
      />
    </label>
    <label class="block">
      <span class="text-xs text-slate-700">End Date/Time</span>
      <input
        type="datetime-local"
        required
        disabled={locked}
        bind:value={form.ended_at}
        class="mt-0.5 w-full rounded border border-slate-300 px-2 py-1 text-sm focus:border-brand-500 focus:outline-none disabled:bg-slate-50 disabled:text-slate-500"
      />
    </label>

    <div class="grid grid-cols-2 gap-2 border-t border-slate-100">
      <label class="block">
        <span class="text-xs font-medium text-slate-700">Project</span>
        <select
          required
          disabled={locked}
          bind:value={form.project}
          class="mt-0.5 w-full rounded border border-slate-300 px-2 py-1.5 text-xs focus:border-brand-500 focus:outline-none disabled:bg-slate-50 disabled:text-slate-500"
        >
          {#each projects as p}
            <option value={p.id}>
              {p.expand?.client?.name ? `${p.expand.client.name} — ` : ''}{p.name}
            </option>
          {/each}
        </select>
      </label>

      <label class="block">
        <span class="text-xs font-medium text-slate-700">Activity</span>
        <select
          disabled={locked}
          bind:value={form.task}
          class="mt-0.5 w-full rounded border border-slate-300 px-2 py-1.5 text-xs focus:border-brand-500 focus:outline-none disabled:bg-slate-50 disabled:text-slate-500"
        >
          <option value="">—</option>
          {#each tasks as t}
            <option value={t.id}>{t.name}</option>
          {/each}
        </select>
      </label>
    </div>

    <label class="block">
      <span class="text-xs font-medium text-slate-700">Description</span>
      <textarea
        disabled={locked}
        bind:value={form.description}
        class="mt-0.5 w-full rounded border border-slate-300 px-2 py-1.5 text-xs focus:border-brand-500 focus:outline-none disabled:bg-slate-50 disabled:text-slate-500"
        rows={4}></textarea>
    </label>

    {#if error}
      <p class="rounded bg-red-50 px-2 py-1.5 text-xs text-red-700">{error}</p>
    {/if}

    <div class="flex items-center justify-between">
      {#if !locked}
        <button
          type="button"
          class="rounded px-2 py-1 text-xs text-red-600 hover:bg-red-50"
          onclick={remove}
        >
          Delete
        </button>
      {:else}
        <span></span>
      {/if}
      <div class="flex gap-1.5">
        <button
          type="button"
          class="rounded px-3 py-1 text-xs text-slate-600 hover:bg-slate-100"
          onclick={onClose}
        >
          {locked ? 'Close' : 'Cancel'}
        </button>
        {#if !locked}
          <button
            type="submit"
            class="rounded bg-brand-800 px-3 py-1 text-xs font-medium text-white hover:bg-brand-900 disabled:opacity-50"
            disabled={saving}
          >
            {saving ? 'Saving…' : 'Save'}
          </button>
        {/if}
      </div>
    </div>
  </form>
</div>
