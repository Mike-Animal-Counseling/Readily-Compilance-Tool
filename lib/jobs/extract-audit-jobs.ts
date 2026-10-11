import { loadValue, storeValue } from "../security/store";
import type { ExtractAuditJobStatusResponse, ExtractAuditResponse } from "@/types/compliance";
export async function createExtractAuditJob(owner: string) {
  const jobId = `${owner}.${crypto.randomUUID()}`;
  await storeValue('job:' + jobId, { jobId, status: 'queued', stage: 'starting', message: 'Preparing audit extraction.', completedBatches: 0, totalBatches: 0 }, 1800);
  return { jobId };
}
export async function getExtractAuditJob(jobId: string) { return loadValue<ExtractAuditJobStatusResponse>('job:' + jobId); }
export async function updateExtractAuditJob(jobId: string, updates: Partial<ExtractAuditJobStatusResponse>) {
  const job = await getExtractAuditJob(jobId);
  if (job) await storeValue('job:' + jobId, { ...job, ...updates }, 1800);
}
export async function startExtractAuditJob(jobId: string) { await updateExtractAuditJob(jobId, { status: 'running' }); }
export async function completeExtractAuditJob(jobId: string, payload: ExtractAuditResponse) {
  const job = await getExtractAuditJob(jobId);
  if (job) await updateExtractAuditJob(jobId, { status: 'completed', stage: 'complete', message: 'Audit extraction completed.', completedBatches: job.totalBatches, payload });
}
export async function failExtractAuditJob(jobId: string, privateReason?: string) {
  // Callers may provide a diagnostic; provider responses are never persisted.
  void privateReason;
  await updateExtractAuditJob(jobId, { status: 'failed', message: 'Audit extraction failed.', error: 'Audit extraction failed.' });
}
