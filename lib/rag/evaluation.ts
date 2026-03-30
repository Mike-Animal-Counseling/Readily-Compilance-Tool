import { evaluationModelResponseSchema } from "@/lib/llm/schemas";
import { buildEvaluationPrompt } from "@/lib/llm/prompts";
import { callOpenRouterJson } from "@/lib/llm/openrouter";
import { retrieveRelevantChunks } from "@/lib/rag/retrieval";
import type { VectorizedPolicyChunk } from "@/lib/rag/vector-store";
import type {
  AuditQuestion,
  EvaluationResult,
  PolicyChunk,
  RetrievedEvidenceChunk,
} from "@/types/compliance";

const NO_ANSWER_REASON = "No evidence supported.";
const NO_ANSWER_EVIDENCE = "";

function getPositiveIntEnv(name: string, fallback: number) {
  const rawValue = process.env[name];

  if (!rawValue) {
    return fallback;
  }

  const parsedValue = Number.parseInt(rawValue, 10);
  return Number.isFinite(parsedValue) && parsedValue > 0 ? parsedValue : fallback;
}

const EVALUATION_LLM_TIMEOUT_MS = getPositiveIntEnv(
  "EVALUATION_LLM_TIMEOUT_MS",
  20000,
);
const NO_EVIDENCE_REASON_PATTERN =
  /\b(no|insufficient|missing|unclear)\b.*\bevidence\b|\bno relevant support\b/i;
const EVALUATION_MODEL =
  process.env.OPENROUTER_REVIEW_MODEL ?? process.env.OPENROUTER_MODEL;

function buildFallbackSnippet(text: string, question: string) {
  const questionTokens = question
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter(Boolean);
  const lowerText = text.toLowerCase();
  const firstMatch = questionTokens.find((token) => lowerText.includes(token));

  if (firstMatch) {
    const matchIndex = lowerText.indexOf(firstMatch);
    const start = Math.max(0, matchIndex - 80);
    const end = Math.min(text.length, matchIndex + 180);
    return text.slice(start, end).trim();
  }

  return text.slice(0, 220).trim();
}

function ensureSnippetFromChunk(snippet: string, chunk: PolicyChunk, question: string) {
  const trimmedSnippet = snippet.trim();
  if (trimmedSnippet && chunk.text.includes(trimmedSnippet)) {
    return trimmedSnippet;
  }

  return buildFallbackSnippet(chunk.text, question);
}

function shouldAttachReferenceEvidence(reason: string, citationChunkId?: string | null) {
  if (citationChunkId) {
    return true;
  }

  return !NO_EVIDENCE_REASON_PATTERN.test(reason);
}

function toRetrievedEvidenceChunks(
  retrievedChunks: PolicyChunk[],
  primaryChunkId?: string | null,
): RetrievedEvidenceChunk[] {
  return retrievedChunks.map((chunk) => ({
    chunkId: chunk.chunkId,
    fileName: chunk.fileName,
    pageNumber: chunk.pageNumber,
    sourceType: chunk.sourceType,
    text: chunk.text,
    isPrimary: chunk.chunkId === primaryChunkId,
  }));
}

function findBestSupportingChunk(
  retrievedChunks: PolicyChunk[],
  question: string,
  preferredChunkId?: string | null,
) {
  if (preferredChunkId) {
    const exactMatch = retrievedChunks.find((chunk) => chunk.chunkId === preferredChunkId);
    if (exactMatch) {
      return exactMatch;
    }
  }

  const questionTokens = question
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((token) => token.length >= 3);

  let bestChunk = retrievedChunks[0] ?? null;
  let bestScore = -1;

  for (const chunk of retrievedChunks) {
    const lowerText = chunk.text.toLowerCase();
    const overlapScore = questionTokens.reduce(
      (score, token) => score + (lowerText.includes(token) ? 1 : 0),
      0,
    );

    if (overlapScore > bestScore) {
      bestScore = overlapScore;
      bestChunk = chunk;
    }
  }

  return bestChunk;
}

