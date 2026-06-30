# Knowledge Base Components — Reuse Guide (as-built)

**Status:** As-built · reflects the running code (not the design spec)
**Companion doc:** [`LARK_KNOWLEDGE_BASE.md`](./LARK_KNOWLEDGE_BASE.md) is the *pre-code design spec* and still says OpenAI/1536 — **this** doc is the source of truth for what actually ships.

A self-contained **Lark → chunk → embed → pgvector** ingestion + semantic-search pipeline. Built for Hy-AGI but deliberately decoupled, so the pieces lift into another project with minimal surgery.

```
readDoc / readWikiSpace / readDriveFolder   (Lark readers)
        │  DocPayload { sourceId, title, url, text }
        ▼
   chunkText()                              (paragraph-aware splitter)
        │  string[]
        ▼
   embed()                                  (AWS Bedrock Titan V2, 1024-dim)
        │  number[][]
        ▼
   KnowledgeStore.upsertChunks() / .search()  (Postgres + pgvector, cosine)
```

`IngestionService` orchestrates the whole chain; `POST /api/knowledge/ingest` is the only HTTP entrypoint.

---

## 1. Component map

| File | Export | Responsibility | External coupling |
|------|--------|----------------|-------------------|
| `backend/src/integrations/lark/LarkClient.ts` | `getLarkClient()` | Lazy Lark SDK client (tenant token, auto-refresh) | `@larksuiteoapi/node-sdk`, `LARK_*` env |
| `backend/src/integrations/lark/readers.ts` | `readDoc`, `readWikiSpace`, `readDriveFolder` | Pull plain text from Docs / Wiki / Drive → `DocPayload` | `LarkClient`, `logger` |
| `backend/src/knowledge/chunker.ts` | `chunkText(text, opts?)` | Paragraph-aware overlapping chunker, ~char≈token/4 | **none** (pure fn) |
| `backend/src/knowledge/embedder.ts` | `embed(texts)`, `embedOne(text)` | AWS Bedrock Titan V2 embeddings over REST | `fetch` (built-in), `BEDROCK_*`/`KB_EMBED_DIM` env, `logger` |
| `backend/src/knowledge/KnowledgeStore.ts` | `KnowledgeStore` | pgvector upsert / cosine search / delete | `pg`, `DATABASE_URL`, `logger` |
| `backend/src/knowledge/IngestionService.ts` | `IngestionService` | Orchestrates fetch → chunk → embed → upsert | all of the above |
| `backend/src/database/migrate.ts` | (script) | Idempotent schema: extension + table + indexes | `pg`, `DATABASE_URL`, `KB_EMBED_DIM` |

Shared types live in `backend/src/types/index.ts`: `LarkSourceType`, `IngestRequest`, `DocPayload`, `KnowledgeChunk`, `KnowledgeSearchResult`, `IngestResult`.

**Reuse independence:** `chunker.ts` is pure and lifts as-is. `embedder.ts` depends only on `fetch` + env + `logger`. `KnowledgeStore.ts` depends only on `pg` + env + `logger`. The Lark readers are the only Lark-specific piece — swap them for any source that produces a `DocPayload` and the rest of the pipeline is unchanged.

---

## 2. Public API surface

### Lark readers — `readers.ts`
```ts
readDoc(documentId: string): Promise<DocPayload>
readWikiSpace(spaceId: string): Promise<DocPayload[]>          // walks the node tree (depth ≤ 8)
readDriveFolder(folderToken: string): Promise<{ payloads: DocPayload[]; skipped: number }>  // depth ≤ 5
```
On any HTTP error (e.g. 403) `larkGet` throws a clean `Error` carrying Lark's real `{code, msg}` — not an opaque "status code 403". Per-node failures inside wiki/drive walks are logged and skipped, not fatal.

### Chunker — `chunker.ts`
```ts
chunkText(text: string, opts?: { maxTokens?: number; overlapTokens?: number }): string[]
// defaults: maxTokens 800, overlapTokens 100; token ≈ 4 chars
```
Splits on blank-line paragraph boundaries; a single oversized paragraph is hard-split with overlap. Returns `[]` for empty/whitespace input.

### Embedder — `embedder.ts`
```ts
embed(texts: string[]): Promise<number[][]>   // one Bedrock call per text (Titan has no batch input)
embedOne(text: string): Promise<number[]>
```
Output length must equal `KB_EMBED_DIM`; a mismatch logs a warning (it does **not** throw — see §6).

