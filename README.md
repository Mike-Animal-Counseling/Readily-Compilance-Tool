# Readily Compliance Review MVP

A production-style MVP for healthcare compliance review. The app lets an analyst upload an audit PDF, extract review questions, upload policy PDFs, retrieve relevant policy evidence, generate grounded Yes/No audit answers, and export review-ready results.

The system is framed as a secure compliance assistant built around data minimization. For this MVP, sensitive policy text is kept server-side after parsing, only top retrieved chunks are sent to the LLM, and the frontend receives only document metadata plus result snippets needed for review.

The app now supports a persistent pre-ingested default policy library plus optional uploaded policies. This makes the workflow closer to a real organization policy knowledge base while preserving the existing upload flow.

## Stack

- Next.js 16.2.1 with App Router
- TypeScript
- Tailwind CSS 4
- OpenRouter for LLM calls
- `pdfjs-dist` for page-preserving PDF text extraction
- `zod` for request and model-output validation

## What It Does

1. Upload one audit PDF
2. Extract audit/compliance questions with the LLM
3. Review and edit extracted questions
4. Upload one or more policy PDFs
5. Parse policy PDFs page by page with file and page metadata
6. Ingest default policy PDFs from the `policies/` folder into Postgres
7. Query the persistent default library from Postgres at request time
8. Support hybrid retrieval from the default library plus uploaded PDFs
9. Return a preliminary audit answer of `Yes` or `No`
10. Show confidence, reason, primary evidence, source file, source page, source type, and retrieved supporting chunks
11. Support analyst review states and CSV export

## Environment Variables

Create a `.env.local` file:

```bash
OPENROUTER_API_KEY=your_openrouter_api_key
OPENROUTER_MODEL=openai/gpt-4.1-mini
OPENROUTER_EXTRACT_MODEL=openai/gpt-4.1-mini
OPENROUTER_REVIEW_MODEL=openai/gpt-4o
OPENROUTER_EMBEDDING_MODEL=openai/text-embedding-3-small
OPENROUTER_EMBEDDING_DIMENSIONS=1536
AUDIT_EXTRACTION_BATCH_SIZE=3
AUDIT_EXTRACTION_MAX_TOKENS=1200
AUDIT_EXTRACTION_TIMEOUT_MS=10000
EVALUATION_CONCURRENCY=3
EVALUATION_LLM_TIMEOUT_MS=20000
RETRIEVAL_VECTOR_WEIGHT=3
PRELOADED_LEXICAL_WEIGHT=1
PRELOADED_VECTOR_WEIGHT=0.35
DATABASE_URL=your_postgres_connection_string
```

The repo includes `.env.example` with the same keys.

- `OPENROUTER_MODEL` is the fallback default model.
- `OPENROUTER_EXTRACT_MODEL` optionally overrides the audit-question extraction model.
- `OPENROUTER_REVIEW_MODEL` optionally overrides the review/evaluation model.
- `OPENROUTER_EMBEDDING_MODEL` is used for preloaded-policy embeddings in Postgres.
- `AUDIT_EXTRACTION_*` controls audit extraction batching, token budget, and timeout.
- `EVALUATION_*` controls review concurrency and LLM timeout.
- `RETRIEVAL_VECTOR_WEIGHT` and `PRELOADED_*_WEIGHT` control lexical/vector blending.

## Install

```bash
npm install
```

## Run

```bash
npm run dev
```

Open `http://localhost:3000`.

## Default Policy Library

Put organization policy PDFs in the `policies/` folder.

- Run the offline ingest command:

```bash
npm run ingest:policies
```

- This incrementally syncs PDFs from `policies/` into Postgres.
- Unchanged PDFs are skipped.
- New or modified PDFs are re-parsed and re-written.
- PDFs removed from `policies/` are deleted from the default policy library.
- Online requests no longer parse the default library on the fly.
- The UI exposes a `Use default policy library` toggle, enabled by default when policy PDFs are present.

## Database Setup

Set `DATABASE_URL` in `.env.local`.

For Vercel deployment, the simplest path is:

1. Create a Postgres database through the Vercel Marketplace, typically Neon-backed
2. Copy the connection string into `DATABASE_URL`
3. Run `npm run ingest:policies` locally or in a trusted CI environment
4. Deploy the app to Vercel

## Verify

```bash
npm run lint
npm run build
```

## Demo Flow

1. Upload an audit PDF in Step 1.
2. Click `Extract questions`.
3. Review, edit, add, or remove questions in Step 2.
4. Upload one or more policy PDFs in Step 3.
5. Click `Parse policies`.
6. Choose which parsed policies to include.
7. Click `Run review`.
8. Review `Yes`/`No` answers, confidence, reason, evidence, and citations.
9. Adjust review state or re-run a single question after editing it.
10. Export the result set with `Export CSV`.

## API Routes

- `POST /api/extract-audit`
  - Accepts one audit PDF
  - Extracts PDF text
  - Streams extraction progress events while batching pages through the LLM
  - Falls back to local heuristic extraction when needed

- `POST /api/parse-policies`
  - Accepts one or more policy PDFs
  - Parses page text with page-number preservation
  - Stores parsed documents and chunks server-side in memory
  - Returns a dataset ID plus document metadata only

- `GET /api/policy-library`
  - Returns metadata for the Postgres-backed default policy library

- `POST /api/evaluate`
  - Accepts reviewed questions plus default-library toggle and optional uploaded dataset ID
  - Retrieves relevant chunks from both the persistent default library and uploaded policies
  - Calls OpenRouter and returns structured `Yes`/`No` results

- `POST /api/evaluate-one`
  - Re-runs one question only

## Sensitive Data Handling

- Raw policy pages and chunk text are not returned to the frontend.
- The browser stores only the policy dataset ID, document metadata, reviewed questions, and evaluation results.
- The evaluator retrieves only the selected uploaded documents and top matching chunks on the server.
- The LLM receives only the top retrieved chunks for a question, never full documents.
- The results UI displays primary evidence plus an optional expandable list of retrieved chunks used for evaluation.
- The default policy library is persisted in Postgres and ingested offline.
- Uploaded policy datasets remain temporary and session-scoped.
- There is no auth in this MVP, but the design leaves room for future user-based access controls and organization dataset separation.

## Notes

- This MVP uses Postgres for the persistent default policy library plus an in-memory uploaded dataset store.
- Retrieval is hybrid by source: persistent default-library candidates plus uploaded-session candidates.
- The app does not support OCR-only scanned PDFs. Text must be extractable from the PDF.
- LLM output is validated with `zod`, and citations are constrained to retrieved chunks.
- Audit extraction and review both show real progress in the UI.
- Review results expose the primary evidence plus the retrieved chunk set that was sent to the model.
- The app is positioned as scalable toward HIPAA-compliant production architecture, but it intentionally avoids enterprise-grade security overengineering in this MVP.

## New Modules

- `lib/db/preloaded-policy-store.ts`
  - Stores and queries the persistent default policy library in Postgres

- `lib/rag/embeddings.ts`
  - Creates lightweight deterministic local embeddings for MVP retrieval

- `lib/rag/vector-store.ts`
  - Vectorizes chunks and provides cosine similarity helpers

- `app/api/policy-library/route.ts`
  - Returns default library metadata to the UI

- `scripts/ingest-preloaded-policies.ts`
  - Offline ingestion command for loading `policies/` into Postgres
