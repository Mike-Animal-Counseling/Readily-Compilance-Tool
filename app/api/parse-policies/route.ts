import { NextResponse } from "next/server";
import { createDataset } from "@/lib/data/dataset-store";
import { extractPdfPages } from "@/lib/pdf/extract-pages";
import { chunkPolicyDocument } from "@/lib/rag/chunking";
import type {
  ParsePoliciesResponse,
  PolicyChunk,
  PolicyDocument,
  PolicyDocumentRecord,
} from "@/types/compliance";

export const runtime = "nodejs";

export async function POST(request: Request) {
  try {
    const formData = await request.formData();
    const uploadedFiles = formData
      .getAll("policies")
      .filter((value): value is File => value instanceof File);

    if (uploadedFiles.length === 0) {
      return NextResponse.json(
        { error: "Upload at least one policy PDF." },
        { status: 400 },
      );
    }

    const documents: PolicyDocumentRecord[] = [];
    const chunks: PolicyChunk[] = [];

    for (const policyFile of uploadedFiles) {
      const pages = await extractPdfPages(policyFile);

      if (pages.every((page) => page.text.trim().length === 0)) {
        continue;
      }

      const documentId = globalThis.crypto.randomUUID();
      const documentChunks = chunkPolicyDocument({
        documentId,
        fileName: policyFile.name,
        pages,
        sourceType: "uploaded",
      });

      documents.push({
        id: documentId,
        fileName: policyFile.name,
        pages,
        chunkIds: documentChunks.map((chunk) => chunk.chunkId),
        sourceType: "uploaded",
      });
      chunks.push(...documentChunks);
    }

    if (documents.length === 0) {
      return NextResponse.json(
        {
          error:
            "No extractable text was found in the uploaded policy PDFs. This MVP does not support OCR-only scans.",
        },
        { status: 422 },
      );
    }

    const datasetId = createDataset({
      documents,
      chunks,
    });

    const response: ParsePoliciesResponse = {
      datasetId,
      documents: documents.map<PolicyDocument>((document) => ({
        id: document.id,
        fileName: document.fileName,
        pageCount: document.pages.length,
        chunkCount: document.chunkIds.length,
        sourceType: document.sourceType,
      })),
    };

    return NextResponse.json(response);
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Failed to parse policy PDFs.";

    return NextResponse.json({ error: message }, { status: 500 });
  }
}
