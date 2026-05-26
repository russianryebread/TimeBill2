import type { Cents } from './money';

export type FilingStatus = 'single' | 'mfj' | 'mfs' | 'hoh';

export const SS_WAGE_BASE_CENTS_2026 = 17_700_000; // $177,000 placeholder; update yearly
export const SS_RATE = 0.124;
export const MEDICARE_RATE = 0.029;
export const SE_TAX_INCOME_FACTOR = 0.9235;

/**
 * Self-employment tax: 15.3% on 92.35% of net SE earnings, with SS portion
 * capped at the annual wage base. Skeleton — refine before Phase 5.
 */
export function selfEmploymentTax(netSEIncomeCents: Cents): Cents {
  if (netSEIncomeCents <= 0) return 0;
  const taxableBase = Math.round(netSEIncomeCents * SE_TAX_INCOME_FACTOR);
  const ssTaxable = Math.min(taxableBase, SS_WAGE_BASE_CENTS_2026);
  const ssTax = Math.round(ssTaxable * SS_RATE);
  const medicareTax = Math.round(taxableBase * MEDICARE_RATE);
  return ssTax + medicareTax;
}

/**
 * Bracket calc placeholder. Filled out in Phase 5 with the actual current-year
 * brackets and standard deduction.
 */
export function estimatedFederalIncomeTax(
  _netIncomeCents: Cents,
  _filingStatus: FilingStatus
): Cents {
  return 0;
}

export function quarterlyEstimate(annualTaxOwed: Cents, quarter: 1 | 2 | 3 | 4): Cents {
  void quarter;
  return Math.round(annualTaxOwed / 4);
}