### KnowledgeStore — `KnowledgeStore.ts`
```ts
new KnowledgeStore(connectionString?: string)             // defaults to DATABASE_URL
upsertChunks(sourceId: string, chunks: KnowledgeChunk[]): Promise<number>   // replace-then-insert, transactional
search(embedding: number[], k = 6): Promise<KnowledgeSearchResult[]>       // cosine, returns {title, sourceUrl, content, score}
deleteBySource(sourceId: string): Promise<void>
close(): Promise<void>
```
`upsertChunks` deletes all existing rows for `sourceId` then inserts the new set in one transaction — so re-ingesting a source is idempotent and self-cleaning.

### IngestionService — `IngestionService.ts`
```ts
new IngestionService(store: KnowledgeStore)
ingest(req: { type: 'doc' | 'wiki_space' | 'drive_folder'; token: string }): Promise<IngestResult>
// IngestResult = { indexedChunks: number; sources: {title,url,chunks}[]; skipped: number }
```

### HTTP — `index.ts`
```
POST /api/knowledge/ingest   body: { "type": "doc|wiki_space|drive_folder", "token": "<lark token>" }
```
Wired via lazy singletons (`getIngestionService()` builds `KnowledgeStore` + `IngestionService` on first call).
**Note:** semantic search is implemented in `KnowledgeStore.search()` but **not yet exposed over HTTP** — there is no `GET/POST /api/knowledge/search` route. Add one (embed the query with `embedOne`, then `store.search`) if the consuming project needs query-by-HTTP.

---

## 3. Embeddings: AWS Bedrock Titan (the swapped-in provider)

Embeddings were migrated from OpenAI to **Amazon Titan Text Embeddings V2** (`amazon.titan-embed-text-v2:0`). Key design points to preserve when reusing:

- **Calls the Bedrock Runtime REST API directly** with the Bedrock **API key as a bearer token** (`Authorization: Bearer <AWS_BEARER_TOKEN_BEDROCK>`), using Node 20's built-in `fetch`. This is deliberate: **no `@aws-sdk/*` dependency and no SigV4 signing** — nothing was added to `package.json`.
- Endpoint: `POST https://bedrock-runtime.<region>.amazonaws.com/model/<modelId>/invoke`, body `{ inputText, dimensions, normalize: true }`. Titan V2 honors `dimensions`/`normalize`; V1 ignores them harmlessly.
- **Titan embeds one text per request** (no batch `input` array), so `embed()` loops sequentially — one HTTP call per chunk. Fine for docs; for large wiki spaces add concurrency/throttling (not yet done).
- **`BEDROCK_MODEL_ID` (a Claude model, for text generation) is intentionally separate** from `BEDROCK_EMBED_MODEL_ID`. They share the same bearer token but are distinct concerns — Claude cannot produce embeddings.

To swap the embedding provider again (OpenAI, Cohere, local, etc.): reimplement `embed()`/`embedOne()` keeping the **same signatures** (`(string[]) => Promise<number[][]>`). Nothing else in the pipeline changes — `IngestionService` and `KnowledgeStore` are provider-agnostic.

---

## 4. The dimension contract (read before reusing)

The embedding dimension is **fixed at migration time** — the column is `VECTOR(<KB_EMBED_DIM>)`. Three things must agree:

| Place | Value | Set by |
|-------|-------|--------|
| `KB_EMBED_DIM` env | `1024` (Titan V2 native) | `.env` |
| Migration column | `VECTOR(1024)` | `migrate.ts` reads `KB_EMBED_DIM` |
| Embedder output | 1024 floats | Titan V2 + `dimensions` param |

`CREATE TABLE IF NOT EXISTS` will **not** alter the dimension of an existing table. Changing models/dims = `DROP TABLE knowledge_chunks` (or a proper migration) **and** re-run `npm run migrate` **and** re-embed everything. You cannot mix dims in one column.

Reference points: OpenAI `text-embedding-3-small` = 1536, `-3-large` = 3072; Titan V2 = 1024 (also supports 512/256); Titan V1 = 1536.

---

## 5. Dependencies & environment

**Runtime deps** (all already in `backend/package.json`): `@larksuiteoapi/node-sdk`, `pg`. The embedder uses **no SDK** (built-in `fetch`, needs Node ≥ 18; project targets ≥ 20). `pgvector` npm helper is **not** required — vectors are passed as `::vector` string literals.

