import { guardApi } from "@/lib/security/api";
import { requestSession } from "@/lib/auth/session";
import { NextResponse } from "next/server";
import { getDataset } from "@/lib/data/dataset-store";
import { searchPreloadedPolicyChunks } from "@/lib/db/preloaded-policy-store";
import { evaluateOneRequestSchema } from "@/lib/llm/schemas";
import { evaluateQuestionWithChunks } from "@/lib/rag/evaluation";
import type { EvaluateOneResponse } from "@/types/compliance";

export const runtime = "nodejs";

async function handlePOST(request: Request) {
  try {
    const body = await request.json();
    const parsedBody = evaluateOneRequestSchema.parse(body);

    const uploadedChunks = [];

    if (parsedBody.uploadedDatasetId) {
      const dataset = await getDataset(parsedBody.uploadedDatasetId, (await requestSession(request))!.sid);
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

    const defaultLibraryChunks = parsedBody.useDefaultPolicyLibrary
      ? await searchPreloadedPolicyChunks(parsedBody.question.text, 20)
      : [];
    const combinedChunks = [...defaultLibraryChunks, ...uploadedChunks];

    if (combinedChunks.length === 0) {
      return NextResponse.json({
        result: {
          questionId: parsedBody.question.id,
          questionText: parsedBody.question.text,
          answer: "No",
          reason: "No evidence supported.",
          evidence: "",
          confidence: "Low",
          evidenceChunkText: "",
          retrievedChunks: [],
          sourceFile: "",
          sourcePage: 0,
          sourceType: null,
          reviewState: "pending",
        },
      } satisfies EvaluateOneResponse);
    }

    const result = await evaluateQuestionWithChunks({
      question: parsedBody.question,
      chunks: combinedChunks,
    });

    const response: EvaluateOneResponse = { result };
    return NextResponse.json(response);
  } catch {
    const message =
      "Request could not be completed.";

    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export const POST = guardApi(handlePOST, true);
