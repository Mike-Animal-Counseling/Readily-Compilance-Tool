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

const JOB_TTL_MS = 30 * 60 * 1000;

declare global {
  var __extractAuditJobs: Map<string, ExtractAuditJobRecord> | undefined;
}

function getJobStore() {
  if (!globalThis.__extractAuditJobs) {
    globalThis.__extractAuditJobs = new Map<string, ExtractAuditJobRecord>();
  }

  return globalThis.__extractAuditJobs;
}

function pruneExpiredJobs() {
  const cutoff = Date.now() - JOB_TTL_MS;

  for (const [jobId, job] of getJobStore()) {
    if (job.updatedAt < cutoff) {
      getJobStore().delete(jobId);
    }
  }
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

export function createExtractAuditJob(): ExtractAuditJobStartResponse {
  pruneExpiredJobs();

  const jobId = globalThis.crypto.randomUUID();
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

export function getExtractAuditJob(jobId: string) {
  pruneExpiredJobs();
  const job = getJobStore().get(jobId);
  return job ? toJobStatusResponse(job) : null;
}

export function startExtractAuditJob(jobId: string) {
  updateExtractAuditJob(jobId, {
    status: "running",
  });
}

export function updateExtractAuditJob(
  jobId: string,
  updates: Partial<Omit<ExtractAuditJobRecord, "id" | "createdAt">>,
) {
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

export function completeExtractAuditJob(jobId: string, payload: ExtractAuditResponse) {
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

export function failExtractAuditJob(jobId: string, error: string) {
  updateExtractAuditJob(jobId, {
    status: "failed",
    error,
    message: error,
  });
}
