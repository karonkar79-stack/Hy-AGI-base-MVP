// src/connectors/types.ts
/**
 * SourceConnector — a uniform way to turn a user-supplied reference (a pasted
 * Lark URL today; Sheets / uploads / Jira / Confluence later) into DocPayloads
 * that feed the existing chunk -> embed -> pgvector pipeline. The conversation
 * engine is source-agnostic: it only sees this interface.
 */

import { DocPayload } from '../types';

export interface SourceConnector {
  type: string;
  /** True when `ref` is a reference this connector can fetch. */
  matches(ref: string): boolean;
  /** Pull the Lark/object token out of the reference, or null if it can't. */
  extractToken(ref: string): string | null;
  /** Fetch the reference's content as one or more DocPayloads. */
  fetch(ref: string): Promise<DocPayload[]>;
}

export interface DetectedRef {
  connectorType: string;
  ref: string;
}
