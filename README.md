# Readily — Compliance Review Workspace

Turn an audit PDF and policy documents into evidence-linked answers for analyst review. Readily extracts questions, retrieves policy passages, generates preliminary Yes/No answers, and exports a review-ready CSV with citations and review state.

[Workflow](#review-workflow) · [Run Locally](#run-locally) · [Configuration](#configuration) · [API](#api-reference) · [Deployment](#deployment)

## Review Workflow

| Step | Analyst action | Result |
| --- | --- | --- |
| 1. Extract | Upload an audit PDF | A question set that can be reviewed and edited |
| 2. Select evidence | Upload policy PDFs or use the pre-ingested library | Page-preserving policy passages available for retrieval |
| 3. Review | Run evaluation and inspect each answer | Preliminary Yes/No, confidence, reason, source file, page, and supporting chunks |
| 4. Resolve | Adjust review state or re-run an edited question | Analyst-reviewed findings |
| 5. Export | Download CSV | Answers, citations, and review state for follow-up |

The model's answer is an input to analyst review. Text must be extractable from uploaded PDFs; OCR-only scans are not supported.

## Run Locally

Use **Node.js 24+** and the committed lockfile.

```bash
git clone https://github.com/Mike-Animal-Counseling/Readily-Compilance-Tool.git
cd Readily-Compilance-Tool
npm ci --ignore-scripts
cp .env.example .env.local
```

PowerShell users can use `Copy-Item .env.example .env.local` for the final step.

Generate two different random secrets by running this command twice:

```bash
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

Set one result as `DEMO_ACCESS_CODE` and the other as `SESSION_SECRET` in `.env.local`. Keep `APP_ORIGIN=http://localhost:3000` locally and provide `OPENROUTER_API_KEY` for model-backed extraction and review. Use synthetic documents when trying the workflow.

```bash
npm run dev
```

Open **http://localhost:3000** and enter your generated access code. The old `READILY2026` sample code is rejected by the current application.

## Configuration

The maintained configuration template is [`.env.example`](.env.example). Copy it rather than relying on an older configuration block.

| Setting | Purpose |
| --- | --- |
| `DEMO_ACCESS_CODE` | Invite code; independently generated and at least 32 characters |
| `SESSION_SECRET` | Different random secret used to sign access sessions |
| `APP_ORIGIN` | Exact application origin; HTTPS required in production |
| `REDIS_URL` | Authenticated TLS Redis (`rediss://`) required in production |
| `OPENROUTER_API_KEY` | Provider credential for model-backed operations |
| `OPENROUTER_MODEL` | Fallback model; extraction and review have optional overrides |
| `DATABASE_URL` | PostgreSQL connection for the optional persistent policy library |
| `AUDIT_EXTRACTION_*` | Extraction batch size, token budget, and timeout |
| `EVALUATION_*` | Review concurrency and provider timeout |
| `RETRIEVAL_VECTOR_WEIGHT`, `PRELOADED_*_WEIGHT` | Retrieval blending settings |

Additional embedding-model settings are listed in the template. Never commit `.env.local`, real policy documents, or provider credentials.

## Default Policy Library

Uploaded policies can be used for a review session. For a persistent library, configure `DATABASE_URL`, place the intended policy PDFs in `policies/`, then run:

```bash
npm run ingest:policies
```

The offline ingest command syncs the directory into PostgreSQL: unchanged PDFs are skipped, changed PDFs are re-parsed, and removed PDFs are deleted from the library. Online requests query the ingested library instead of parsing that directory again. The interface can combine library results with selected uploaded policies.

## API Reference

| Route | Purpose |
| --- | --- |
| `POST /api/extract-audit` | Start batched question extraction and return a job ID |
| `GET /api/extract-audit?jobId=...` | Read extraction progress and results |
| `POST /api/parse-policies` | Parse uploaded PDFs into page-preserving policy chunks |
| `GET /api/policy-library` | Read persistent-library metadata |
| `POST /api/evaluate` | Evaluate reviewed questions against selected evidence |
| `POST /api/evaluate-one` | Re-run a single edited question |

## Data and Access

- Access uses an invite code and signed, expiring HttpOnly sessions. It is not an organization identity or SSO system.
- Jobs and uploaded datasets are isolated by session; production uses shared Redis storage with bounded lifetimes and budgets.
- Policy parsing and retrieval run server-side. The interface receives metadata, review results, and evidence snippets needed for review.
- Retrieved policy excerpts are sent to OpenRouter for model-backed review. Configure the provider's privacy, retention, and spending controls for the deployment.
- A controlled demo should use synthetic documents. Organization use requires appropriate identity, authorization, and audit controls before sensitive documents are accepted.

See [production requirements](docs/PRODUCTION_SECURITY.md) for upload limits, storage lifetimes, session behavior, and deployment controls.

## Architecture

| Layer | Implementation |
| --- | --- |
| Interface and API | Next.js App Router, React, TypeScript, Tailwind CSS |
| PDF parsing | `pdf2json` with page metadata |
| Model calls and validation | OpenRouter and Zod |
| Persistent library | PostgreSQL and offline ingestion |
| Production jobs and datasets | Shared Redis storage |

Useful implementation entry points:

- [Persistent policy store](lib/db/preloaded-policy-store.ts)
- [Retrieval](lib/rag/retrieval.ts) and [evaluation](lib/rag/evaluation.ts)
- [Session verification](lib/auth/session.ts)
- [Offline ingestion](scripts/ingest-preloaded-policies.ts)

## Verify

```bash
npm test
npm run lint
npm run build
npm audit
```

## Deployment

Hosted testing is operator-managed. A page response alone does not verify PDF processing or model-backed review. The configured Vercel address returned HTTP 500 during the 2026-10-31 documentation check; hosted availability needs a separate deployment investigation.

Production startup requires the configured HTTPS origin, independent access/session secrets, and authenticated TLS Redis. Configure PostgreSQL for a persistent policy library and provider access for model-backed operations. Follow the [production requirements](docs/PRODUCTION_SECURITY.md) before deployment and the [security policy](SECURITY.md) for private vulnerability reporting.
