/**
 * Pentest-scope schema and the deterministic completeness gate.
 *
 * Pure module — no I/O. The conversation engine re-derives a PentestScope from
 * the transcript every turn (full re-derivation), and `isComplete()` decides
 * whether the bot keeps asking questions or offers the confirmation card.
 * A field is "filled" when it holds a real value (not the literal 'unknown',
 * not blank, not an empty array).
 */

export type Environment = 'prod' | 'staging' | 'test' | 'unknown';

export interface PentestScope {
  targets: string[] | 'unknown';
  inScope: string | 'unknown';
  outOfScope?: string;
  environment: Environment;
  rulesOfEngagement: string | 'unknown';
  timingWindow: string | 'unknown';
  testType: string | 'unknown';
  complianceFrameworks?: string[];
  constraints?: string;
  contacts: string | 'unknown';
}

export const REQUIRED_FIELDS: (keyof PentestScope)[] = [
  'targets',
  'inScope',
  'environment',
  'rulesOfEngagement',
  'timingWindow',
  'testType',
  'contacts',
];

export function emptyScope(): PentestScope {
  return {
    targets: 'unknown',
    inScope: 'unknown',
    environment: 'unknown',
    rulesOfEngagement: 'unknown',
    timingWindow: 'unknown',
    testType: 'unknown',
    contacts: 'unknown',
  };
}

export function isFieldFilled(value: unknown): boolean {
  if (value === undefined || value === null) return false;
  if (value === 'unknown') return false;
  if (Array.isArray(value)) return value.length > 0;
  if (typeof value === 'string') return value.trim().length > 0;
  return true;
}

export function missingFields(scope: PentestScope): (keyof PentestScope)[] {
  return REQUIRED_FIELDS.filter((f) => !isFieldFilled(scope[f]));
}

export function isComplete(scope: PentestScope): boolean {
  return missingFields(scope).length === 0;
}
