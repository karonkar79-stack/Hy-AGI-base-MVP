// src/connectors/larkConnectors.ts
/**
 * Lark connectors — thin adapters over the existing read-only readers
 * (readDoc / readWikiSpace / readDriveFolder). They recognize Lark Doc, Wiki,
 * and Drive-folder URLs and return DocPayload[].
 */

import { SourceConnector } from './types';
import { DocPayload } from '../types';
import { readDoc, readWikiSpace, readDriveFolder } from '../integrations/lark/readers';

// Lark/Feishu URLs look like https://<tenant>.(larksuite.com|feishu.cn)/<kind>/<token>.
// Drive folders are /drive/folder/<token>; docx is /docx/<token>; wiki is /wiki/<token>.
const TOKEN = '([A-Za-z0-9]+)';
const HOST = '[^/\\s]*\\.(?:larksuite\\.com|feishu\\.cn)';

function makeRegex(pathKind: string): RegExp {
  return new RegExp(`^https?://${HOST}/${pathKind}/${TOKEN}(?:[/?#]|$)`);
}

const DOC_RE = makeRegex('docx');
const WIKI_RE = makeRegex('wiki');
const DRIVE_RE = makeRegex('drive/folder');

function tokenFrom(re: RegExp, ref: string): string | null {
  const m = re.exec(ref);
  return m ? m[1] : null;
}

export const larkDocConnector: SourceConnector = {
  type: 'lark_doc',
  matches: (ref) => DOC_RE.test(ref),
  extractToken: (ref) => tokenFrom(DOC_RE, ref),
  async fetch(ref): Promise<DocPayload[]> {
    const token = tokenFrom(DOC_RE, ref);
    if (!token) throw new Error(`Not a Lark doc URL: ${ref}`);
    return [await readDoc(token)];
  },
};

export const larkWikiConnector: SourceConnector = {
  type: 'lark_wiki',
  matches: (ref) => WIKI_RE.test(ref),
  extractToken: (ref) => tokenFrom(WIKI_RE, ref),
  async fetch(ref): Promise<DocPayload[]> {
    const token = tokenFrom(WIKI_RE, ref);
    if (!token) throw new Error(`Not a Lark wiki URL: ${ref}`);
    return readWikiSpace(token);
  },
};

export const larkDriveConnector: SourceConnector = {
  type: 'lark_drive',
  matches: (ref) => DRIVE_RE.test(ref),
  extractToken: (ref) => tokenFrom(DRIVE_RE, ref),
  async fetch(ref): Promise<DocPayload[]> {
    const token = tokenFrom(DRIVE_RE, ref);
    if (!token) throw new Error(`Not a Lark drive folder URL: ${ref}`);
    const { payloads } = await readDriveFolder(token);
    return payloads;
  },
};
