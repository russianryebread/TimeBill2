/**
 * Toggl Track "Detailed report" CSV parser.
 *
 * Toggl's detailed CSV export (Reports → Detailed → Download → CSV) ships
 * with these columns (we only care about a subset, case-insensitive):
 *   User, Email, Client, Project, Task, Description, Billable,
 *   Start date, Start time, End date, End time, Duration,
 *   Tags, Amount (USD), Rate
 *
 * Differences from Harvest worth knowing:
 *  - `Billable` is "Yes" / "No" (not "Yes"/"No" with question mark).
 *  - Toggl gives real timestamps via `Start date`+`Start time` and
 *    `End date`+`End time`, so we plumb them through as `startISO`/`endISO`
 *    on the row and let the importer use them verbatim.
 *  - `Duration` is `HH:MM:SS`.
 *  - `Amount` is the total earned for the row (Toggl multiplied rate × hours).
 *    We derive `rate_cents` from `Rate` if present, else `Amount / hours`,
 *    else 0.
 *  - Toggl allows projects without clients. TimeBill *requires* a client on
 *    every project, so rows with empty `Client` are skipped + reported in
 *    the error list.
 */
import { splitCsvRow } from './csv';
import type { HarvestRow, ImportPreview } from './harvest';

export type TogglRow = HarvestRow & {
  startISO: string;
  endISO: string;
};

export type TogglParseResult = {
  rows: TogglRow[];
  errors: { line: number; reason: string }[];
  headerMap: Record<string, number>;
};

function parseDateOnly(raw: string): string | null {
  const s = (raw ?? '').trim();
  if (!s) return null;
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;
  const slash = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2,4})$/);
  if (slash) {
    let [, mm, dd, yyyy] = slash;
    if (yyyy!.length === 2) yyyy = `20${yyyy}`;
    return `${yyyy}-${mm!.padStart(2, '0')}-${dd!.padStart(2, '0')}`;
  }
  return null;
}

function parseTime(raw: string): string | null {
  const s = (raw ?? '').trim();
  if (!s) return null;
  // Toggl exports 24-hour `HH:MM:SS` or `HH:MM`.
  const m = s.match(/^(\d{1,2}):(\d{2})(?::(\d{2}))?$/);
  if (!m) return null;
  const hh = m[1]!.padStart(2, '0');
  const mm = m[2]!;
  const ss = (m[3] ?? '00').padStart(2, '0');
  return `${hh}:${mm}:${ss}`;
}

function parseDurationHours(raw: string): number | null {
  const s = (raw ?? '').trim();
  if (!s) return null;
  // HH:MM:SS most common; tolerate H:MM and decimals too.
  const hms = s.match(/^(\d+):(\d{1,2}):(\d{1,2})$/);
  if (hms) {
    const h = Number(hms[1]);
    const m = Number(hms[2]);
    const sec = Number(hms[3]);
    return h + m / 60 + sec / 3600;
  }
  const hm = s.match(/^(\d+):(\d{1,2})$/);
  if (hm) return Number(hm[1]) + Number(hm[2]) / 60;
  const n = Number(s.replace(',', '.'));
  if (Number.isNaN(n)) return null;
  return n;
}

function parseBool(raw: string): boolean {
  const s = (raw ?? '').trim().toLowerCase();
  return s === 'yes' || s === 'true' || s === '1';
}

function parseMoneyCents(raw: string): number {
  if (!raw) return 0;
  const cleaned = String(raw).replace(/[^0-9.\-]/g, '');
  if (!cleaned) return 0;
  const n = Number(cleaned);
  if (Number.isNaN(n)) return 0;
  return Math.round(n * 100);
}

