import { buildAuditExtractionListPrompt } from "@/lib/llm/prompts";
import {
  completeExtractAuditJob,
  createExtractAuditJob,
  failExtractAuditJob,
  getExtractAuditJob,
  startExtractAuditJob,
  updateExtractAuditJob,
} from "@/lib/jobs/extract-audit-jobs";
import { callOpenRouterText } from "@/lib/llm/openrouter";
import { extractPdfPages } from "@/lib/pdf/extract-pages";
import type {
  AuditQuestion,
  ExtractAuditResponse,
  PdfPage,
} from "@/types/compliance";

export const runtime = "nodejs";

function getPositiveIntEnv(name: string, fallback: number) {
  const rawValue = process.env[name];

  if (!rawValue) {
    return fallback;
  }

  const parsedValue = Number.parseInt(rawValue, 10);
  return Number.isFinite(parsedValue) && parsedValue > 0 ? parsedValue : fallback;
}

const AUDIT_EXTRACTION_BATCH_SIZE = getPositiveIntEnv(
  "AUDIT_EXTRACTION_BATCH_SIZE",
  3,
);
const AUDIT_EXTRACTION_MAX_TOKENS = getPositiveIntEnv(
  "AUDIT_EXTRACTION_MAX_TOKENS",
  1200,
);
const AUDIT_EXTRACTION_TIMEOUT_MS = getPositiveIntEnv(
  "AUDIT_EXTRACTION_TIMEOUT_MS",
  10000,
);
const AUDIT_EXTRACTION_MODEL =
  process.env.OPENROUTER_EXTRACT_MODEL ?? process.env.OPENROUTER_MODEL;

function parseQuestionsFromQuestionLines(rawText: string) {
  const extractedQuestions = rawText
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => /^question:\s+/i.test(line))
    .map((line) => line.replace(/^question:\s+/i, "").trim())
    .filter((line) => line.length >= 12);

  return Array.from(new Set(extractedQuestions)).slice(0, 100);
}

function extractQuestionsHeuristicallyFromPages(pages: Array<{ text: string }>) {
  const rawLines = pages
    .flatMap((page) => page.text.split(/\r?\n/))
    .map((line) => line.replace(/\s+/g, " ").trim())
    .filter(Boolean);

  const normalizedQuestions = rawLines
    .map((line) =>
      line
        .replace(/^[-*•]\s*/, "")
        .replace(/^\(?\d+[.)\-:]\s*/, "")
        .replace(/^[A-Z]\.\s*/, "")
        .replace(/^question\s*\d+[\).:-]?\s*/i, "")
        .trim(),
    )
    .filter((line) => line.length >= 12)
    .filter(
      (line) =>
        /\?$/.test(line) ||
        /^(does|do|is|are|was|were|has|have|can|should|must|shall|confirm|verify|document|provide|describe|explain|ensure|review|identify|maintain|demonstrate)\b/i.test(
          line,
        ) ||
        /\b(policy|procedure|process|evidence|documentation|required|requirement|compliance|audit)\b/i.test(
          line,
        ),
    )
    .map((line) => line.replace(/\s{2,}/g, " ").trim());

  return Array.from(new Set(normalizedQuestions)).slice(0, 50);
}

function chunkPages<T>(items: T[], size: number) {
  const chunks: T[][] = [];

  for (let index = 0; index < items.length; index += size) {
    chunks.push(items.slice(index, index + size));
  }

  return chunks;
}

function normalizeQuestionText(text: string) {
  return text
    .replace(/\s+/g, " ")
    .replace(/^question\s*[:\-]?\s*/i, "")
    .replace(/^\d+[\).:-]?\s*/, "")
    .trim();
}

function dedupeQuestions(questions: string[]) {
  const seen = new Set<string>();
  const deduped: string[] = [];

  for (const question of questions) {
    const normalized = normalizeQuestionText(question);
    const fingerprint = normalized.toLowerCase();

    if (!normalized || seen.has(fingerprint)) {
      continue;
    }

    seen.add(fingerprint);
    deduped.push(normalized);
  }

  return deduped;
}