export async function evaluateQuestionWithChunks({
  question,
  chunks,
}: {
  question: AuditQuestion;
  chunks: VectorizedPolicyChunk[];
}): Promise<EvaluationResult> {
  const retrievedChunks = retrieveRelevantChunks(question.text, chunks, 5);

  if (retrievedChunks.length === 0) {
    return {
      questionId: question.id,
      questionText: question.text,
      answer: "No",
      reason: NO_ANSWER_REASON,
      evidence: NO_ANSWER_EVIDENCE,
      confidence: "Low",
      evidenceChunkText: "",
      retrievedChunks: [],
      sourceFile: "",
      sourcePage: 0,
      sourceType: null,
      reviewState: "pending",
    };
  }

  const prompt = buildEvaluationPrompt({
    question: question.text,
    chunks: retrievedChunks,
  });
  const modelResponse = await callOpenRouterJson({
    responseLabel: `question evaluation for ${question.id}`,
    schema: evaluationModelResponseSchema,
    systemPrompt: prompt.systemPrompt,
    userPrompt: prompt.userPrompt,
    model: EVALUATION_MODEL,
    maxTokens: 700,
    timeoutMs: EVALUATION_LLM_TIMEOUT_MS,
  });

  if (modelResponse.answer === "No") {
    const trimmedReason = modelResponse.reason.trim() || NO_ANSWER_REASON;
    const citedChunk = shouldAttachReferenceEvidence(
      trimmedReason,
      modelResponse.citation?.chunkId ?? null,
    )
      ? findBestSupportingChunk(
          retrievedChunks,
          question.text,
          modelResponse.citation?.chunkId ?? null,
        )
      : null;
    const referenceEvidence = citedChunk
      ? ensureSnippetFromChunk(
          modelResponse.citation?.snippet ?? "",
          citedChunk,
          question.text,
        )
      : NO_ANSWER_EVIDENCE;

    return {
      questionId: question.id,
      questionText: question.text,
      answer: "No",
      reason: trimmedReason,
      evidence: referenceEvidence,
      confidence: modelResponse.confidence === "High" ? "High" : "Low",
      evidenceChunkText: citedChunk?.text ?? "",
      retrievedChunks: toRetrievedEvidenceChunks(
        retrievedChunks,
        citedChunk?.chunkId ?? null,
      ),
      sourceFile: citedChunk?.fileName ?? "",
      sourcePage: citedChunk?.pageNumber ?? 0,
      sourceType: citedChunk?.sourceType ?? null,
      reviewState: "pending",
    };
  }

  const citation = modelResponse.citation;
  const citedChunk = findBestSupportingChunk(
    retrievedChunks,
    question.text,
    citation?.chunkId ?? null,
  );

  if (!citedChunk) {
    return {
      questionId: question.id,
      questionText: question.text,
      answer: "No",
      reason: modelResponse.reason.trim() || NO_ANSWER_REASON,
      evidence: NO_ANSWER_EVIDENCE,
      confidence: "Low",
      evidenceChunkText: "",
      retrievedChunks: toRetrievedEvidenceChunks(retrievedChunks),
      sourceFile: "",
      sourcePage: 0,
      sourceType: null,
      reviewState: "pending",
    };
  }

  const evidenceSnippet = ensureSnippetFromChunk(
    citation?.snippet ?? "",
    citedChunk,
    question.text,
  );

  return {
    questionId: question.id,
    questionText: question.text,
    answer: "Yes",
    reason: modelResponse.reason.trim(),
    evidence: evidenceSnippet,
    confidence: modelResponse.confidence === "High" ? "High" : "Low",
    evidenceChunkText: citedChunk.text,
    retrievedChunks: toRetrievedEvidenceChunks(retrievedChunks, citedChunk.chunkId),
    sourceFile: citedChunk.fileName,
    sourcePage: citedChunk.pageNumber,
    sourceType: citedChunk.sourceType,
    reviewState: "pending",
  };
}
