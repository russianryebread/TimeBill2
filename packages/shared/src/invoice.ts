import type { Cents } from './money';

export type RateContext = {
  entrySnapshot: Cents | null;
  taskRate: Cents | null;
  projectRate: Cents | null;
  clientDefaultRate: Cents;
};

/**
 * Rate resolution order:
 *   1. Snapshot on the time entry (locked when the timer stopped)
 *   2. Task rate
 *   3. Project rate
 *   4. Client default rate
 */
export function resolveHourlyRate(ctx: RateContext): Cents {
  return ctx.entrySnapshot ?? ctx.taskRate ?? ctx.projectRate ?? ctx.clientDefaultRate;
}

export function lineAmount(rate: Cents, hours: number): Cents {
  return Math.round((rate * hours) / 1);
}

export function sumCents(values: Cents[]): Cents {
  return values.reduce((a, b) => a + b, 0);
}

/**
 * Round a number of hours UP to the nearest `roundingMinutes` granularity for
 * billing purposes. `0` (default) means no rounding.
 *
 * Examples (15-minute rounding):
 *   0.05h (3 min)   → 0.25h
 *   0.30h (18 min)  → 0.50h
 *   1.00h (60 min)  → 1.00h (already on boundary)
 *   1.05h (63 min)  → 1.25h
 */
export function roundHours(hours: number, roundingMinutes: number): number {
  if (!roundingMinutes || roundingMinutes <= 0) return hours;
  const totalMinutes = hours * 60;
  const rounded = Math.ceil(totalMinutes / roundingMinutes) * roundingMinutes;
  return Math.round((rounded / 60) * 100) / 100; // keep 2 decimal places
}

export const ROUNDING_OPTIONS = [
  { value: 0, label: 'No rounding' },
  { value: 5, label: 'Nearest 5 min' },
  { value: 15, label: 'Nearest 15 min' },
  { value: 30, label: 'Nearest 30 min' },
  { value: 60, label: 'Nearest 1 hour' }
] as const;
