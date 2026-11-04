// Validates the Race Committee's results form before anything is saved.

import { isResultCode, type ResultEntry } from './scoring';

export interface FormEntry {
  racerId: number;
  value: string; // '' = did not race, '1'..'N' = finishing place, or a result code
}

export type ValidationResult = { ok: true; results: ResultEntry[] } | { ok: false; errors: string[] };

export function validateRaceEntries(entries: FormEntry[]): ValidationResult {
  const errors: string[] = [];
  const results: ResultEntry[] = [];
  const seen = new Set<number>();

  for (const { racerId, value } of entries) {
    const v = value.trim().toUpperCase();
    if (v === '') continue;
    if (seen.has(racerId)) {
      errors.push('The same racer appears twice.');
      continue;
    }
    seen.add(racerId);
    if (isResultCode(v)) {
      results.push({ racerId, place: null, code: v });
    } else if (/^\d+$/.test(v) && Number(v) >= 1) {
      results.push({ racerId, place: Number(v), code: null });
    } else {
      errors.push(`"${value}" is not a finishing place or a result code.`);
    }
  }

  const places = results.filter((r) => r.place !== null).map((r) => r.place as number);
  if (places.length === 0) {
    errors.push('Enter at least one finisher.');
  } else {
    const sorted = [...places].sort((a, b) => a - b);
    const dupes = sorted.filter((p, i) => i > 0 && sorted[i - 1] === p);
    if (dupes.length) errors.push(`Place ${[...new Set(dupes)].join(', ')} is used more than once.`);
    const missing: number[] = [];
    for (let p = 1; p <= places.length; p++) if (!sorted.includes(p)) missing.push(p);
    if (!dupes.length && missing.length) {
      errors.push(`Places must run 1 to ${places.length} with no gaps (missing ${missing.join(', ')}).`);
    }
  }

  return errors.length ? { ok: false, errors } : { ok: true, results };
}