**Postgres** must have the `pgvector` extension available (`CREATE EXTENSION vector`). HNSW index needs pgvector ≥ 0.5 (else switch to `ivfflat` in `migrate.ts`).

**Env vars:**

| Var | Example | Purpose |
|-----|---------|---------|
| `DATABASE_URL` | `postgresql://user:pass@host:5432/db` | pgvector store |
| `KB_EMBED_DIM` | `1024` | Vector dim — must match model + migration |
| `AWS_BEARER_TOKEN_BEDROCK` | `ABSK...` | Bedrock API key (bearer). **Secret — env only.** |
| `BEDROCK_REGION` | `us-east-1` | Bedrock Runtime region |
| `BEDROCK_EMBED_MODEL_ID` | `amazon.titan-embed-text-v2:0` | Embedding model |
| `LARK_APP_ID` / `LARK_APP_SECRET` | `cli_...` / `...` | Self-built Lark app (readers only). **Secret.** |
| `LARK_DOMAIN` | `https://open.larksuite.com` | Optional; default Lark International |

`.env` is gitignored (`.env`, `.env.local`, `.env.*.local`); only `.env.example` is committed. Keep all secrets in `.env`.

---

## 6. Known gaps / sharp edges (carry these into reuse)

- **No HTTP search route** — `KnowledgeStore.search()` exists but is unexposed (§2).
- **No embedding batching/throttling** — one Bedrock call per chunk; large sources will be slow and may hit Bedrock rate limits. Add `p-limit`-style concurrency if needed.
- **Dim-mismatch is a warning, not an error** — if `KB_EMBED_DIM` and the model disagree, `embed()` logs a warning and returns the vector anyway; the pgvector insert then fails at the DB layer. Treat the migration/model/env triad (§4) as a hard contract.
- **`migrate.ts` log typo** — the `DATABASE_URL not set` warning has stray characters (flagged by Codex review); cosmetic only.
- **Lark v1 readers** handle `docx` only — sheets/bitable/binary are counted in `skipped`, not parsed.
- **Drive/Wiki recursion caps** — depth 5 (drive) / 8 (wiki) guard against huge trees; deep content beyond that is silently not walked.

---

## 7. Lift-into-another-project checklist

1. Copy `backend/src/knowledge/` (chunker, embedder, KnowledgeStore, IngestionService) and `backend/src/integrations/lark/` (only if you need Lark; otherwise write your own reader returning `DocPayload`).
2. Copy the KB types from `types/index.ts` (`DocPayload`, `KnowledgeChunk`, `KnowledgeSearchResult`, `IngestRequest`, `IngestResult`, `LarkSourceType`) and the `logger` util (or repoint imports at your logger).
3. Copy/port `database/migrate.ts`; ensure Postgres has `pgvector`; set `KB_EMBED_DIM` to your model's dim **before** migrating.
4. Add deps: `pg` (+ `@larksuiteoapi/node-sdk` only if using the Lark readers). No AWS SDK needed.
5. Set the env vars in §5. Smoke-test the embedder in isolation (`embedOne('hello')` → length === `KB_EMBED_DIM`) before wiring the full pipeline.
6. Wire an entrypoint: `new IngestionService(new KnowledgeStore()).ingest({type, token})` for ingest; `store.search(await embedOne(query), k)` for retrieval.

---

## 8. Verification (commands that prove it works)

```bash
# from backend/
npm run migrate        # creates knowledge_chunks at VECTOR(KB_EMBED_DIM)
npm run dev            # restart needed to pick up .env changes

curl -X POST http://localhost:3000/api/knowledge/ingest \
  -H "Content-Type: application/json" \
  -d '{"type":"doc","token":"<docx_document_id>"}'
# → { success:true, data:{ indexedChunks, sources:[{title,url,chunks}], skipped } }
```

> **PowerShell quoting:** `curl.exe -d '{"...":"..."}'` gets its inner quotes stripped by PowerShell and the server rejects it as invalid JSON. Use `Invoke-RestMethod -Method Post -Uri ... -ContentType "application/json" -Body '{"type":"doc","token":"..."}'`, or double the inner quotes, or pass `--data "@body.json"`.

Last verified end-to-end (2026-06-30): a Lark docx ingested as **69 chunks at dim 1024**; a Bedrock-embedded query returned that doc as the top cosine matches.
```ts
const store = new KnowledgeStore();
const hits = await store.search(await embedOne('how to test for SQL injection'), 3);
// hits[0].score ≈ 0.56, hits[0].title === 'Web Application Penetration Test Checklist'
```
