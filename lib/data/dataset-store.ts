import { type VectorizedPolicyChunk, vectorizePolicyChunks } from "@/lib/rag/vector-store";
import type { PolicyChunk, PolicyDocumentRecord } from "@/types/compliance";

type DatasetRecord = {
  createdAt: number;
  documents: PolicyDocumentRecord[];
  chunks: VectorizedPolicyChunk[];
};

const DATASET_TTL_MS = 1000 * 60 * 60;
const datasetStore = new Map<string, DatasetRecord>();

function pruneExpiredDatasets() {
  const now = Date.now();

  for (const [datasetId, record] of datasetStore.entries()) {
    if (now - record.createdAt > DATASET_TTL_MS) {
      datasetStore.delete(datasetId);
    }
  }
}

export function createDataset({
  documents,
  chunks,
}: {
  documents: PolicyDocumentRecord[];
  chunks: PolicyChunk[];
}) {
  pruneExpiredDatasets();

  const datasetId = globalThis.crypto.randomUUID();
  datasetStore.set(datasetId, {
    createdAt: Date.now(),
    documents,
    chunks: vectorizePolicyChunks(chunks),
  });

  return datasetId;
}

export function getDataset(datasetId: string) {
  pruneExpiredDatasets();
  return datasetStore.get(datasetId) ?? null;
}
