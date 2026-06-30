import { formatScopeForOperator } from './scopeFormat';
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
