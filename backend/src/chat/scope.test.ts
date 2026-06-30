import { emptyScope, isFieldFilled, missingFields, isComplete, REQUIRED_FIELDS } from './scope';

describe('scope', () => {
  it('emptyScope has every required field unfilled', () => {
    const s = emptyScope();
    expect(missingFields(s).sort()).toEqual([...REQUIRED_FIELDS].sort());
    expect(isComplete(s)).toBe(false);
  });

  it('isFieldFilled treats "unknown", empty string, and empty array as not filled', () => {
    expect(isFieldFilled('unknown')).toBe(false);
    expect(isFieldFilled('')).toBe(false);
    expect(isFieldFilled('   ')).toBe(false);
    expect(isFieldFilled([])).toBe(false);
    expect(isFieldFilled(['app.example.com'])).toBe(true);
    expect(isFieldFilled('staging')).toBe(true);
  });

  it('isComplete is true only when all required fields are filled', () => {
    const s = emptyScope();
    s.targets = ['app.example.com'];
    s.inScope = 'the web app';
    s.environment = 'staging';
    s.rulesOfEngagement = 'no DoS, business hours';
    s.timingWindow = '2026-07-01 to 2026-07-05';
    s.testType = 'web app';
    expect(isComplete(s)).toBe(false); // contacts still missing
    s.contacts = 'ops@example.com';
    expect(missingFields(s)).toEqual([]);
    expect(isComplete(s)).toBe(true);
  });

  it('optional fields do not affect completeness', () => {
    const s = emptyScope();
    REQUIRED_FIELDS.forEach((f) => {
      (s as any)[f] = f === 'targets' ? ['x'] : 'x';
    });
    expect(isComplete(s)).toBe(true); // complianceFrameworks/constraints/outOfScope unset
  });
});
