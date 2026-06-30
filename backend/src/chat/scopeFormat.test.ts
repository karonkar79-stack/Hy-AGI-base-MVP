import { formatScopeForOperator, buildScopeCard } from './scopeFormat';
import { PentestScope, emptyScope } from './scope';

describe('formatScopeForOperator', () => {
  const full: PentestScope = {
    targets: ['app-staging.example.com'],
    inScope: 'Full application and API surface',
    outOfScope: 'Production environment',
    environment: 'staging',
    rulesOfEngagement: 'no DoS; deconfliction via Lark group',
    timingWindow: '1 July 2026 – 14 July 2026',
    testType: 'grey-box',
    complianceFrameworks: ['PCI-DSS v4.0.1', 'ISO/IEC 27001:2022'],
    constraints: 'staging only; WAF enabled',
    contacts: 'Jason Jei',
  };

  it('renders every labelled field for a complete scope', () => {
    const out = formatScopeForOperator('conv-123', full);
    expect(out).toContain('ready for review');
    expect(out).toContain('conv-123');
    expect(out).toContain('✅ complete');
    expect(out).toContain('app-staging.example.com');
    expect(out).toContain('staging');
    expect(out).toContain('grey-box');
    expect(out).toContain('1 July 2026 – 14 July 2026');
    expect(out).toContain('Jason Jei');
    expect(out).toContain('Production environment');
    expect(out).toContain('PCI-DSS v4.0.1, ISO/IEC 27001:2022'); // array joined
  });

  it('marks an incomplete scope and lists missing fields, dashing blanks', () => {
    const out = formatScopeForOperator('conv-9', emptyScope());
    expect(out).toContain('⚠️ missing');
    expect(out).toContain('targets'); // a required field name appears
    expect(out).toContain('🎯 Targets: —'); // 'unknown' rendered as a dash
  });
});

// Flatten every string in a nested card object so assertions can scan content
// regardless of which element/column nesting a value lands in.
function cardText(card: unknown): string {
  const acc: string[] = [];
  const walk = (v: unknown): void => {
    if (typeof v === 'string') acc.push(v);
    else if (Array.isArray(v)) v.forEach(walk);
    else if (v && typeof v === 'object') Object.values(v).forEach(walk);
  };
  walk(card);
  return acc.join('\n');
}

describe('buildScopeCard', () => {
  const full: PentestScope = {
    targets: ['app-staging.example.com'],
    inScope: 'Full application and API surface',
    outOfScope: 'Production environment',
    environment: 'staging',
    rulesOfEngagement: 'no DoS',
    timingWindow: '1 July 2026 – 14 July 2026',
    testType: 'grey-box',
    complianceFrameworks: ['PCI-DSS v4.0.1', 'ISO/IEC 27001:2022'],
    constraints: 'staging only',
    contacts: 'Jason Jei',
  };

  it('builds a green-header card carrying every field value for a complete scope', () => {
    const card = buildScopeCard('conv-123', full);
    expect(card.header.template).toBe('green');
    expect(card.header.title.content).toContain('Pentest Scope');
    const text = cardText(card);
    expect(text).toContain('conv-123');
    expect(text).toContain('app-staging.example.com');
    expect(text).toContain('staging');
    expect(text).toContain('grey-box');
    expect(text).toContain('Jason Jei');
    expect(text).toContain('Production environment');
    expect(text).toContain('PCI-DSS v4.0.1, ISO/IEC 27001:2022');
  });

  it('uses a carmine header and surfaces missing fields for an incomplete scope', () => {
    const card = buildScopeCard('conv-9', emptyScope());
    expect(card.header.template).toBe('carmine');
    const text = cardText(card);
    expect(text).toContain('missing');
    expect(text).toContain('targets');
  });

  it('escapes markdown control characters in values so they cannot break layout', () => {
    const scope: PentestScope = { ...full, contacts: 'a*b_c`d[e]' };
    const text = cardText(buildScopeCard('c', scope));
    expect(text).toContain('a\\*b\\_c\\`d\\[e\\]');
  });
});
