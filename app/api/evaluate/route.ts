import { NextResponse } from "next/server";
import { getDataset } from "@/lib/data/dataset-store";
import { searchPreloadedPolicyChunks } from "@/lib/db/preloaded-policy-store";
import { evaluateReviewRequestSchema } from "@/lib/llm/schemas";
import { evaluateQuestionWithChunks } from "@/lib/rag/evaluation";
import type { VectorizedPolicyChunk } from "@/lib/rag/vector-store";
import type { AuditQuestion, EvaluateResponse } from "@/types/compliance";

export const runtime = "nodejs";

function getPositiveIntEnv(name: string, fallback: number) {
  const rawValue = process.env[name];

  if (!rawValue) {
    return fallback;
  }

  const parsedValue = Number.parseInt(rawValue, 10);
  return Number.isFinite(parsedValue) && parsedValue > 0 ? parsedValue : fallback;
}

const EVALUATION_CONCURRENCY = getPositiveIntEnv("EVALUATION_CONCURRENCY", 3);

async function mapWithConcurrency<TInput, TOutput>(
  items: TInput[],
  concurrency: number,
  mapper: (item: TInput, index: number) => Promise<TOutput>,
) {
  const results = new Array<TOutput>(items.length);
  let nextIndex = 0;

  async function worker() {
    while (true) {
      const currentIndex = nextIndex;
      nextIndex += 1;

      if (currentIndex >= items.length) {
        return;
      }

      results[currentIndex] = await mapper(items[currentIndex], currentIndex);
    }
  }

  const workerCount = Math.min(concurrency, items.length);
  await Promise.all(Array.from({ length: workerCount }, () => worker()));
  return results;
}

function buildEvaluationErrorResult(question: AuditQuestion) {
  return {
    questionId: question.id,
    questionText: question.text,
    answer: "No" as const,
    reason: "No evidence supported.",
    evidence: "",
    confidence: "Low" as const,
    evidenceChunkText: "",
    retrievedChunks: [],
    sourceFile: "",
    sourcePage: 0,
    sourceType: null,
    reviewState: "pending" as const,
  };
}

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const parsedBody = evaluateReviewRequestSchema.parse(body);

    if (parsedBody.questions.length === 0) {
      return NextResponse.json(
        { error: "Add at least one audit question before running review." },
        { status: 400 },
      );
    }

    const uploadedChunks: VectorizedPolicyChunk[] = [];

    if (parsedBody.uploadedDatasetId) {
      const dataset = getDataset(parsedBody.uploadedDatasetId);
      if (!dataset) {
        return NextResponse.json(
          {
            error:
              "The uploaded policy dataset is no longer available. Re-parse the uploaded PDFs and try again.",
          },
          { status: 410 },
        );
      }

      const allowedDocumentIds =
        parsedBody.selectedDocumentIds.length > 0
          ? new Set(parsedBody.selectedDocumentIds)
          : new Set(dataset.documents.map((document) => document.id));

      uploadedChunks.push(
        ...dataset.chunks.filter((chunk) => allowedDocumentIds.has(chunk.documentId)),
      );
    }

    if (!parsedBody.useDefaultPolicyLibrary && uploadedChunks.length === 0) {
      return NextResponse.json(
        {
          error:
            "Enable the default policy library or select at least one uploaded policy document to review against.",
        },
        { status: 400 },
      );
    }

    const results = await mapWithConcurrency(
      parsedBody.questions,
      EVALUATION_CONCURRENCY,
      async (question) => {
        try {
          const defaultLibraryChunks = parsedBody.useDefaultPolicyLibrary
            ? await searchPreloadedPolicyChunks(question.text, 20)
            : [];
          const combinedChunks = [...defaultLibraryChunks, ...uploadedChunks];

          if (combinedChunks.length === 0) {
            return {
              questionId: question.id,
              questionText: question.text,
              answer: "No" as const,
              reason: "No evidence supported.",
              evidence: "",
              confidence: "Low" as const,
              evidenceChunkText: "",
              retrievedChunks: [],
              sourceFile: "",
              sourcePage: 0,
              sourceType: null,
              reviewState: "pending" as const,
            };
          }

          return await evaluateQuestionWithChunks({
            question,
            chunks: combinedChunks,
          });
        } catch (error) {
          console.error("[evaluate] question failed", {
            questionId: question.id,
            message:
              error instanceof Error ? error.message : "Unknown evaluation error",
          });

          return buildEvaluationErrorResult(question);
        }
      },
    );

    const response: EvaluateResponse = { results };
    return NextResponse.json(response);
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Failed to evaluate compliance questions.";

    console.error("[evaluate] failed", {
      message,
    });

    return NextResponse.json({ error: message }, { status: 500 });
  }
}