export function parseTogglCsv(text: string): TogglParseResult {
  const lines = text.split(/\r?\n/).filter((l) => l.length > 0);
  if (lines.length === 0) {
    return { rows: [], errors: [{ line: 0, reason: 'Empty file' }], headerMap: {} };
  }

  const headerCells = splitCsvRow(lines[0]!).map((h) => h.trim().toLowerCase());
  const headerMap: Record<string, number> = {};
  for (let i = 0; i < headerCells.length; i++) headerMap[headerCells[i]!] = i;

  const need = (names: string[]): number => {
    for (const n of names) {
      const idx = headerMap[n.toLowerCase()];
      if (typeof idx === 'number') return idx;
    }
    return -1;
  };

  const idxClient = need(['Client']);
  const idxProject = need(['Project']);
  const idxTask = need(['Task']);
  const idxDescription = need(['Description']);
  const idxBillable = need(['Billable']);
  const idxStartDate = need(['Start date']);
  const idxStartTime = need(['Start time']);
  const idxEndDate = need(['End date']);
  const idxEndTime = need(['End time']);
  const idxDuration = need(['Duration']);
  const idxAmount = need(['Amount (USD)', 'Amount USD', 'Amount']);
  const idxRate = need(['Rate']);

  const errors: TogglParseResult['errors'] = [];
  if (idxStartDate === -1) errors.push({ line: 0, reason: 'Missing "Start date" column' });
  if (idxProject === -1) errors.push({ line: 0, reason: 'Missing "Project" column' });
  if (idxDuration === -1 && (idxEndDate === -1 || idxEndTime === -1)) {
    errors.push({ line: 0, reason: 'Need either "Duration" or "End date"+"End time"' });
  }
  if (errors.length) return { rows: [], errors, headerMap };

  const rows: TogglRow[] = [];
  for (let i = 1; i < lines.length; i++) {
    const cells = splitCsvRow(lines[i]!);

    const startDate = parseDateOnly(cells[idxStartDate] ?? '');
    if (!startDate) {
      errors.push({ line: i + 1, reason: `Invalid start date "${cells[idxStartDate]}"` });
      continue;
    }
    const startTime = idxStartTime >= 0 ? parseTime(cells[idxStartTime] ?? '') : '00:00:00';
    if (!startTime) {
      errors.push({ line: i + 1, reason: `Invalid start time "${cells[idxStartTime]}"` });
      continue;
    }

    let hours = idxDuration >= 0 ? parseDurationHours(cells[idxDuration] ?? '') : null;

    let endDate = idxEndDate >= 0 ? parseDateOnly(cells[idxEndDate] ?? '') : null;
    let endTime = idxEndTime >= 0 ? parseTime(cells[idxEndTime] ?? '') : null;

    const startISO = `${startDate}T${startTime}`;
    let endISO: string;

    if (endDate && endTime) {
      endISO = `${endDate}T${endTime}`;
      if (hours === null) {
        const ms = new Date(endISO).getTime() - new Date(startISO).getTime();
        hours = ms > 0 ? ms / 3_600_000 : 0;
      }
    } else if (hours !== null && hours > 0) {
      const endMs = new Date(startISO).getTime() + hours * 3_600_000;
      endISO = new Date(endMs).toISOString().replace(/\.\d{3}Z$/, '');
    } else {
      errors.push({ line: i + 1, reason: `Row has neither a valid duration nor end time` });
      continue;
    }

    if (hours === null || hours <= 0) {
      errors.push({ line: i + 1, reason: `Invalid duration "${cells[idxDuration]}"` });
      continue;
    }

    const client = idxClient >= 0 ? (cells[idxClient] ?? '').trim() : '';
    if (!client) {
      errors.push({
        line: i + 1,
        reason: 'Row has no Client — TimeBill requires every project to have a client. Set one in Toggl and re-export.'
      });
      continue;
    }

    const project = idxProject >= 0 ? (cells[idxProject] ?? '').trim() : '';
    if (!project) {
      errors.push({ line: i + 1, reason: 'Row has no Project' });
      continue;
    }

    // Rate: prefer explicit Rate column, else derive from Amount / hours.
    let rateCents = 0;
    if (idxRate >= 0) rateCents = parseMoneyCents(cells[idxRate] ?? '');
    if (!rateCents && idxAmount >= 0) {
      const amt = parseMoneyCents(cells[idxAmount] ?? '');
      if (amt && hours > 0) rateCents = Math.round(amt / hours);
    }

    rows.push({
      date: startDate,
      client,
      project,
      task: idxTask >= 0 ? (cells[idxTask] ?? '').trim() : '',
      notes: idxDescription >= 0 ? (cells[idxDescription] ?? '').trim() : '',
      hours,
      billable: idxBillable >= 0 ? parseBool(cells[idxBillable] ?? '') : true,
      rateCents,
      startISO,
      endISO
    });
  }

  return { rows, errors, headerMap };
}

/**
 * Heuristic format detection based on the CSV header line. Toggl has
 * `Start time`/`End time`; Harvest does not. If neither matches confidently
 * we return `'unknown'` and let the UI prompt the user.
 */
export type ImportFormat = 'harvest' | 'toggl' | 'unknown';

export function detectImportFormat(text: string): ImportFormat {
  const firstLine = text.split(/\r?\n/, 1)[0] ?? '';
  const header = splitCsvRow(firstLine).map((h) => h.trim().toLowerCase());
  const has = (name: string) => header.includes(name.toLowerCase());
  const togglish =
    has('Start time') || has('End time') || (has('Start date') && has('Duration'));
  const harvestish = has('Date') && has('Hours');
  if (togglish && !harvestish) return 'toggl';
  if (harvestish && !togglish) return 'harvest';
  // Ambiguous: prefer Toggl if it has the time columns, otherwise unknown.
  if (togglish) return 'toggl';
  if (harvestish) return 'harvest';
  return 'unknown';
}

// Re-export so the importer page can pass either parser's rows to buildPreview.
export type { HarvestRow, ImportPreview };
