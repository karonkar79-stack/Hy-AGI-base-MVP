# Lark Knowledge Base — Design Document

**Status:** Draft for review · **Owner:** Kai Xian · **Date:** 2026-06-30
**Component:** `backend/` (Hy-AGI MVP) · **Feature:** Agentic RAG knowledge base over Lark

> This document is a design spec to review **before** any code is written. It reflects the
> decisions made during scoping (see [Decisions](#1-decisions)). Method names for the Lark
> SDK are marked *representative* — the REST endpoints are authoritative; confirm the exact
> SDK method against the installed `@larksuiteoapi/node-sdk` version during implementation.

---

## 1. Decisions

| # | Decision | Choice | Implication |
|---|----------|--------|-------------|
| 1 | Data flow | **Ingest only** (Lark → KB) | Read-only toward Lark. No write-back, no doc editing. |
| 2 | Access pattern | **Runtime agent tool** | Agent decides at inference time to ingest/search via tool-use. Requires a tool-use loop in `BaseAgent`. |
| 3 | Sources | **Wiki spaces + Docs (docx) + Drive folders** | Three readers behind one ingest entrypoint. |
| 4 | Storage | **pgvector** | Real semantic search; wire the unused `pg`/`pgvector` deps + a migration. |
| 5 | Lark read layer | **Node SDK as our own tools** | `@larksuiteoapi/node-sdk` wrapped as Anthropic tool-use tools. No MCP host. |
| 6 | Embeddings | **OpenAI** | `text-embedding-3-small` (1536-dim) default. Needs `OPENAI_API_KEY`. |
| 7 | Auth identity | **`tenant_access_token`** | Custom (self-built) app added to the spaces/folders. No per-user OAuth. |
| 8 | Region | **Lark International** | `https://open.larksuite.com` (`lark.Domain.Lark`). |

### Why Node SDK over the official Lark MCP server

The original question was whether `@larksuiteoapi/lark-mcp` helps. For this design it does **not** carry its weight:

- MCP only assists the *read* sub-step. The embed → chunk → pgvector → search layer is custom **regardless** of MCP.
- The MCP server has no **file download** support, which breaks the **Drive folder** source.
- It would add an MCP host/client to a codebase that currently calls the Anthropic SDK directly — extra plumbing for no net gain.

MCP remains useful **at dev-time** (point Claude Desktop / Cursor at `lark-mcp` to explore Lark while building). That is optional and out of the shipped path.

---

## 2. Non-goals (v1)

- Writing or editing Lark documents (ingest-only).
- Sheets / Bitable / Mindnote content parsing (Drive reader handles `docx` + downloadable text/PDF first).
- `user_access_token` / OAuth flows (tenant identity only).
- Scheduled / automatic re-sync (on-demand ingestion only).
- Block-level structural parsing (v1 uses plain raw-text extraction).
- Pre-egress data masking (noted as future work in [§13](#13-security--compliance)).

---

## 3. Architecture

```
                       ┌─────────────────────────────────────────────┐
   POST /api/tasks ───▶│  SrPentesterAgent.execute()                  │
   (agentic path)      │    └─ BaseAgent.callClaude(tools=[...])       │
                       │         tool-use loop                         │
                       │           ├─ lark_ingest ──┐                  │
                       │           └─ kb_search ─────┤                  │
                       └────────────────────────────┼──────────────────┘
                                                     │
   POST /api/knowledge/ingest ───────────────────────┤  (deterministic path, Phase 1)
   (batch trigger)                                   ▼
                          ┌──────────────────────────────────────────┐
                          │  IngestionService                         │
                          │   fetch → chunk → embed → upsert          │
                          └───┬───────────────┬───────────────┬───────┘
                              ▼               ▼               ▼
                        LarkClient        Chunker         Embedder(OpenAI)
                     (wiki/docx/drive)                          │
                              │                                 ▼
                              │                          KnowledgeStore
                              ▼                          (Postgres + pgvector)
                       open.larksuite.com
```

Two entrypoints share one pipeline: the **agentic** path (tool-use, Phase 2) and a **deterministic** `POST /api/knowledge/ingest` endpoint (Phase 1) for testing and bulk loads.

---

## 4. Components

### 4.1 `LarkClient` — `backend/src/integrations/lark/LarkClient.ts`

Thin wrapper over the official SDK. Tenant token acquisition/refresh is handled by the SDK.

```ts
import * as lark from '@larksuiteoapi/node-sdk';

export const larkClient = new lark.Client({
  appId: process.env.LARK_APP_ID!,
  appSecret: process.env.LARK_APP_SECRET!,
  appType: lark.AppType.SelfBuild,
  domain: lark.Domain.Lark,            // https://open.larksuite.com
});
```

### 4.2 Source readers — `backend/src/integrations/lark/readers.ts`

REST endpoint = authoritative; SDK method = representative (verify in installed version).

| Source | REST endpoint | SDK (representative) | Notes |
|--------|---------------|----------------------|-------|
| Docx raw text | `GET /open-apis/docx/v1/documents/:document_id/raw_content` | `client.docx.document.rawContent({ path:{ document_id }, params:{ lang:0 } })` | Plain text — primary ingestion path. |
| Docx blocks | `GET /open-apis/docx/v1/documents/:document_id/blocks` | `client.docx.documentBlock.list({ path:{ document_id }, params:{ page_size:500, document_revision_id:-1 } })` | Optional, richer structure (later). |
| Wiki node list | `GET /open-apis/wiki/v2/spaces/:space_id/nodes` | `client.wiki.spaceNode.list({ path:{ space_id }, params:{ page_size:50, parent_node_token? } })` | Walk tree; recurse `parent_node_token`. |
| Wiki resolve node | `GET /open-apis/wiki/v2/spaces/get_node` | `client.wiki.space.getNode({ params:{ token } })` | Resolve a wiki URL token → `obj_token` + `obj_type`. |
| Drive file list | `GET /open-apis/drive/v1/files` | `client.drive.file.list({ params:{ folder_token, page_size:200 } })` | Recurse on `type:'folder'`. |
| Drive download | `GET /open-apis/drive/v1/files/:file_token/download` | `client.drive.file.download({ path:{ file_token } })` | Returns a stream (binary files). |

**Resolution rules**

- **Wiki node** → each node carries `obj_type` (`docx`, `sheet`, `bitable`, `file`, …). For `obj_type === 'docx'`, read content via `rawContent` using `obj_token` as `document_id`. Other types are skipped in v1.
- **Drive folder** → enumerate children; recurse `folder`; `docx` → `rawContent`; `file` → `download` (extract text only for text/PDF in v1); other types skipped.
- Use the SDK's pagination iterators (`for await … of client.<…>.listWithIterator(...)`) where available rather than manual `page_token` loops.

### 4.3 `Chunker` — `backend/src/knowledge/chunker.ts`

Splits extracted text on paragraph/heading boundaries into ~800-token windows with ~100-token overlap. Each chunk carries `{ content, chunk_index, content_hash }` (`content_hash` = sha256, for dedup / change detection).

### 4.4 `Embedder` — `backend/src/knowledge/embedder.ts`

```ts
import OpenAI from 'openai';
const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY! });

export async function embed(texts: string[]): Promise<number[][]> {
  const res = await openai.embeddings.create({
    model: process.env.OPENAI_EMBED_MODEL ?? 'text-embedding-3-small', // 1536-dim
    input: texts,
  });
  return res.data.map((d) => d.embedding);
}
```

> Model dimension is **fixed at migration time** (column is `vector(1536)`). Switching to
> `text-embedding-3-large` (3072) requires a migration + full re-embed; you cannot mix dims
> in one column.

### 4.5 `KnowledgeStore` — `backend/src/knowledge/KnowledgeStore.ts`

Wraps `pg` + the `pgvector` helper. Exposes `upsert(chunks)` and `search(queryVec, k)`. Kept separate from the existing in-memory `MemoryManager`, which continues to serve per-agent scratch memory.

```ts
import pgvector from 'pgvector/pg';
// register the vector type on the pg client, then:
// search:
//   SELECT id, source_url, title, content, 1 - (embedding <=> $1) AS score
//   FROM knowledge_chunks ORDER BY embedding <=> $1 LIMIT $2;
```

---

## 5. Data model

```sql
CREATE EXTENSION IF NOT EXISTS vector;

CREATE TABLE IF NOT EXISTS knowledge_chunks (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  source_type   TEXT NOT NULL,            -- 'wiki_space' | 'doc' | 'drive_folder' | 'drive_file'
  source_id     TEXT NOT NULL,            -- lark token (document_id / node_token / file_token)
  source_url    TEXT,                     -- canonical Lark URL, used for citation
  title         TEXT,
  chunk_index   INT  NOT NULL,
  content       TEXT NOT NULL,
  content_hash  TEXT NOT NULL,            -- sha256 for change detection / dedup
  embedding     VECTOR(1536) NOT NULL,    -- text-embedding-3-small
  metadata      JSONB NOT NULL DEFAULT '{}',
  ingested_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (source_id, chunk_index)
);

-- HNSW needs pgvector >= 0.5; otherwise use ivfflat.
CREATE INDEX IF NOT EXISTS knowledge_chunks_embedding_idx
  ON knowledge_chunks USING hnsw (embedding vector_cosine_ops);

CREATE INDEX IF NOT EXISTS knowledge_chunks_source_idx
  ON knowledge_chunks (source_type, source_id);
```

Re-ingestion of a source replaces its rows (delete by `source_id`, then insert), with `content_hash` enabling a future incremental diff.

---

## 6. Agent tools (tool-use contracts)

### `lark_ingest`

```jsonc
{
  "name": "lark_ingest",
  "description": "Fetch a Lark resource (wiki space, doc, or drive folder) and index its text into the knowledge base. Read-only.",
  "input_schema": {
    "type": "object",
    "properties": {
      "type":  { "type": "string", "enum": ["wiki_space", "doc", "drive_folder"] },
      "token": { "type": "string", "description": "wiki space_id / docx document_id / drive folder_token (a Lark URL is also accepted and resolved)" }
    },
    "required": ["type", "token"]
  }
}
```

Returns: `{ indexed_chunks: number, sources: [{ title, url, chunks }], skipped: number }`.

### `kb_search`

```jsonc
{
  "name": "kb_search",
  "description": "Semantic search over previously ingested Lark knowledge. Returns the most relevant chunks with source citations.",
  "input_schema": {
    "type": "object",
    "properties": {
      "query": { "type": "string" },
      "k":     { "type": "integer", "default": 6 }
    },
    "required": ["query"]
  }
}
```

Returns: `[{ content, title, source_url, score }]`.

---

## 7. `BaseAgent` tool-use loop (the one core change)

`BaseAgent.callClaude()` currently sends no `tools`. Add a loop (either extend `callClaude` with optional `tools` + `toolHandlers`, or a new `runWithTools()`):

1. Call `messages.create` with `tools` + the running `messages`.
2. While `stop_reason === 'tool_use'`: for each `tool_use` block, invoke the matching handler, then append the `assistant` turn and a `user` turn containing the `tool_result`(s).
3. Re-call until a normal text completion; return final text + accumulated `Finding[]`.
4. Reuse existing cost tracking, `checkBudget()`, and retry/backoff on every iteration.

Tool handlers receive their dependencies (`larkClient`, `knowledgeStore`, `embed`) injected via the skill `context` object — consistent with the repo convention that skills are standalone objects without `this` access to `BaseAgent`. (Note: `AGENT_GUIDE.md`'s `this.callClaude` example does not apply here.)

---

## 8. Repo touch-points

| Path | Change |
|------|--------|
| `backend/src/integrations/lark/LarkClient.ts` | **new** — SDK client (Domain.Lark, tenant token). |
| `backend/src/integrations/lark/readers.ts` | **new** — wiki / docx / drive readers + resolution rules. |
| `backend/src/knowledge/chunker.ts` | **new** — text chunking. |
| `backend/src/knowledge/embedder.ts` | **new** — OpenAI embeddings. |
| `backend/src/knowledge/KnowledgeStore.ts` | **new** — pgvector upsert/search. |
| `backend/src/knowledge/IngestionService.ts` | **new** — orchestrates fetch→chunk→embed→upsert. |
| `backend/src/database/migrate.ts` | **edit** — currently a no-op stub; create extension + table + indexes. |
| `backend/src/agents/base/BaseAgent.ts` | **edit** — add tool-use loop. |
| `backend/src/agents/sr-pentester/skills.ts` | **edit** — define `lark_ingest` / `kb_search` handlers. |
| `backend/src/agents/sr-pentester/index.ts` | **edit** — register tools + inject deps via context. |
| `backend/src/index.ts` | **edit** — add `POST /api/knowledge/ingest` (Phase 1). |
| `backend/src/types/index.ts` | **edit** — `KnowledgeChunk`, tool I/O types. |
| `backend/package.json` | **edit** — add `@larksuiteoapi/node-sdk`, `openai`. (`pg`/`pgvector` already present.) |
| `.env.example` (repo root) | **edit** — add Lark/OpenAI vars. (`DATABASE_URL` + `POSTGRES_*` already present.) |

---

## 9. Configuration (env vars)

| Var | Example | Purpose |
|-----|---------|---------|
| `LARK_APP_ID` | `cli_xxx` | Self-built app ID. |
| `LARK_APP_SECRET` | `xxx` | App secret. **Env only — never commit / never paste in chat.** |
| `LARK_DOMAIN` | `https://open.larksuite.com` | Optional override; default Lark International. |
| `OPENAI_API_KEY` | `sk-...` | Embeddings. |
| `OPENAI_EMBED_MODEL` | `text-embedding-3-small` | Embedding model (dim must match the migration). |
| `DATABASE_URL` | `postgresql://hyagi:hyagi_password@localhost:5432/hyagi` | **Already in `.env.example`.** Postgres must have the `vector` extension. |

`.env` is already covered by `.gitignore` (`.env`, `.env.local`, `.env.*.local`) — keep all secrets there; only `LARK_*` and `OPENAI_*` keys are new additions to `.env.example`.

---

## 10. Lark app setup (open.larksuite.com)

1. **Console → Create app** → *Custom App (Self-built)*.
2. Copy **App ID** and **App Secret** into env vars.
3. **Permissions & Scopes** → add read-only scopes (verify exact identifiers in console):
   - Docs: `docx:document:readonly`
   - Wiki: `wiki:wiki:readonly` (and node read, if listed separately)
   - Drive: `drive:drive:readonly` + file download permission
4. **Release** an app version (scopes take effect after release; admin approval may be required).
5. **Grant data access** — a `tenant_access_token` only sees what the app is granted:
   - Add the app (bot) as a **member of each Wiki space**.
   - **Share each target Drive folder** with the app.
   - Or have a workspace admin grant access centrally.
6. No OAuth redirect URL needed (tenant identity, no user login).

---

## 11. Defaults & tunables

| Setting | Default | Notes |
|---------|---------|-------|
| Embedding model | `text-embedding-3-small` (1536) | `large` (3072) = migration + re-embed. |
| Chunk size / overlap | ~800 / ~100 tokens | On paragraph/heading boundaries. |
| Similarity | cosine (`<=>`) | Matches `vector_cosine_ops` index. |
| `k` (search) | 6 | Override per `kb_search` call. |
| Drive recursion depth | 5 | Guardrail against huge trees. |
| Re-ingest | replace per `source_id` | Hash-diff incremental = future. |

---

## 12. Phasing

**Phase 1 — Storage + ingestion (no agent wiring).** `KnowledgeStore` + migration, `LarkClient` + readers, `Chunker`, `Embedder`, `IngestionService`, and `POST /api/knowledge/ingest`. Fully testable in isolation via `curl`.

**Phase 2 — Agentic wiring.** `BaseAgent` tool-use loop + `lark_ingest` / `kb_search` registered on `SrPentesterAgent`.

**Phase 3 — Future.** Scheduled re-sync, block-level parsing, Sheets/Bitable readers, `user_access_token` / OAuth, pre-egress masking, KB row scoping per agent/space.

---

## 13. Testing & verification

- `npm run build` (strict `tsc`) must pass — `dev` uses `--transpile-only` and will not catch type errors.
- **Unit:** chunker boundaries; `KnowledgeStore.search` ordering with mocked embeddings; readers against mocked SDK responses.
- **Integration:** `docker-compose up -d` (Postgres) → `npm run migrate` → ingest a known doc → assert chunk count → `kb_search` returns it with the correct `source_url`.
- **Manual:**
  ```bash
  curl -X POST http://localhost:3000/api/knowledge/ingest \
    -H 'Content-Type: application/json' \
    -d '{"type":"doc","token":"<docx_document_id>"}'
  ```

---

## 14. Security & compliance

- **Secrets:** env vars only; never committed, never pasted into chat. Verify `.gitignore` covers `.env`.
- **Token blast radius:** a `tenant_access_token` is app-wide. Use read-only scopes and add the app only to the specific spaces/folders required — nothing broader.
- **Data egress:** ingested Lark text is sent to **OpenAI** (embeddings) and **Claude** (generation). Per the workspace data policy, do **not** point ingestion at Restricted/Confidential spaces unless that egress is explicitly cleared. A pre-egress denylist/masking hook is planned for Phase 3.
- **Data at rest:** the pgvector store holds Lark plaintext — treat the DB as sensitive (restricted access, encryption at rest).
- **Auditability:** log `source_id` and the trigger (agent/task or API caller) on every ingest.
- **Abuse / limits:** cap recursion depth and node/file counts per ingest; rely on the SDK's built-in retry for Lark rate limits.

---

## 15. References

- Lark OpenAPI MCP (read-layer alternative, considered and declined): https://github.com/larksuite/lark-openapi-mcp
- Lark Node SDK (`@larksuiteoapi/node-sdk`): https://www.npmjs.com/package/@larksuiteoapi/node-sdk · https://github.com/larksuite/node-sdk
- Lark MCP integration overview: https://open.feishu.cn/document/uAjLw4CM/ukTMukTMukTM/mcp_integration/mcp_introduction
- Lark Open Platform API docs: https://open.larksuite.com/document/home/index
