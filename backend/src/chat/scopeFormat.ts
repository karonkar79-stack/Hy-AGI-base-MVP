/**
 * Human-readable rendering of a PentestScope for the operator/reviewer group.
 *
 * Pure module — no I/O. Both the live handoff (ConversationService.handoff) and
 * the one-off push script render through here, so the operator sees the same
 * tidy, labelled summary instead of raw JSON. Lark plain-text messages honour
 * '\n', so the layout is newline-separated sections.
 */

import { PentestScope, missingFields, isComplete } from './scope';

function val(v: string | string[] | undefined): string {
  if (v === undefined || v === null) return '—';
  if (Array.isArray(v)) return v.length ? v.join(', ') : '—';
  const s = String(v).trim();
  if (!s || s === 'unknown') return '—';
  return s;
}

/** Render a completed (or in-progress) scope as a labelled text block for review. */
export function formatScopeForOperator(conversationId: string, scope: PentestScope): string {
  const complete = isComplete(scope);
  const missing = missingFields(scope);

  const lines: string[] = [];
  lines.push('🔔 New pentest scope ready for review');
  lines.push(`Conversation: ${conversationId}`);
  lines.push(complete ? 'Status: ✅ complete' : `Status: ⚠️ missing ${missing.join(', ')}`);
  lines.push('');
  lines.push(`🎯 Targets: ${val(scope.targets)}`);
  lines.push(`🧪 Environment: ${val(scope.environment)}`);
  lines.push(`🔍 Test type: ${val(scope.testType)}`);
  lines.push(`🗓️ Timing window: ${val(scope.timingWindow)}`);
  lines.push(`👤 Contacts: ${val(scope.contacts)}`);
  lines.push('');
  lines.push(`✅ In scope: ${val(scope.inScope)}`);
  lines.push(`🚫 Out of scope: ${val(scope.outOfScope)}`);
  lines.push(`📋 Rules of engagement: ${val(scope.rulesOfEngagement)}`);
  lines.push(`⚙️ Constraints: ${val(scope.constraints)}`);
  lines.push(`📑 Compliance: ${val(scope.complianceFrameworks)}`);

  return lines.join('\n');
}
