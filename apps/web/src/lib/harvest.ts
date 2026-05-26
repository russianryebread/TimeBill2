/**
 * Harvest "Detailed Time Report" CSV parser.
 *
 * Columns we use (case-insensitive, only required ones listed):
 *   Date, Client, Project, Task, Notes, Hours, Billable?, Billable Rate
 *
 * The full Harvest detailed export includes many more columns
 * (Project Code, Invoiced?, Approved?, First/Last Name, Billable Amount,
 * Currency, Cost Rate, etc.) — we ignore them.
 */

export type HarvestRow = {
  date: string;          // ISO YYYY-MM-DD
  client: string;
  project: string;
  task: string;
  notes: string;
  hours: number;         // decimal hours
  billable: boolean;
  rateCents: number;     // 0 if missing
  // Optional real timestamps. Harvest's detailed export is date-only, so
  // these are undefined for Harvest rows; Toggl rows populate both and the
  // importer prefers them over 09:00 + cumulative synthesis.
  startISO?: string;
  endISO?: string;
};

export type ParseResult = {
  rows: HarvestRow[];
  errors: { line: number; reason: string }[];
  headerMap: Record<string, number>;
};

import { splitCsvRow } from './csv';

function parseHarvestDate(raw: string): string | null {
  const s = raw.trim();
  // Harvest uses formats like "5/24/2026" or "2026-05-24". Normalize.
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;
  const slash = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2,4})$/);
  if (slash) {
    let [, mm, dd, yyyy] = slash;
    if (yyyy!.length === 2) yyyy = `20${yyyy}`;
    return `${yyyy}-${mm!.padStart(2, '0')}-${dd!.padStart(2, '0')}`;
  }
  return null;
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

function parseHours(raw: string): number | null {
  if (!raw) return null;
  // Harvest exports decimal hours ("1.50") or H:MM ("1:30").
  const s = String(raw).trim();
  if (/^\d+:\d{1,2}$/.test(s)) {
    const [h, m] = s.split(':').map(Number);
    return h! + m! / 60;
  }
  const n = Number(s.replace(',', '.'));
  if (Number.isNaN(n)) return null;
  return n;
}

export function parseHarvestCsv(text: string): ParseResult {
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

  const idxDate = need(['Date']);
  const idxClient = need(['Client']);
  const idxProject = need(['Project']);
  const idxTask = need(['Task']);
  const idxNotes = need(['Notes', 'Note']);
  const idxHours = need(['Hours']);
  const idxBillable = need(['Billable?', 'Billable']);
  const idxRate = need(['Billable Rate', 'Billable rate', 'Rate']);

  const errors: ParseResult['errors'] = [];
  if (idxDate === -1) errors.push({ line: 0, reason: 'Missing "Date" column' });
  if (idxClient === -1) errors.push({ line: 0, reason: 'Missing "Client" column' });
  if (idxProject === -1) errors.push({ line: 0, reason: 'Missing "Project" column' });
  if (idxHours === -1) errors.push({ line: 0, reason: 'Missing "Hours" column' });
  if (errors.length) return { rows: [], errors, headerMap };

  const rows: HarvestRow[] = [];
  for (let i = 1; i < lines.length; i++) {
    const cells = splitCsvRow(lines[i]!);
    const date = parseHarvestDate(cells[idxDate] ?? '');
    const hours = parseHours(cells[idxHours] ?? '');
    if (!date) {
      errors.push({ line: i + 1, reason: `Invalid date "${cells[idxDate]}"` });
      continue;
    }
    if (hours === null || hours <= 0) {
      errors.push({ line: i + 1, reason: `Invalid hours "${cells[idxHours]}"` });
      continue;
    }
    rows.push({
      date,
      client: (cells[idxClient] ?? '').trim(),
      project: (cells[idxProject] ?? '').trim(),
      task: idxTask >= 0 ? (cells[idxTask] ?? '').trim() : '',
      notes: idxNotes >= 0 ? (cells[idxNotes] ?? '').trim() : '',
      hours,
      billable: idxBillable >= 0 ? parseBool(cells[idxBillable] ?? '') : true,
      rateCents: idxRate >= 0 ? parseMoneyCents(cells[idxRate] ?? '') : 0
    });
  }

  return { rows, errors, headerMap };
}

export type ImportPreview = {
  newClients: string[];
  newProjects: { client: string; project: string }[];
  newTasks: string[];
  totalRows: number;
  rangeStart: string;
  rangeEnd: string;
  sample: HarvestRow[];
};

export function buildPreview(
  rows: HarvestRow[],
  existing: { clientNames: Set<string>; projectKeys: Set<string>; taskNames: Set<string> }
): ImportPreview {
  const newClients = new Set<string>();
  const newProjectKeys = new Set<string>();
  const newProjects: ImportPreview['newProjects'] = [];
  const newTasks = new Set<string>();
  let minDate = '';
  let maxDate = '';

  for (const r of rows) {
    if (r.client && !existing.clientNames.has(r.client)) newClients.add(r.client);
    const projKey = `${r.client}__${r.project}`;
    if (r.project && !existing.projectKeys.has(projKey) && !newProjectKeys.has(projKey)) {
      newProjectKeys.add(projKey);
      newProjects.push({ client: r.client, project: r.project });
    }
    if (r.task && !existing.taskNames.has(r.task)) newTasks.add(r.task);
    if (!minDate || r.date < minDate) minDate = r.date;
    if (!maxDate || r.date > maxDate) maxDate = r.date;
  }

  return {
    newClients: Array.from(newClients).sort(),
    newProjects,
    newTasks: Array.from(newTasks).sort(),
    totalRows: rows.length,
    rangeStart: minDate,
    rangeEnd: maxDate,
    sample: rows.slice(0, 10)
  };
}
