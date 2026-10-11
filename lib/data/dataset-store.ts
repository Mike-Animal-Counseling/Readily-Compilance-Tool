import { type VectorizedPolicyChunk, vectorizePolicyChunks } from "@/lib/rag/vector-store";
import type { PolicyChunk, PolicyDocumentRecord } from "@/types/compliance";
import { loadValue, storeValue } from "../security/store";
type DatasetRecord = { createdAt: number; documents: PolicyDocumentRecord[]; chunks: VectorizedPolicyChunk[] };
export async function createDataset({ documents, chunks }: { documents: PolicyDocumentRecord[]; chunks: PolicyChunk[] }, owner: string) {
  const id = crypto.randomUUID();
  await storeValue(`dataset:${owner}:${id}`, { createdAt: Date.now(), documents, chunks: vectorizePolicyChunks(chunks) }, 3600);
  return id;
}
export async function getDataset(id: string, owner: string) {
  return loadValue<DatasetRecord>(`dataset:${owner}:${id}`);
}
