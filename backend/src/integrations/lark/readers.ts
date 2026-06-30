/**
 * Lark source readers — pull plain text from Docs, Wiki spaces and Drive
 * folders for ingestion.
 *
 * Calls go through the documented OpenAPI REST endpoints via the SDK's generic
 * `request` method. The endpoints are authoritative; `request` is accessed via
 * a loose type because its exact signature varies across SDK versions, and the
 * envelope is normalized in `unwrap`.
 */

import { getLarkClient } from './LarkClient';
import { DocPayload } from '../../types';
import { logger } from '../../utils/logger';

const domain = (): string => process.env.LARK_DOMAIN || 'https://open.larksuite.com';

function api(): { request: (payload: any) => Promise<any> } {
  return getLarkClient() as unknown as { request: (payload: any) => Promise<any> };
}

function unwrap(resp: any): any {
  // The SDK may return the API envelope ({ code, msg, data }) directly, or
  // nested under `.data`. Normalize both, surfacing non-zero error codes.
  const body = resp?.data?.code !== undefined ? resp.data : resp;
  if (body && body.code !== undefined && body.code !== 0) {
    throw new Error(`Lark API error ${body.code}: ${body.msg ?? 'unknown'}`);
  }
  return body?.data ?? body;
}

async function larkGet(url: string, params?: Record<string, any>): Promise<any> {
  try {
    const resp = await api().request({ method: 'GET', url, params });
    return unwrap(resp);
  } catch (e: any) {
    // A non-2xx HTTP status (e.g. 403) is thrown by the SDK as an AxiosError
    // before `unwrap` ever runs. The actionable detail is Lark's { code, msg }
    // in the response body — surface it as a plain Error so callers and logs
    // get something useful instead of an opaque "status code 403".
    const status = e?.response?.status;
    const body = e?.response?.data;
    if (status) {
      const larkCode = body?.code;
      const larkMsg = body?.msg;
      const detail = larkCode !== undefined ? `Lark code ${larkCode}: ${larkMsg}` : (larkMsg ?? e.message);
      throw new Error(`Lark request failed (HTTP ${status}) for ${url} — ${detail}`);
    }
    throw e;
  }
}

/** Read a single docx document's plain text. */
export async function readDoc(documentId: string): Promise<DocPayload> {
  const data = await larkGet(`/open-apis/docx/v1/documents/${documentId}/raw_content`, { lang: 0 });
  const text: string = data?.content ?? '';

  // Title is best-effort — content ingestion proceeds even if it fails.
  let title = documentId;
  try {
    const meta = await larkGet(`/open-apis/docx/v1/documents/${documentId}`);
    title = meta?.document?.title || title;
  } catch (e: any) {
    logger.debug(`Could not fetch title for doc ${documentId}: ${e.message}`);
  }

  return {
    sourceType: 'doc',
    sourceId: documentId,
    title,
    url: `${domain()}/docx/${documentId}`,
    text,
  };
}

/** Walk a wiki space and read every docx node under it. */
export async function readWikiSpace(spaceId: string): Promise<DocPayload[]> {
  const out: DocPayload[] = [];
  await walkWikiNodes(spaceId, undefined, out, 0);
  return out;
}

async function walkWikiNodes(
  spaceId: string,
  parentNodeToken: string | undefined,
  out: DocPayload[],
  depth: number
): Promise<void> {
  if (depth > 8) return;

  let pageToken: string | undefined;
  do {
    const params: Record<string, any> = { page_size: 50 };
    if (parentNodeToken) params.parent_node_token = parentNodeToken;
    if (pageToken) params.page_token = pageToken;

    const data = await larkGet(`/open-apis/wiki/v2/spaces/${spaceId}/nodes`, params);
    const items: any[] = data?.items ?? [];

    for (const node of items) {
      if (node.obj_type === 'docx' && node.obj_token) {
        try {
          const doc = await readDoc(node.obj_token);
          out.push({ ...doc, sourceType: 'wiki_space', title: node.title || doc.title });
        } catch (e: any) {
          logger.warn(`Failed to read wiki docx node ${node.node_token}: ${e.message}`);
        }
      }
      if (node.has_child) {
        await walkWikiNodes(spaceId, node.node_token, out, depth + 1);
      }
    }

    pageToken = data?.has_more ? data?.page_token : undefined;
  } while (pageToken);
}

/** Recursively read docx files within a Drive folder. */
export async function readDriveFolder(
  folderToken: string
): Promise<{ payloads: DocPayload[]; skipped: number }> {
  const payloads: DocPayload[] = [];
  const skipped = await walkDriveFolder(folderToken, payloads, 0);
  return { payloads, skipped };
}

async function walkDriveFolder(folderToken: string, out: DocPayload[], depth: number): Promise<number> {
  if (depth > 5) return 0;

  let skipped = 0;
  let pageToken: string | undefined;
  do {
    const params: Record<string, any> = { folder_token: folderToken, page_size: 200 };
    if (pageToken) params.page_token = pageToken;

    const data = await larkGet('/open-apis/drive/v1/files', params);
    const files: any[] = data?.files ?? [];

    for (const f of files) {
      if (f.type === 'folder' && f.token) {
        skipped += await walkDriveFolder(f.token, out, depth + 1);
      } else if (f.type === 'docx' && f.token) {
        try {
          const doc = await readDoc(f.token);
          out.push({ ...doc, sourceType: 'drive_file', title: f.name || doc.title, url: f.url || doc.url });
        } catch (e: any) {
          logger.warn(`Failed to read drive docx ${f.token}: ${e.message}`);
          skipped += 1;
        }
      } else {
        // sheet / bitable / binary file / etc. — not supported in v1.
        skipped += 1;
      }
    }

    pageToken = data?.has_more ? data?.next_page_token : undefined;
  } while (pageToken);

  return skipped;
}
