import { getDb } from "@/lib/db/client";
import type {
  ExtractAuditJobStartResponse,
  ExtractAuditJobStatus,
  ExtractAuditJobStatusResponse,
  ExtractAuditResponse,
  ExtractAuditStage,
} from "@/types/compliance";

type ExtractAuditJobRecord = {
  id: string;
  status: ExtractAuditJobStatus;
  stage: ExtractAuditStage;
  message: string;
  completedBatches: number;
  totalBatches: number;
  payload: ExtractAuditResponse | null;
  error: string | null;
  createdAt: number;
  updatedAt: number;
};

type DbExtractAuditJobRow = {
  id: string;
  status: ExtractAuditJobStatus;
  stage: ExtractAuditStage;
  message: string;
  completedBatches: number;
  totalBatches: number;
  payloadJson: string | null;
  error: string | null;
};

const JOB_TTL_MS = 30 * 60 * 1000;

declare global {
  var __extractAuditJobs: Map<string, ExtractAuditJobRecord> | undefined;
}

let schemaReadyPromise: Promise<void> | null = null;

function isDatabaseBacked() {
  return Boolean(process.env.DATABASE_URL);
}

function getJobStore() {
  if (!globalThis.__extractAuditJobs) {
    globalThis.__extractAuditJobs = new Map<string, ExtractAuditJobRecord>();
  }

  return globalThis.__extractAuditJobs;
}

function toJobStatusResponse(job: ExtractAuditJobRecord): ExtractAuditJobStatusResponse {
  return {
    jobId: job.id,
    status: job.status,
    stage: job.stage,
    message: job.message,
    completedBatches: job.completedBatches,
    totalBatches: job.totalBatches,
    payload: job.payload ?? undefined,
    error: job.error ?? undefined,
  };
}

function parsePayloadJson(payloadJson: string | null) {
  if (!payloadJson) {
    return undefined;
  }

  return JSON.parse(payloadJson) as ExtractAuditResponse;
}

function pruneExpiredMemoryJobs() {
  const cutoff = Date.now() - JOB_TTL_MS;

  for (const [jobId, job] of getJobStore()) {
    if (job.updatedAt < cutoff) {
      getJobStore().delete(jobId);
    }
  }
}

async function ensureExtractAuditJobSchema() {
  if (!isDatabaseBacked()) {
    return;
  }

  if (schemaReadyPromise) {
    await schemaReadyPromise;
    return;
  }

  schemaReadyPromise = (async () => {
    const sql = getDb();

    await sql`
      CREATE TABLE IF NOT EXISTS extract_audit_jobs (
        id TEXT PRIMARY KEY,
        status TEXT NOT NULL,
        stage TEXT NOT NULL,
        message TEXT NOT NULL,
        completed_batches INTEGER NOT NULL DEFAULT 0,
        total_batches INTEGER NOT NULL DEFAULT 0,
        payload_json TEXT,
        error TEXT,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `;

    await sql`
      CREATE INDEX IF NOT EXISTS extract_audit_jobs_updated_at_idx
      ON extract_audit_jobs (updated_at DESC)
    `;
  })().catch((error) => {
    schemaReadyPromise = null;
    throw error;
  });

  await schemaReadyPromise;
}

async function pruneExpiredDbJobs() {
  await ensureExtractAuditJobSchema();

  const sql = getDb();
  const cutoff = new Date(Date.now() - JOB_TTL_MS);

  await sql`
    DELETE FROM extract_audit_jobs
    WHERE updated_at < ${cutoff.toISOString()}
  `;
}

async function createDbJobRecord(jobId: string) {
  await pruneExpiredDbJobs();

  const sql = getDb();

  await sql`
    INSERT INTO extract_audit_jobs (
      id,
      status,
      stage,
      message,
      completed_batches,
      total_batches,
      payload_json,
      error
    ) VALUES (
      ${jobId},
      'queued',
      'starting',
      'Preparing audit extraction job.',
      0,
      0,
      NULL,
      NULL
    )
  `;
}

async function getDbJobRecord(jobId: string) {
  await pruneExpiredDbJobs();

  const sql = getDb();
  const [row] = await sql<DbExtractAuditJobRow[]>`
    SELECT
      id,
      status,
      stage,
      message,
      completed_batches AS "completedBatches",
      total_batches AS "totalBatches",
      payload_json AS "payloadJson",
      error
    FROM extract_audit_jobs
    WHERE id = ${jobId}
    LIMIT 1
  `;

  if (!row) {
    return null;
  }

  return {
    jobId: row.id,
    status: row.status,
    stage: row.stage,
    message: row.message,
    completedBatches: row.completedBatches,
    totalBatches: row.totalBatches,
    payload: parsePayloadJson(row.payloadJson),
    error: row.error ?? undefined,
  } satisfies ExtractAuditJobStatusResponse;
}

