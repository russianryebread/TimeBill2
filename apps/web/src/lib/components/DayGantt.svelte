<script lang="ts">
  import { formatHours } from '@timebill/shared/money';

  // Structural Entry type so callers can pass their own (richer) shape.
  type GanttEntry = {
    id: string;
    started_at: string;
    ended_at: string | null;
    description: string;
    expand?: {
      project?: { name: string; color?: string };
    };
  };

  type Props<T extends GanttEntry = GanttEntry> = {
    entries: T[];
    onEntryClick?: (e: T) => void;
  };

  let { entries, onEntryClick }: Props = $props();

  /**
   * Horizontal Gantt-style daily timeline. X-axis auto-fits to the earliest
   * start and latest end (or "now" if anything is still running). Entries are
   * laid out into rows so overlapping intervals don't visually collide.
   */
  type Bar = {
    entry: GanttEntry;
    startMs: number;
    endMs: number;
    row: number;
  };

  let bars = $derived.by(() => {
    const items = entries.map((e) => ({
      entry: e,
      startMs: new Date(e.started_at).getTime(),
      endMs: e.ended_at ? new Date(e.ended_at).getTime() : Date.now()
    }));
    // Sort by start, then greedily place each into the lowest available row.
    items.sort((a, b) => a.startMs - b.startMs);
    const rowEnds: number[] = [];
    const placed: Bar[] = items.map((it) => {
      let row = rowEnds.findIndex((end) => end <= it.startMs);
      if (row === -1) {
        row = rowEnds.length;
        rowEnds.push(it.endMs);
      } else {
        rowEnds[row] = it.endMs;
      }
      return { ...it, row };
    });
    return placed;
  });

  let rowCount = $derived(Math.max(1, ...bars.map((b) => b.row + 1)));

  let range = $derived.by(() => {
    if (bars.length === 0) {
      // Empty day — show 9am-5pm as a reasonable default
      const day = new Date();
      day.setHours(9, 0, 0, 0);
      const end = new Date(day);
      end.setHours(17, 0, 0, 0);
      return { start: day.getTime(), end: end.getTime() };
    }
    let start = Math.min(...bars.map((b) => b.startMs));
    let end = Math.max(...bars.map((b) => b.endMs));
    // Pad to nearest hour on each side
    const padMs = 30 * 60 * 1000; // 30 min padding
    start -= padMs;
    end += padMs;
    // Snap to whole hours
    start = new Date(start).setMinutes(0, 0, 0);
    const endDate = new Date(end);
    if (endDate.getMinutes() > 0 || endDate.getSeconds() > 0) {
      endDate.setHours(endDate.getHours() + 1, 0, 0, 0);
    }
    end = endDate.getTime();
    return { start, end };
  });

  let ticks = $derived.by(() => {
    const r = range;
    const out: { ms: number; label: string }[] = [];
    const oneHour = 3_600_000;
    const start = Math.ceil(r.start / oneHour) * oneHour;
    for (let t = start; t <= r.end; t += oneHour) {
      const d = new Date(t);
      out.push({
        ms: t,
        label: d.toLocaleTimeString('en-US', { hour: 'numeric' }).replace(' ', '').toLowerCase()
      });
    }
    return out;
  });

  function pct(ms: number): number {
    const span = range.end - range.start;
    if (span <= 0) return 0;
    return ((ms - range.start) / span) * 100;
  }

  function widthPct(b: Bar): number {
    const span = range.end - range.start;
    return ((b.endMs - b.startMs) / span) * 100;
  }

  function tooltipFor(b: Bar): string {
    const start = new Date(b.startMs).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
    const end = b.entry.ended_at
      ? new Date(b.endMs).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })
      : 'now';
    const dur = formatHours(b.endMs - b.startMs);
    const proj = b.entry.expand?.project?.name ?? '';
    const desc = b.entry.description ? ` · ${b.entry.description}` : '';
    return `${proj}${desc}\n${start}–${end} (${dur})`;
  }
</script>

<div class="relative">
  <!-- Bars -->
  <div
    class="relative w-full"
    style:height="{rowCount * 32 + 8}px"
  >
    {#each bars as bar (bar.entry.id)}
      <button
        type="button"
        class="absolute flex items-center overflow-hidden rounded-md text-left text-xs text-white shadow-sm transition hover:brightness-110 disabled:cursor-default"
        style:left="{pct(bar.startMs)}%"
        style:width="{Math.max(widthPct(bar), 0.6)}%"
        style:top="{bar.row * 32}px"
        style:height="26px"
        style:background-color={bar.entry.expand?.project?.color ?? '#94a3b8'}
        onclick={() => onEntryClick?.(bar.entry)}
        title={tooltipFor(bar)}
        disabled={!bar.entry.ended_at}
      >
        <span class="truncate px-2 font-medium">{bar.entry.expand?.project?.name ?? '—'}</span>
      </button>
    {/each}
    {#if bars.length === 0}
      <div class="flex h-full items-center justify-center text-xs text-slate-400">
        No time tracked this day.
      </div>
    {/if}
  </div>

  <!-- Axis -->
  <div class="relative mt-1 h-5 border-t border-slate-200">
    {#each ticks as tick}
      <div
        class="absolute top-0 -translate-x-1/2 text-[10px] uppercase tracking-wider text-slate-500"
        style:left="{pct(tick.ms)}%"
      >
        <span class="block h-1.5 w-px bg-slate-300" aria-hidden="true"></span>
        <span class="block pt-0.5">{tick.label}</span>
      </div>
    {/each}
  </div>
</div>
