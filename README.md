# Readily — Compliance Review Workspace

**Turn an audit PDF and your policies into evidence-linked answers for analyst review.**

Readily extracts questions, retrieves policy passages, drafts preliminary Yes/No answers,
and exports a review-ready CSV with citations and review state.

[Workflow](#workflow) · [Run locally](#run-locally) · [Configuration](#configuration) · [API](#api) · [Deployment](#deployment)

## Workflow

1. **Extract** — upload an audit PDF and get an editable question set.
2. **Select evidence** — upload policy PDFs or use the pre-ingested library.
3. **Review** — run evaluation and inspect each answer, confidence, reason, source file,
   page, and supporting chunks.
4. **Resolve** — adjust the review state or re-run an edited question.
5. **Export** — download a CSV with answers, citations, and review state.

Model output is an input to analyst review. Text must be extractable from uploaded PDFs;
OCR-only scans are not supported.

## Run locally

Use **Node.js 24+** and the committed lockfile.

```bash
git clone https://github.com/Mike-Animal-Counseling/readily-compliance-tool.git
cd readily-compliance-tool
npm ci --ignore-scripts
cp .env.example .env.local
```

Generate two different secrets by running this command twice:

```bash
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

Set one result as `DEMO_ACCESS_CODE` and the other as `SESSION_SECRET`, keep
`APP_ORIGIN=http://localhost:3000`, and provide `OPENROUTER_API_KEY`. Then:

```bash
npm run dev
```

Open **http://localhost:3000** and enter your access code. Use synthetic documents when
trying the workflow.

## Configuration

Start from [`.env.example`](.env.example). The main settings are:

| Setting | Purpose |
| --- | --- |
| `DEMO_ACCESS_CODE` | Invite code, generated independently, at least 32 characters |
| `SESSION_SECRET` | Separate random secret used to sign access sessions |
| `APP_ORIGIN` | Exact application origin; HTTPS required in production |
| `REDIS_URL` | Authenticated TLS Redis (`rediss://`) required in production |
| `OPENROUTER_API_KEY` | Provider credential for model-backed extraction and review |
| `DATABASE_URL` | PostgreSQL connection for the optional persistent policy library |
| `AUDIT_EXTRACTION_*`, `EVALUATION_*` | Batch size, token budget, concurrency, and timeouts |

Never commit `.env.local`, real policy documents, or provider credentials.

## Policy library

For a persistent library, configure `DATABASE_URL`, place policy PDFs in `policies/`, and run:

```bash
npm run ingest:policies
```

Unchanged PDFs are skipped, changed PDFs are re-parsed, and removed PDFs are deleted.
Online requests query the ingested library and can combine it with uploaded policies.

## API

| Route | Purpose |
| --- | --- |
| `POST /api/extract-audit` | Start batched question extraction; returns a job ID |
| `GET /api/extract-audit?jobId=...` | Read extraction progress and results |
| `POST /api/parse-policies` | Parse uploaded PDFs into page-preserving chunks |
| `GET /api/policy-library` | Read persistent-library metadata |
| `POST /api/evaluate` | Evaluate reviewed questions against selected evidence |
| `POST /api/evaluate-one` | Re-run a single edited question |

## Data and access

- Access is an invite code plus signed, expiring HttpOnly sessions; it is not SSO.
- Jobs and datasets are isolated by session; production uses bounded shared Redis storage.
- Retrieved excerpts are sent to OpenRouter for model-backed review. Configure the
  provider's privacy, retention, and spending controls.
- A controlled demo should use synthetic documents. Organization use needs appropriate
  identity, authorization, and audit controls first.

## Stack

Next.js App Router, React, TypeScript, and Tailwind CSS · `pdf2json` for page metadata ·
OpenRouter with Zod validation · PostgreSQL for the policy library · Redis for production jobs.

## Verify

```bash
npm test && npm run lint && npm run build && npm audit
```

## Deployment

Production requires an HTTPS origin, independent access and session secrets, and
authenticated TLS Redis. Configure PostgreSQL for a persistent library and provider access
for model-backed operations. Follow the [production requirements](docs/PRODUCTION_SECURITY.md)
and the [security policy](SECURITY.md) before deployment.