async function extractQuestionsFromBatch(
  pages: PdfPage[],
  auditFileName: string,
): Promise<{
  questions: string[];
  extractionMethod: "llm" | "heuristic";
}> {
  const listPrompt = buildAuditExtractionListPrompt({
    fileName: auditFileName,
    pages,
  });

  try {
    const textResult = await callOpenRouterText({
      responseLabel: `audit question extraction pages ${pages[0]?.pageNumber ?? 1}-${pages.at(-1)?.pageNumber ?? pages.length}`,
      systemPrompt: listPrompt.systemPrompt,
      userPrompt: listPrompt.userPrompt,
      model: AUDIT_EXTRACTION_MODEL,
      maxTokens: AUDIT_EXTRACTION_MAX_TOKENS,
      timeoutMs: AUDIT_EXTRACTION_TIMEOUT_MS,
    });

    const llmQuestions = parseQuestionsFromQuestionLines(textResult);

    if (llmQuestions.length === 0) {
      throw new Error("Audit extraction returned an empty question list.");
    }

    return {
      questions: llmQuestions,
      extractionMethod: "llm",
    };
  } catch (error) {
    console.warn("[extract-audit] using heuristic fallback for batch", {
      pageStart: pages[0]?.pageNumber ?? 1,
      pageEnd: pages.at(-1)?.pageNumber ?? pages.length,
      message: error instanceof Error ? error.message : "Unknown extraction error",
    });

    return {
      questions: extractQuestionsHeuristicallyFromPages(pages),
      extractionMethod: "heuristic",
    };
  }
}

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const jobId = searchParams.get("jobId");

  if (!jobId) {
    return Response.json(
      { error: "Provide a jobId to read extract progress." },
      {
        status: 400,
        headers: {
          "Cache-Control": "no-store",
        },
      },
    );
  }

  const job = getExtractAuditJob(jobId);

  if (!job) {
    return Response.json(
      { error: "Audit extraction job not found." },
      {
        status: 404,
        headers: {
          "Cache-Control": "no-store",
        },
      },
    );
  }

  return Response.json(job, {
    headers: {
      "Cache-Control": "no-store",
    },
  });
}

async function runExtractAuditJob(jobId: string, auditFile: File) {
  startExtractAuditJob(jobId);

  try {
    updateExtractAuditJob(jobId, {
      stage: "starting",
      message: "Preparing audit extraction job.",
      completedBatches: 0,
      totalBatches: 0,
    });

    updateExtractAuditJob(jobId, {
      stage: "reading_pdf",
      message: "Reading and parsing the audit PDF.",
      completedBatches: 0,
      totalBatches: 0,
    });

    const pages = await extractPdfPages(auditFile);
    const combinedText = pages
      .map((page) => `[Page ${page.pageNumber}]\n${page.text}`)
      .join("\n\n")
      .trim();

    if (combinedText.length < 40) {
      failExtractAuditJob(
        jobId,
        "The audit PDF did not contain enough extractable text. This MVP does not support OCR-only scans.",
      );
      return;
    }

    const pageBatches = chunkPages(pages, AUDIT_EXTRACTION_BATCH_SIZE);

    updateExtractAuditJob(jobId, {
      stage: "preparing_batches",
      message: `Prepared ${pageBatches.length} extraction batches.`,
      completedBatches: 0,
      totalBatches: pageBatches.length,
    });

    const batchResults = [];

    for (const [index, pageBatch] of pageBatches.entries()) {
      updateExtractAuditJob(jobId, {
        stage: "extracting_batch",
        message: `Extracting questions from batch ${index + 1} of ${pageBatches.length}.`,
        completedBatches: index,
        totalBatches: pageBatches.length,
      });

      batchResults.push(await extractQuestionsFromBatch(pageBatch, auditFile.name));

      updateExtractAuditJob(jobId, {
        stage: "extracting_batch",
        message: `Completed batch ${index + 1} of ${pageBatches.length}.`,
        completedBatches: index + 1,
        totalBatches: pageBatches.length,
      });
    }

    updateExtractAuditJob(jobId, {
      stage: "deduping",
      message: "Deduplicating extracted questions.",
      completedBatches: pageBatches.length,
      totalBatches: pageBatches.length,
    });

    const questions = dedupeQuestions(
      batchResults.flatMap((result) => result.questions),
    ).map((text, index) => ({
      id: globalThis.crypto.randomUUID(),
      order: index + 1,
      text,
    })) satisfies AuditQuestion[];

    if (questions.length === 0) {
      failExtractAuditJob(
        jobId,
        "Could not extract audit questions from this PDF. Try a clearer text-based audit questionnaire or switch to a more reliable LLM model.",
      );
      return;
    }

    const llmBatchCount = batchResults.filter(
      (result) => result.extractionMethod === "llm",
    ).length;
    const heuristicBatchCount = batchResults.length - llmBatchCount;
    const extractionMethod: ExtractAuditResponse["extractionMethod"] =
      llmBatchCount > 0 && heuristicBatchCount > 0
        ? "mixed"
        : llmBatchCount > 0
          ? "llm"
          : "heuristic";

    completeExtractAuditJob(jobId, {
      auditFileName: auditFile.name,
      pageCount: pages.length,
      questions,
      extractionMethod,
    });
  } catch (error) {
    failExtractAuditJob(
      jobId,
      error instanceof Error ? error.message : "Failed to extract audit questions.",
    );
  }
}

export async function POST(request: Request) {
  const formData = await request.formData();
  const auditFile = formData.get("audit");

  if (!(auditFile instanceof File)) {
    return Response.json(
      { error: "Upload one audit PDF to extract questions." },
      {
        status: 400,
        headers: {
          "Cache-Control": "no-store",
        },
      },
    );
  }

  const { jobId } = createExtractAuditJob();

  void runExtractAuditJob(jobId, auditFile);

  return Response.json(
    { jobId },
    {
      headers: {
        "Cache-Control": "no-store",
      },
    },
  );
}
