import { createTextEmbedding } from "@/lib/rag/embeddings";
import type { PolicyChunk } from "@/types/compliance";

export type VectorizedPolicyChunk = PolicyChunk & {
  embedding: number[];
};

export function vectorizePolicyChunks(chunks: PolicyChunk[]): VectorizedPolicyChunk[] {
  return chunks.map((chunk) => ({
    ...chunk,
    embedding: createTextEmbedding(chunk.text),
  }));
}

export function cosineSimilarity(left: number[], right: number[]) {
  if (left.length !== right.length) {
    return 0;
  }

  let sum = 0;
  for (let index = 0; index < left.length; index += 1) {
    sum += left[index] * right[index];
  }

  return sum;
}
