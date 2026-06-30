// src/connectors/registry.ts
/**
 * Connector registry + reference detection. Scans message text for URLs and
 * asks each connector whether it recognizes them. Order matters: drive/folder
 * is checked before generic patterns since its path is more specific.
 */

import { SourceConnector, DetectedRef } from './types';
import {
  larkDocConnector,
  larkWikiConnector,
  larkDriveConnector,
} from './larkConnectors';

export const LARK_CONNECTORS: SourceConnector[] = [
  larkDriveConnector,
  larkDocConnector,
  larkWikiConnector,
];

const URL_RE = /https?:\/\/[^\s)<>"']+/g;

export function detectReferences(
  text: string,
  connectors: SourceConnector[] = LARK_CONNECTORS
): DetectedRef[] {
  const urls = text.match(URL_RE) ?? [];
  const out: DetectedRef[] = [];
  for (const url of urls) {
    const connector = connectors.find((c) => c.matches(url));
    if (connector) out.push({ connectorType: connector.type, ref: url });
  }
  return out;
}

export function findConnector(
  type: string,
  connectors: SourceConnector[] = LARK_CONNECTORS
): SourceConnector | undefined {
  return connectors.find((c) => c.type === type);
}
