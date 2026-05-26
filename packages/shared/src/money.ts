export type Cents = number;

const USD_FORMATTER = new Intl.NumberFormat('en-US', {
  style: 'currency',
  currency: 'USD',
  minimumFractionDigits: 2,
  maximumFractionDigits: 2
});

export function formatUSD(cents: Cents): string {
  return USD_FORMATTER.format(cents / 100);
}

export function dollarsToCents(dollars: number): Cents {
  return Math.round(dollars * 100);
}

export function centsToDollars(cents: Cents): number {
  return cents / 100;
}

export function parseUSDInput(input: string): Cents | null {
  const cleaned = input.replace(/[$,\s]/g, '');
  if (!cleaned) return null;
  const n = Number(cleaned);
  if (!Number.isFinite(n)) return null;
  return dollarsToCents(n);
}

export function formatHours(milliseconds: number): string {
  const totalMinutes = Math.floor(milliseconds / 60_000);
  const h = Math.floor(totalMinutes / 60);
  const m = totalMinutes % 60;
  return `${h}:${m.toString().padStart(2, '0')}`;
}

/**
 * Format milliseconds as `H:MM:SS` (or `M:SS` when under an hour). Used for
 * live, ticking-second timer displays where `formatHours` would round to 0:00.
 */
export function formatHMS(milliseconds: number): string {
  const totalSeconds = Math.floor(milliseconds / 1000);
  const h = Math.floor(totalSeconds / 3600);
  const m = Math.floor((totalSeconds % 3600) / 60);
  const s = totalSeconds % 60;
  const mm = m.toString().padStart(2, '0');
  const ss = s.toString().padStart(2, '0');
  return h > 0 ? `${h}:${mm}:${ss}` : `${m}:${ss}`;
}

export function hoursDecimal(milliseconds: number): number {
  return milliseconds / 3_600_000;
}
