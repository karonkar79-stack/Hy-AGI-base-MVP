/**
 * Human-readable rendering of a PentestScope for the operator/reviewer group.
 *
 * Pure module — no I/O. Both the live handoff (ConversationService.handoff) and
 * the one-off push script render through here, so the operator sees the same
 * tidy, labelled summary instead of raw JSON.
 *
 *  - buildScopeCard() returns a Lark interactive-card object (the preferred
 *    rendering: colored header, 2-column short fields, divided narrative
 *    sections). No buttons yet — operator-review actions are a later phase.
 *  - formatScopeForOperator() returns the equivalent plain-text block, kept as
 *    a fallback for non-card transports and as the card's i18n-free preview.
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

// --- Interactive card -------------------------------------------------------
//
// Lark message-card JSON (schema "2.0"). Sent via im.message.create with
// msg_type 'interactive'. We use only the well-supported element types so the
// card renders identically on desktop and mobile:
//   - a `header` with title + template color
//   - `column_set` rows for the short fields (2 columns each)
//   - `div` + lark_md fields for the long narrative sections
//   - `hr` dividers between groups
// Markdown special chars in values are escaped so user-supplied scope text
// can't break the card layout.

/** Minimal structural type for a Lark interactive card (only what we emit). */
export interface LarkCard {
  config: { wide_screen_mode: boolean };
  header: {
    template: string;
    title: { tag: 'plain_text'; content: string };
  };
  elements: unknown[];
}

function mdEscape(s: string): string {
  // Escape the lark_md control characters so values render literally.
  return s.replace(/[\\*_~`\[\]()]/g, (c) => `\\${c}`);
}

/**
 * Render a clickable @mention of the requester for lark_md, IF we have their
 * open_id. Lark resolves `<at id=ou_xxx></at>` to the user's name and pings
 * them when they're a member of the receiving group. Returns '' when the id is
 * absent or not an open_id, so callers can omit the line entirely rather than
 * emit a broken tag. The id is a controlled value (never user text), so it is
 * intentionally not run through mdEscape.
 */
export function mentionMd(requesterOpenId?: string): string {
  if (requesterOpenId && requesterOpenId.startsWith('ou_')) {
    return `<at id=${requesterOpenId}></at>`;
  }
  return '';
}

/** A two-cell row: each cell is an emoji label above its value. */
function twoColumn(
  leftLabel: string,
  leftValue: string,
  rightLabel: string,
  rightValue: string
): unknown {
  const cell = (label: string, value: string) => ({
    tag: 'column',
    width: 'weighted',
    weight: 1,
    elements: [
      { tag: 'markdown', content: `**${label}**\n${mdEscape(value)}` },
    ],
  });
  return {
    tag: 'column_set',
    flex_mode: 'bisect',
    columns: [cell(leftLabel, leftValue), cell(rightLabel, rightValue)],
  };
}

/** A full-width labelled section for a long narrative field. */
function section(label: string, value: string): unknown {
  return { tag: 'div', text: { tag: 'lark_md', content: `**${label}**\n${mdEscape(value)}` } };
}

/**
 * Build the operator-review interactive card for a scope.
 * Header turns green when complete, amber (carmine) when fields are missing.
 *
 * `requesterOpenId` is the Lark open_id of the user who requested the pentest
 * (the conversation's chat key). When present and a valid open_id, the card
 * opens with a clickable @mention so the operator group can ping them; the
 * mention only notifies them if they are a member of that group.
 */
export function buildScopeCard(
  conversationId: string,
  scope: PentestScope,
  requesterOpenId?: string
): LarkCard {
  const complete = isComplete(scope);
  const missing = missingFields(scope);

  const statusLine = complete
    ? '✅ **Status:** complete'
    : `⚠️ **Status:** missing ${missing.join(', ')}`;

  const mention = mentionMd(requesterOpenId);
  const requestedByLine = mention ? `🙋 **Requested by:** ${mention}\n` : '';

  const elements: unknown[] = [
    {
      tag: 'div',
      text: { tag: 'lark_md', content: `${requestedByLine}${statusLine}\n\`${conversationId}\`` },
    },
    { tag: 'hr' },
    twoColumn('🎯 Targets', val(scope.targets), '🧪 Environment', val(scope.environment)),
    twoColumn('🔍 Test type', val(scope.testType), '🗓️ Timing window', val(scope.timingWindow)),
    section('👤 Contacts', val(scope.contacts)),
    { tag: 'hr' },
    section('✅ In scope', val(scope.inScope)),
    section('🚫 Out of scope', val(scope.outOfScope)),
    section('📋 Rules of engagement', val(scope.rulesOfEngagement)),
    section('⚙️ Constraints', val(scope.constraints)),
    section('📑 Compliance', val(scope.complianceFrameworks)),
  ];

  return {
    config: { wide_screen_mode: true },
    header: {
      template: complete ? 'green' : 'carmine',
      title: { tag: 'plain_text', content: '🔔 Pentest Scope · Ready for Review' },
    },
    elements,
  };
}