async function updateDbJobRecord(
  jobId: string,
  updates: Partial<{
    status: ExtractAuditJobStatus;
    stage: ExtractAuditStage;
    message: string;
    completedBatches: number;
    totalBatches: number;
    payload: ExtractAuditResponse | null;
    error: string | null;
  }>,
) {
  await ensureExtractAuditJobSchema();

  const sql = getDb();

  await sql`
    UPDATE extract_audit_jobs
    SET
      status = COALESCE(${updates.status ?? null}, status),
      stage = COALESCE(${updates.stage ?? null}, stage),
      message = COALESCE(${updates.message ?? null}, message),
      completed_batches = COALESCE(${updates.completedBatches ?? null}, completed_batches),
      total_batches = COALESCE(${updates.totalBatches ?? null}, total_batches),
      payload_json = CASE
        WHEN ${updates.payload === undefined} THEN payload_json
        ELSE ${updates.payload ? JSON.stringify(updates.payload) : null}
      END,
      error = CASE
        WHEN ${updates.error === undefined} THEN error
        ELSE ${updates.error ?? null}
      END,
      updated_at = NOW()
    WHERE id = ${jobId}
  `;
}

export async function createExtractAuditJob(): Promise<ExtractAuditJobStartResponse> {
  const jobId = globalThis.crypto.randomUUID();

  if (isDatabaseBacked()) {
    await createDbJobRecord(jobId);
    return { jobId };
  }

  pruneExpiredMemoryJobs();
  const now = Date.now();

  getJobStore().set(jobId, {
    id: jobId,
    status: "queued",
    stage: "starting",
    message: "Preparing audit extraction job.",
    completedBatches: 0,
    totalBatches: 0,
    payload: null,
    error: null,
    createdAt: now,
    updatedAt: now,
  });

  return { jobId };
}

export async function getExtractAuditJob(jobId: string) {
  if (isDatabaseBacked()) {
    return getDbJobRecord(jobId);
  }

  pruneExpiredMemoryJobs();
  const job = getJobStore().get(jobId);
  return job ? toJobStatusResponse(job) : null;
}

export async function startExtractAuditJob(jobId: string) {
  if (isDatabaseBacked()) {
    await updateDbJobRecord(jobId, {
      status: "running",
    });
    return;
  }

  updateExtractAuditJob(jobId, {
    status: "running",
  });
}

export async function updateExtractAuditJob(
  jobId: string,
  updates: Partial<Omit<ExtractAuditJobRecord, "id" | "createdAt" | "updatedAt">>,
) {
  if (isDatabaseBacked()) {
    await updateDbJobRecord(jobId, {
      status: updates.status,
      stage: updates.stage,
      message: updates.message,
      completedBatches: updates.completedBatches,
      totalBatches: updates.totalBatches,
      payload: updates.payload,
      error: updates.error,
    });
    return;
  }

  const job = getJobStore().get(jobId);

  if (!job) {
    return;
  }

  getJobStore().set(jobId, {
    ...job,
    ...updates,
    updatedAt: Date.now(),
  });
}

export async function completeExtractAuditJob(
  jobId: string,
  payload: ExtractAuditResponse,
) {
  if (isDatabaseBacked()) {
    const job = await getDbJobRecord(jobId);
    if (!job) {
      return;
    }

    await updateDbJobRecord(jobId, {
      status: "completed",
      stage: "complete",
      message: `Extracted ${payload.questions.length} questions.`,
      completedBatches: job.totalBatches,
      payload,
      error: null,
    });
    return;
  }

  const job = getJobStore().get(jobId);
  if (!job) {
    return;
  }

  getJobStore().set(jobId, {
    ...job,
    status: "completed",
    stage: "complete",
    message: `Extracted ${payload.questions.length} questions.`,
    completedBatches: job.totalBatches,
    payload,
    error: null,
    updatedAt: Date.now(),
  });
}

export async function failExtractAuditJob(jobId: string, error: string) {
  if (isDatabaseBacked()) {
    await updateDbJobRecord(jobId, {
      status: "failed",
      error,
      message: error,
    });
    return;
  }

  updateExtractAuditJob(jobId, {
    status: "failed",
    error,
    message: error,
  });
}
