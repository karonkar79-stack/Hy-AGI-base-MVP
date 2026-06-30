/**
 * Prompts and parsing for the alignment loop.
 *
 * Two distinct system prompts keep the conversation natural while the scope
 * stays code-owned: `conversePrompt` produces the user-facing reply,
 * `extractPrompt` produces strict scope JSON. `buildContext` packs the docs +
 * transcript into a single user message (full-context strategy).
 */

import { PentestScope, Environment, emptyScope } from './scope';
import { MessageRow, DocumentRow } from './store';

const FIELD_LABELS: Record<string, string> = {
  targets: 'targets / assets (URLs, IP ranges, hostnames)',
  inScope: 'what is explicitly in scope',
  environment: 'environment (production, staging, or test)',
  rulesOfEngagement: 'rules of engagement (allowed/forbidden actions, intrusiveness)',
  timingWindow: 'the allowed testing window and any blackout periods',
  testType: 'the type of test (web app, network, API, etc.)',
  contacts: 'technical and emergency contacts',
};

export function conversePrompt(missing: (keyof PentestScope)[]): string {
  const next = missing.length
    ? `Information still needed, in priority order: ${missing
        .map((f) => FIELD_LABELS[f as string] ?? String(f))
        .join('; ')}. Ask about the FIRST missing item, one topic at a time.`
    : `All required scope information appears to be gathered. Summarize the scope back to the user clearly and ask them to confirm by replying "Yes, please proceed" or to add corrections.`;

  return [
    'You are a penetration-testing scoping assistant for a security operations team.',
    'Your job is to align a precise pentest scope with the user before any operator review.',
    'Be concise, professional, and ask only what is necessary. Prefer the most recent explicit',
    'statement from the user over anything in the documents when they conflict.',
    next,
    'Respond with ONLY your next chat message to the user — no JSON, no preamble.',
  ].join(' ');
}

export function extractPrompt(): string {
  return [
    'You extract a structured pentest scope from the documents and conversation below.',
    'Return ONLY a single JSON object (optionally in a ```json fence) with these keys:',
    'targets (array of strings), inScope (string), outOfScope (string),',
    'environment (one of "prod","staging","test"), rulesOfEngagement (string),',
    'timingWindow (string), testType (string), complianceFrameworks (array of strings),',
    'constraints (string), contacts (string).',
    'Use the literal string "unknown" for any field not yet established. For arrays use [] when unknown.',
    'Prefer the most recent explicit user statement over the documents when they disagree.',
    'Do not invent values.',
  ].join(' ');
}

export function buildContext(docs: DocumentRow[], messages: MessageRow[]): string {
  const docBlock = docs
    .filter((d) => d.status === 'ingested' && d.content)
    .map((d) => `[${d.title ?? d.sourceRef}](${d.sourceUrl ?? d.sourceRef})\n${d.content}`)
    .join('\n\n---\n\n');

  const convoBlock = messages.map((m) => `${m.role}: ${m.content}`).join('\n');

  return [
    '=== DOCUMENTS ===',
    docBlock || '(no documents provided yet)',
    '',
    '=== CONVERSATION ===',
    convoBlock || '(no messages yet)',
  ].join('\n');
}

const ENVIRONMENTS: Environment[] = ['prod', 'staging', 'test', 'unknown'];

function asString(v: unknown): string | 'unknown' {
  if (typeof v === 'string' && v.trim() && v !== 'unknown') return v;
  return 'unknown';
}

function asStringArray(v: unknown): string[] | 'unknown' {
  if (Array.isArray(v)) {
    const arr = v.filter((x) => typeof x === 'string' && x.trim());
    return arr.length ? arr : 'unknown';
  }
  return 'unknown';
}

function asOptionalString(v: unknown): string | undefined {
  if (typeof v === 'string' && v.trim() && v !== 'unknown') return v;
  return undefined;
}

function asOptionalStringArray(v: unknown): string[] | undefined {
  if (Array.isArray(v)) {
    const arr = v.filter((x) => typeof x === 'string' && x.trim());
    return arr.length ? arr : undefined;
  }
  return undefined;
}

/** Tolerant parse: extract the first {...} block, coerce each field, default to emptyScope. */
export function parseScopeJson(raw: string): PentestScope {
  const scope = emptyScope();
  const fenceMatch = raw.match(/```(?:json)?\s*([\s\S]*?)```/);
  const jsonStr = fenceMatch ? fenceMatch[1].trim() : raw.match(/\{[\s\S]*\}/)?.[0];
  if (!jsonStr) return scope;

  let obj: any;
  try {
    obj = JSON.parse(jsonStr);
  } catch {
    return scope;
  }

  scope.targets = asStringArray(obj.targets);
  scope.inScope = asString(obj.inScope);
  scope.outOfScope = asOptionalString(obj.outOfScope);
  const env = typeof obj.environment === 'string' ? obj.environment : 'unknown';
  scope.environment = (ENVIRONMENTS.includes(env as Environment) ? env : 'unknown') as Environment;
  scope.rulesOfEngagement = asString(obj.rulesOfEngagement);
  scope.timingWindow = asString(obj.timingWindow);
  scope.testType = asString(obj.testType);
  scope.complianceFrameworks = asOptionalStringArray(obj.complianceFrameworks);
  scope.constraints = asOptionalString(obj.constraints);
  scope.contacts = asString(obj.contacts);

  return scope;
}
