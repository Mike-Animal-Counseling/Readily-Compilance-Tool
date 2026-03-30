import { createTextEmbedding } from "@/lib/rag/embeddings";
import { cosineSimilarity, type VectorizedPolicyChunk } from "@/lib/rag/vector-store";

const stopWords = new Set([
  "a",
  "an",
  "and",
  "are",
  "as",
  "at",
  "be",
  "by",
  "for",
  "from",
  "in",
  "is",
  "it",
  "of",
  "on",
  "or",
  "that",
  "the",
  "to",
  "with",
  "your",
]);

function tokenize(text: string) {
  return text
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .map((token) => token.trim())
    .filter((token) => token && !stopWords.has(token));
}

function unique<T>(values: T[]) {
  return Array.from(new Set(values));
}

function getPositiveNumberEnv(name: string, fallback: number) {
  const rawValue = process.env[name];

  if (!rawValue) {
    return fallback;
  }

  const parsedValue = Number.parseFloat(rawValue);
  return Number.isFinite(parsedValue) && parsedValue >= 0 ? parsedValue : fallback;
}

const RETRIEVAL_VECTOR_WEIGHT = getPositiveNumberEnv("RETRIEVAL_VECTOR_WEIGHT", 3);

function scoreChunk(
  question: string,
  queryEmbedding: number[],
  chunk: VectorizedPolicyChunk,
) {
  const questionTokens = unique(tokenize(question));
  const chunkTokens = new Set(tokenize(chunk.text));
  const questionNumbers = question.match(/\d+(?:\.\d+)?/g) ?? [];
  const lowerChunkText = chunk.text.toLowerCase();
  const lowerQuestion = question.toLowerCase().trim();

  const overlapScore = questionTokens.reduce(
    (score, token) => score + (chunkTokens.has(token) ? 2 : 0),
    0,
  );

  const exactPhraseScore =
    lowerQuestion.length > 15 && lowerChunkText.includes(lowerQuestion) ? 10 : 0;
  const numberScore = questionNumbers.reduce(
    (score, value) => score + (lowerChunkText.includes(value) ? 3 : 0),
    0,
  );
  const headingBoost = /policy|procedure|requirement|must|shall/i.test(chunk.text)
    ? 1
    : 0;
  const vectorScore =
    chunk.embedding.length > 0
      ? cosineSimilarity(queryEmbedding, chunk.embedding) * RETRIEVAL_VECTOR_WEIGHT
      : 0;

  return overlapScore + exactPhraseScore + numberScore + headingBoost + vectorScore;
}

export function retrieveRelevantChunks(
  question: string,
  chunks: VectorizedPolicyChunk[],
  topK = 5,
) {
  const queryEmbedding = createTextEmbedding(question);
  const rankedChunks = chunks
    .map((chunk) => ({
      chunk,
      score: scoreChunk(question, queryEmbedding, chunk),
    }))
    .sort((left, right) => right.score - left.score);

  const positiveMatches = rankedChunks.filter((item) => item.score > 0);
  const fallbackPool = positiveMatches.length > 0 ? positiveMatches : rankedChunks;

  return fallbackPool.slice(0, topK).map((item) => item.chunk);
}
