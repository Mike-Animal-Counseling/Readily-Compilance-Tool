"use client";

import { useEffect, useMemo, useState } from "react";
import { ResultCard } from "@/components/result-card";
import { StepCard } from "@/components/step-card";
import type {
  AuditQuestion,
  ExtractAuditJobStartResponse,
  ExtractAuditJobStatusResponse,
  EvaluateOneResponse,
  EvaluationResult,
  ExtractAuditResponse,
  ParsePoliciesResponse,
  PolicyDocument,
  PolicyLibraryResponse,
  ReviewState,
} from "@/types/compliance";

type LoadingState = {
  extracting: boolean;
  parsingPolicies: boolean;
  evaluating: boolean;
  rerunningQuestionId: string | null;
};

type DefaultLibraryStatus = "loading" | "ready" | "empty" | "error";

type ExtractProgressState = {
  stage: string | null;
  message: string | null;
  completedBatches: number;
  totalBatches: number;
};

type ReviewProgressState = {
  completedQuestions: number;
  totalQuestions: number;
};

const initialLoadingState: LoadingState = {
  extracting: false,
  parsingPolicies: false,
  evaluating: false,
  rerunningQuestionId: null,
};

const workflowSteps = [
  {
    step: "01",
    title: "Upload audit source",
    description: "Bring in the audit PDF and start question extraction.",
    href: "#milestone-1",
    tone: "primary" as const,
  },
  {
    step: "02",
    title: "Validate extracted questions",
    description: "Clean the review results before judgment is made.",
    href: "#milestone-2",
    tone: "default" as const,
  },
  {
    step: "03",
    title: "Confirm policy coverage",
    description: "Use the default library and optional uploaded policies together.",
    href: "#milestone-3",
    tone: "default" as const,
  },
  {
    step: "04",
    title: "Run grounded review",
    description: "Evaluate each question against retrieved policy evidence.",
    href: "#milestone-4",
    tone: "default" as const,
  },
  {
    step: "05",
    title: "Review and export",
    description: "Approve, adjust, and export a traceable audit output.",
    href: "#milestone-5",
    tone: "outcome" as const,
  },
] as const;

const REVIEW_REQUEST_TIMEOUT_MS = 30000;

function formatBytes(bytes: number) {
  if (bytes < 1024 * 1024) {
    return `${(bytes / 1024).toFixed(0)} KB`;
  }

  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function escapeCsvValue(value: string | number) {
  const text = String(value ?? "");
  return `"${text.replace(/"/g, '""')}"`;
}

function progressPercent(completed: number, total: number) {
  if (total <= 0) {
    return 0;
  }

  return Math.max(0, Math.min(100, Math.round((completed / total) * 100)));
}

async function mapWithConcurrency<T>(
  items: T[],
  concurrency: number,
  worker: (item: T, index: number) => Promise<void>,
) {
  let nextIndex = 0;

  async function runWorker() {
    while (true) {
      const currentIndex = nextIndex;
      nextIndex += 1;

      if (currentIndex >= items.length) {
        return;
      }

      await worker(items[currentIndex], currentIndex);
    }
  }

  const workerCount = Math.min(concurrency, items.length);
  await Promise.all(Array.from({ length: workerCount }, () => runWorker()));
}

export function ComplianceReviewApp() {
  const [auditFile, setAuditFile] = useState<File | null>(null);
  const [questions, setQuestions] = useState<AuditQuestion[]>([]);
  const [auditExtractionMethod, setAuditExtractionMethod] = useState<
    ExtractAuditResponse["extractionMethod"] | null
  >(null);
  const [policyFiles, setPolicyFiles] = useState<File[]>([]);
  const [uploadedDatasetId, setUploadedDatasetId] = useState<string | null>(null);
  const [uploadedPolicyDocuments, setUploadedPolicyDocuments] = useState<PolicyDocument[]>([]);
  const [selectedDocumentIds, setSelectedDocumentIds] = useState<string[]>([]);
  const [defaultPolicyDocuments, setDefaultPolicyDocuments] = useState<PolicyDocument[]>([]);
  const [useDefaultPolicyLibrary, setUseDefaultPolicyLibrary] = useState(true);
  const [defaultLibraryStatus, setDefaultLibraryStatus] =
    useState<DefaultLibraryStatus>("loading");
  const [results, setResults] = useState<EvaluationResult[]>([]);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [loadingState, setLoadingState] = useState<LoadingState>(initialLoadingState);
  const [extractProgress, setExtractProgress] = useState<ExtractProgressState>({
    stage: null,
    message: null,
    completedBatches: 0,
    totalBatches: 0,
  });
  const [reviewProgress, setReviewProgress] = useState<ReviewProgressState>({
    completedQuestions: 0,
    totalQuestions: 0,
  });
  const [showDefaultLibraryDocuments, setShowDefaultLibraryDocuments] = useState(false);
  const [expandedQuestionIds, setExpandedQuestionIds] = useState<string[]>([]);

  const resultsByQuestionId = useMemo(
    () => new Map(results.map((result) => [result.questionId, result])),
    [results],
  );

  const selectedPolicyCount = selectedDocumentIds.length;
  const isQuestionsReady = questions.length > 0;
  const totalDefaultChunks = defaultPolicyDocuments.reduce(
    (sum, document) => sum + document.chunkCount,
    0,
  );
  const totalUploadedChunks = uploadedPolicyDocuments.reduce(
    (sum, document) => sum + document.chunkCount,
    0,
  );
  const totalPolicyChunks = totalDefaultChunks + totalUploadedChunks;
  const isPoliciesParsed =
    defaultPolicyDocuments.length > 0 || uploadedPolicyDocuments.length > 0;
  const canRunReview =
    isQuestionsReady &&
    ((useDefaultPolicyLibrary && defaultPolicyDocuments.length > 0) ||
      selectedDocumentIds.length > 0);
  const defaultLibraryDetailLabel =
    defaultLibraryStatus === "ready"
      ? "Preloaded"
      : defaultLibraryStatus === "empty"
        ? "No policies"
        : defaultLibraryStatus === "error"
        ? "Unavailable"
          : "Loading";
  const extractingStatusMessage = loadingState.extracting
    ? extractProgress.message ??
      "Extracting questions with the LLM. If the model stalls or returns an unstable format, the app will fall back to local extraction automatically."
    : auditExtractionMethod === "llm"
      ? "Questions were extracted with the LLM."
      : auditExtractionMethod === "mixed"
        ? "Questions were extracted with a mix of LLM and local fallback extraction."
      : auditExtractionMethod === "heuristic"
        ? "Questions were recovered with local fallback extraction."
        : null;
  const extractProgressValue = progressPercent(
    extractProgress.completedBatches,
    extractProgress.totalBatches,
  );
  const reviewProgressValue = progressPercent(
    reviewProgress.completedQuestions,
    reviewProgress.totalQuestions,
  );
  const libraryPreviewDocuments = defaultPolicyDocuments.slice(0, 4);

  useEffect(() => {
    async function loadPolicyLibrary() {
      try {
        const response = await fetch("/api/policy-library");
        const payload = await readJsonResponse<PolicyLibraryResponse>(response);
        setDefaultPolicyDocuments(payload.documents);
        setDefaultLibraryStatus(payload.preloaded ? "ready" : "empty");
        if (!payload.enabled) {
          setUseDefaultPolicyLibrary(false);
        }
      } catch (error) {
        setDefaultLibraryStatus("error");
        setErrorMessage(
          error instanceof Error
            ? error.message
            : "Failed to load the default policy library.",
        );
      }
    }

    void loadPolicyLibrary();
  }, []);

  useEffect(() => {
    setExpandedQuestionIds((current) =>
      current.filter((questionId) =>
        questions.some((question) => question.id === questionId),
      ),
    );
  }, [questions]);

  async function readJsonResponse<T>(response: Response): Promise<T> {
    const payload = (await response.json()) as T & { error?: string };

    if (!response.ok) {
      throw new Error(payload.error ?? "Request failed.");
    }

    return payload;
  }

  async function fetchJsonWithTimeout<T>(
    input: RequestInfo | URL,
    init: RequestInit,
    timeoutMs = REVIEW_REQUEST_TIMEOUT_MS,
    timeoutMessage = "Question evaluation timed out.",
  ): Promise<T> {
    const controller = new AbortController();
    const timeoutId = window.setTimeout(() => controller.abort(), timeoutMs);

    try {
      const response = await fetch(input, {
        ...init,
        signal: controller.signal,
      });

      return await readJsonResponse<T>(response);
    } catch (error) {
      if (error instanceof DOMException && error.name === "AbortError") {
        throw new Error(timeoutMessage);
      }

      throw error;
    } finally {
      window.clearTimeout(timeoutId);
    }
  }

  async function handleExtractQuestions() {
    if (!auditFile) {
      setErrorMessage("Upload an audit PDF first.");
      return;
    }

    setErrorMessage(null);
    setResults([]);
    setAuditExtractionMethod(null);
    setExtractProgress({
      stage: "starting",
      message: "Preparing audit extraction job.",
      completedBatches: 0,
      totalBatches: 0,
    });
    setLoadingState((current) => ({ ...current, extracting: true }));

    try {
      const formData = new FormData();
      formData.append("audit", auditFile);

      const startPayload = await fetchJsonWithTimeout<ExtractAuditJobStartResponse>(
        "/api/extract-audit",
        {
          method: "POST",
          body: formData,
        },
        60000,
        "Audit extraction setup timed out.",
      );

      let completedPayload: ExtractAuditResponse | null = null;

      while (!completedPayload) {
        const statusPayload = await fetchJsonWithTimeout<ExtractAuditJobStatusResponse>(
          `/api/extract-audit?jobId=${encodeURIComponent(startPayload.jobId)}`,
          {
            method: "GET",
          },
          15000,
          "Audit extraction status check timed out.",
        );

        setExtractProgress({
          stage: statusPayload.stage,
          message: statusPayload.message,
          completedBatches: statusPayload.completedBatches,
          totalBatches: statusPayload.totalBatches,
        });

        if (statusPayload.status === "failed") {
          throw new Error(statusPayload.error ?? "Failed to extract questions.");
        }

        if (statusPayload.status === "completed") {
          if (!statusPayload.payload) {
            throw new Error("Audit extraction completed without returning questions.");
          }

          completedPayload = statusPayload.payload;
          break;
        }

        await new Promise((resolve) => window.setTimeout(resolve, 1000));
      }

      setQuestions(completedPayload.questions);
      setAuditExtractionMethod(completedPayload.extractionMethod);
      setExtractProgress((current) => ({
        ...current,
        stage: "complete",
        message: `Extracted ${completedPayload.questions.length} questions.`,
        completedBatches:
          current.totalBatches > 0 ? current.totalBatches : current.completedBatches,
      }));
    } catch (error) {
      setExtractProgress((current) => ({
        ...current,
        message:
          error instanceof Error ? error.message : "Failed to extract questions.",
      }));
      setErrorMessage(
        error instanceof Error ? error.message : "Failed to extract questions.",
      );
    } finally {
      setLoadingState((current) => ({ ...current, extracting: false }));
    }
  }

  async function handleParsePolicies() {
    if (policyFiles.length === 0) {
      setErrorMessage("Upload one or more policy PDFs first.");
      return;
    }

    setErrorMessage(null);
    setResults([]);
    setLoadingState((current) => ({ ...current, parsingPolicies: true }));

    try {
      const formData = new FormData();
      for (const file of policyFiles) {
        formData.append("policies", file);
      }

      const response = await fetch("/api/parse-policies", {
        method: "POST",
        body: formData,
      });

      const payload = await readJsonResponse<ParsePoliciesResponse>(response);
      setUploadedDatasetId(payload.datasetId);
      setUploadedPolicyDocuments(payload.documents);
      setSelectedDocumentIds(payload.documents.map((document) => document.id));
    } catch (error) {
      setErrorMessage(
        error instanceof Error ? error.message : "Failed to parse policy PDFs.",
      );
    } finally {
      setLoadingState((current) => ({ ...current, parsingPolicies: false }));
    }
  }

  async function handleRunReview() {
    if (!canRunReview) {
      setErrorMessage("Complete the earlier steps before running review.");
      return;
    }

    setErrorMessage(null);
    setResults([]);
    setReviewProgress({
      completedQuestions: 0,
      totalQuestions: questions.length,
    });
    setLoadingState((current) => ({ ...current, evaluating: true }));

    try {
      await mapWithConcurrency(questions, 3, async (question) => {
        try {
          const payload = await fetchJsonWithTimeout<EvaluateOneResponse>(
            "/api/evaluate-one",
            {
              method: "POST",
              headers: {
                "Content-Type": "application/json",
              },
              body: JSON.stringify({
                uploadedDatasetId,
                useDefaultPolicyLibrary,
                question,
                selectedDocumentIds,
              }),
            },
          );

          setResults((current) => {
            const existing = current.find(
              (result) => result.questionId === question.id,
            );
            const nextResult = {
              ...payload.result,
              reviewState: existing?.reviewState ?? payload.result.reviewState,
            };

            return current.some((result) => result.questionId === question.id)
              ? current.map((result) =>
                  result.questionId === question.id ? nextResult : result,
                )
              : [...current, nextResult];
          });
        } catch {
          setResults((current) => {
            const fallbackResult: EvaluationResult = {
              questionId: question.id,
              questionText: question.text,
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
            };

            return current.some((result) => result.questionId === question.id)
              ? current.map((result) =>
                  result.questionId === question.id ? fallbackResult : result,
                )
              : [...current, fallbackResult];
          });
        } finally {
          setReviewProgress((current) => ({
            ...current,
            completedQuestions: current.completedQuestions + 1,
          }));
        }
      });
    } catch (error) {
      setErrorMessage(
        error instanceof Error ? error.message : "Failed to run the review.",
      );
    } finally {
      setLoadingState((current) => ({ ...current, evaluating: false }));
    }
  }

  async function handleRerunQuestion(questionId: string) {
    const question = questions.find((candidate) => candidate.id === questionId);
    if (!question) {
      return;
    }

    setErrorMessage(null);
    setLoadingState((current) => ({
      ...current,
      rerunningQuestionId: questionId,
    }));

    try {
      const payload = await fetchJsonWithTimeout<EvaluateOneResponse>(
        "/api/evaluate-one",
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            uploadedDatasetId,
            useDefaultPolicyLibrary,
            question,
            selectedDocumentIds,
          }),
        },
      );

      setResults((current) => {
        const existing = current.find((result) => result.questionId === questionId);
        const nextResult = {
          ...payload.result,
          reviewState: existing?.reviewState ?? payload.result.reviewState,
        };

        return current.some((result) => result.questionId === questionId)
          ? current.map((result) =>
              result.questionId === questionId ? nextResult : result,
            )
          : [...current, nextResult];
      });
    } catch (error) {
      setErrorMessage(
        error instanceof Error ? error.message : "Failed to re-run the question.",
      );
    } finally {
      setLoadingState((current) => ({
        ...current,
        rerunningQuestionId: null,
      }));
    }
  }

  function updateQuestionText(questionId: string, nextText: string) {
    setQuestions((current) =>
      current.map((question) =>
        question.id === questionId ? { ...question, text: nextText } : question,
      ),
    );
    setResults((current) =>
      current.map((result) =>
        result.questionId === questionId
          ? { ...result, questionText: nextText }
          : result,
      ),
    );
  }

  function updateReviewState(questionId: string, reviewState: ReviewState) {
    setResults((current) =>
      current.map((result) =>
        result.questionId === questionId ? { ...result, reviewState } : result,
      ),
    );
  }

  function addQuestion() {
    const nextQuestion = {
      id: globalThis.crypto.randomUUID(),
      order: questions.length + 1,
      text: "",
    };
    setQuestions((current) => [...current, nextQuestion]);
    setExpandedQuestionIds((current) => [...current, nextQuestion.id]);
  }

  function removeQuestion(questionId: string) {
    setQuestions((current) =>
      current
        .filter((question) => question.id !== questionId)
        .map((question, index) => ({ ...question, order: index + 1 })),
    );
    setResults((current) =>
      current.filter((result) => result.questionId !== questionId),
    );
    setExpandedQuestionIds((current) =>
      current.filter((candidateId) => candidateId !== questionId),
    );
  }

  function toggleDocumentSelection(documentId: string) {
    setSelectedDocumentIds((current) =>
      current.includes(documentId)
        ? current.filter((id) => id !== documentId)
        : [...current, documentId],
    );
  }

  function toggleQuestionExpanded(questionId: string) {
    setExpandedQuestionIds((current) =>
      current.includes(questionId) ? [] : [questionId],
    );
  }

  function exportResultsToCsv() {
    if (results.length === 0) {
      return;
    }

    const rows = [
      [
        "Question Order",
        "Question",
        "Answer",
        "Confidence",
        "Review State",
        "Reason",
        "Evidence",
        "Source File",
        "Source Page",
        "Source Type",
      ],
      ...questions
        .filter((question) => resultsByQuestionId.has(question.id))
        .map((question) => {
          const result = resultsByQuestionId.get(question.id)!;
          return [
            question.order,
            question.text,
            result.answer,
            result.confidence,
            result.reviewState,
            result.reason,
            result.evidence,
            result.sourceFile,
            result.sourcePage,
            result.sourceType ?? "",
          ];
        }),
    ];

    const csv = rows
      .map((row) => row.map((value) => escapeCsvValue(value)).join(","))
      .join("\n");

    const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = "compliance-review-results.csv";
    link.click();
    URL.revokeObjectURL(url);
  }

  return (
    <main className="mx-auto min-h-screen max-w-7xl px-4 py-8 sm:px-6 lg:px-8">
      <div className="rounded-[40px] border border-border/70 bg-[#f5f6f4] p-4 shadow-[var(--shadow)] sm:p-6">
        <div className="grid gap-5 xl:grid-cols-[0.96fr_1.04fr]">
          <section className="rounded-[30px] bg-[#14313d] p-6 text-white shadow-[0_20px_50px_rgba(9,23,31,0.18)] sm:p-7">
            <div className="flex flex-wrap items-center gap-2 text-xs font-semibold uppercase tracking-[0.22em] text-teal-200">
              <span>Readily Compliance Review</span>
              <span className="rounded-full border border-white/15 bg-white/8 px-3 py-1 text-[11px] tracking-[0.18em] text-slate-100">
                Audit-ready workspace
              </span>
            </div>
            <h1 className="mt-4 max-w-xl text-[2.45rem] font-semibold leading-[1.06] tracking-[-0.04em] text-white sm:text-[2.9rem]">
              Secure, traceable audit review for healthcare compliance teams
            </h1>
            <p className="mt-4 max-w-xl text-[15px] leading-7 text-slate-200">
              Move from source audit PDF to grounded Yes/No decisions with
              server-side policy retrieval, page-level traceability, and a review
              workflow built for internal compliance teams.
            </p>
            <div className="mt-7 grid gap-3 md:grid-cols-3">
              <div className="rounded-[22px] border border-white/10 bg-white/[0.07] p-4">
                <p className="text-sm font-semibold text-white">Traceable evidence</p>
                <p className="mt-2 text-sm leading-6 text-slate-200">
                  Every judgment maps back to source file, page, and retrieved
                  policy text.
                </p>
              </div>
              <div className="rounded-[22px] border border-white/10 bg-white/[0.07] p-4">
                <p className="text-sm font-semibold text-white">Controlled context</p>
                <p className="mt-2 text-sm leading-6 text-slate-200">
                  Only retrieved policy chunks enter model evaluation, keeping the
                  review grounded.
                </p>
              </div>
              <div className="rounded-[22px] border border-white/10 bg-white/[0.07] p-4">
                <p className="text-sm font-semibold text-white">Operational review</p>
                <p className="mt-2 text-sm leading-6 text-slate-200">
                  Analysts can edit questions, re-run single answers, and export a
                  clean audit package.
                </p>
              </div>
            </div>
          </section>

          <section className="rounded-[30px] border border-border bg-white p-6 shadow-[0_12px_30px_rgba(15,23,42,0.06)] sm:p-7">
            <div className="flex flex-col gap-4 border-b border-border/80 pb-5">
              <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
                <div className="max-w-xl">
                  <div className="flex items-center gap-2">
                    <p className="text-xs font-semibold uppercase tracking-[0.22em] text-accent">
                      Workflow
                    </p>
                    <span className="rounded-full bg-emerald-50 px-2.5 py-1 text-[11px] font-semibold uppercase tracking-[0.18em] text-emerald-700">
                      System ready
                    </span>
                  </div>
                  <h2 className="mt-3 text-[1.85rem] font-semibold tracking-[-0.03em] text-foreground">
                    Guided audit execution
                  </h2>
                  <p className="mt-2 max-w-lg text-sm leading-6 text-muted">
                    Start with the source audit, confirm the policy set, then move
                    into a grounded review flow that stays traceable for internal
                    audit teams.
                  </p>
                </div>
                <div className="rounded-[18px] border border-border bg-[#f9faf8] px-4 py-3 text-sm text-muted">
                  <p className="text-xs font-semibold uppercase tracking-[0.18em] text-muted">
                    Workflow state
                  </p>
                  <p className="mt-2 font-medium text-foreground">
                    {defaultPolicyDocuments.length > 0
                      ? "Default library connected"
                      : "Awaiting policy coverage"}
                  </p>
                  <p className="mt-1 text-sm text-muted">
                    {defaultLibraryDetailLabel} · {totalDefaultChunks} indexed chunks
                  </p>
                </div>
              </div>
            </div>

            <ol className="mt-6 grid gap-3 sm:grid-cols-2">
              {workflowSteps.map((step) => {
                const itemClasses =
                  step.tone === "primary"
                    ? "border-accent/30 bg-[#f4faf8] shadow-[0_8px_24px_rgba(20,49,61,0.05)]"
                    : step.tone === "outcome"
                      ? "border-emerald-200 bg-emerald-50/70"
                      : "border-border bg-[#fbfcfa]";

                const numberClasses =
                  step.tone === "primary"
                    ? "bg-accent text-white"
                    : step.tone === "outcome"
                      ? "bg-emerald-600 text-white"
                      : "bg-white text-foreground";

                return (
                  <li
                    className={step.tone === "outcome" ? "sm:col-span-2" : ""}
                    key={step.step}
                  >
                    <a
                      className={`relative flex items-start gap-4 rounded-[22px] border px-4 py-3.5 transition hover:border-accent/40 hover:bg-white ${itemClasses}`}
                      href={step.href}
                    >
                      <span
                        className={`inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-xs font-semibold ${numberClasses}`}
                      >
                        {step.step}
                      </span>
                      <div className="min-w-0">
                        <div className="flex flex-wrap items-center gap-2">
                          <p className="text-sm font-semibold text-foreground">
                            {step.title}
                          </p>
                          {step.tone === "primary" ? (
                            <span className="rounded-full bg-accent-soft px-2 py-1 text-[11px] font-semibold uppercase tracking-[0.16em] text-accent">
                              Start here
                            </span>
                          ) : null}
                          {step.tone === "outcome" ? (
                            <span className="rounded-full bg-white px-2 py-1 text-[11px] font-semibold uppercase tracking-[0.16em] text-emerald-700">
                              Outcome
                            </span>
                          ) : null}
                        </div>
                        <p className="mt-1 text-sm leading-6 text-muted">
                          {step.description}
                        </p>
                      </div>
                    </a>
                  </li>
                );
              })}
            </ol>
          </section>
        </div>

        {errorMessage ? (
          <div className="mt-4 rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">
            {errorMessage}
          </div>
        ) : null}
      </div>

      <div className="mt-8 space-y-6">
        <div id="milestone-1">
        <StepCard
          eyebrow="Milestone 1"
          title="Upload Audit PDF"
          description="Upload the source audit document and extract a clean list of review questions for human editing."
          status={auditFile ? "complete" : "ready"}
        >
          <div className="grid gap-5 lg:grid-cols-[1fr_auto] lg:items-end">
            <label className="flex cursor-pointer flex-col rounded-[24px] border border-dashed border-border bg-[#fcfbf8] p-5 transition hover:border-accent">
              <span className="text-sm font-semibold text-foreground">
                Audit PDF
              </span>
              <span className="mt-2 text-sm leading-6 text-muted">
                Text-based PDF only for this MVP. OCR-only scans will be rejected.
              </span>
              <input
                accept="application/pdf"
                className="mt-4 block text-sm text-muted file:mr-4 file:rounded-full file:border-0 file:bg-accent file:px-4 file:py-2 file:font-semibold file:text-white hover:file:bg-accent-strong"
                onChange={(event) => {
                  setAuditFile(event.target.files?.[0] ?? null);
                  setAuditExtractionMethod(null);
                  setExtractProgress({
                    stage: null,
                    message: null,
                    completedBatches: 0,
                    totalBatches: 0,
                  });
                }}
                type="file"
              />
              {auditFile ? (
                <span className="mt-4 rounded-xl bg-accent-soft px-3 py-2 text-sm font-medium text-accent">
                  {auditFile.name} · {formatBytes(auditFile.size)}
                </span>
              ) : null}
              {extractingStatusMessage ? (
                <span className="mt-4 rounded-xl bg-white px-3 py-2 text-sm text-muted">
                  {extractingStatusMessage}
                </span>
              ) : null}
              {loadingState.extracting && extractProgress.totalBatches > 0 ? (
                <div className="mt-4 rounded-2xl bg-white px-4 py-3">
                  <div className="flex items-center justify-between gap-3 text-sm text-muted">
                    <span>
                      {extractProgress.completedBatches} / {extractProgress.totalBatches} batches
                    </span>
                    <span>{extractProgressValue}%</span>
                  </div>
                  <div className="mt-3 h-2 rounded-full bg-slate-200">
                    <div
                      className="h-2 rounded-full bg-accent transition-[width] duration-300"
                      style={{ width: `${extractProgressValue}%` }}
                    />
                  </div>
                </div>
              ) : null}
            </label>

            <button
              className="h-12 rounded-2xl bg-accent px-5 text-sm font-semibold text-white transition hover:bg-accent-strong disabled:cursor-not-allowed disabled:opacity-50"
              disabled={!auditFile || loadingState.extracting}
              onClick={handleExtractQuestions}
              type="button"
            >
              {loadingState.extracting ? "Extracting..." : "Extract questions"}
            </button>
          </div>
        </StepCard>
        </div>

        <div id="milestone-2">
        <StepCard
          eyebrow="Milestone 2"
          title="Review And Edit Questions"
          description="Clean up the extracted audit questions before review. You can edit, remove, or add your own questions."
          status={isQuestionsReady ? "complete" : "locked"}
        >
          {questions.length === 0 ? (
            <p className="rounded-2xl bg-[#fcfbf8] px-4 py-5 text-sm text-muted">
              Extract questions from the audit PDF to populate the review list.
            </p>
          ) : (
            <div className="space-y-4">
              <div className="flex flex-col gap-4 rounded-[24px] border border-border bg-white/90 p-4 lg:flex-row lg:items-center lg:justify-between">
                <div>
                  <p className="text-sm font-semibold text-foreground">
                    {questions.length} extracted questions ready for analyst cleanup
                  </p>
                  <p className="mt-2 text-sm text-muted">
                    Click any truncated preview to expand.
                  </p>
                </div>
                <button
                  className="rounded-2xl bg-accent px-4 py-2 text-sm font-semibold text-white transition hover:bg-accent-strong"
                  onClick={addQuestion}
                  type="button"
                >
                  Add question
                </button>
              </div>

              <div className="max-h-[42rem] space-y-3 overflow-y-auto pr-1">
                {questions.map((question) => {
                  const isExpanded = expandedQuestionIds.includes(question.id);
                  return (
                    <div
                      key={question.id}
                      className="rounded-[24px] border border-border bg-white/90 p-4"
                    >
                      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                        <button
                          className="min-w-0 flex-1 text-left"
                          onClick={() => toggleQuestionExpanded(question.id)}
                          type="button"
                        >
                          <div className="flex flex-wrap items-center gap-2">
                            <span className="rounded-full bg-accent-soft px-3 py-1 text-xs font-semibold text-accent">
                              Question {question.order}
                            </span>
                            <span className="text-xs uppercase tracking-[0.18em] text-muted">
                              {isExpanded ? "Editor open" : "Preview only"}
                            </span>
                          </div>
                          <p
                            className={`${isExpanded ? "mt-3 text-sm font-medium leading-6 text-foreground" : "mt-3 line-clamp-3 text-sm font-medium leading-6 text-foreground"}`}
                          >
                            {question.text || "New question"}
                          </p>
                        </button>
                        <div className="flex items-center gap-2">
                          <button
                            className="rounded-2xl border border-border bg-[#fcfbf8] px-3 py-2 text-sm font-semibold text-foreground transition hover:border-accent hover:text-accent"
                            onClick={() => toggleQuestionExpanded(question.id)}
                            type="button"
                          >
                            {isExpanded ? "Done editing" : "Edit question"}
                          </button>
                          <button
                            className="text-sm font-medium text-rose-700 transition hover:text-rose-800"
                            onClick={() => removeQuestion(question.id)}
                            type="button"
                          >
                            Remove
                          </button>
                        </div>
                      </div>
                      {isExpanded ? (
                        <div className="mt-4 space-y-3">
                          <label className="block text-xs font-semibold uppercase tracking-[0.18em] text-muted">
                            Question text
                          </label>
                          <textarea
                            className="min-h-28 w-full rounded-2xl border border-border bg-[#fcfbf8] px-4 py-3 text-sm leading-6 text-foreground outline-none transition focus:border-accent"
                            onChange={(event) =>
                              updateQuestionText(question.id, event.target.value)
                            }
                            value={question.text}
                          />
                        </div>
                      ) : null}
                    </div>
                  );
                })}
              </div>
            </div>
          )}
        </StepCard>
        </div>

        <div id="milestone-3">
        <StepCard
          eyebrow="Milestone 3"
          title="Use Default Library And Optional Uploads"
          description="Review against the pre-ingested default policy library, then optionally upload additional policy PDFs for session-specific retrieval."
          status={isPoliciesParsed ? "complete" : isQuestionsReady ? "ready" : "locked"}
        >
          <div className="grid gap-6 xl:grid-cols-[0.8fr_1.2fr]">
            <div className="space-y-4">
              <div className="rounded-[24px] border border-border bg-white/90 p-5">
                <div className="flex items-start justify-between gap-4">
                  <div>
                    <p className="text-sm font-semibold text-foreground">
                      Default policy library
                    </p>
                    <p className="mt-2 text-sm leading-6 text-muted">
                      Uses pre-ingested policies from the server-side library. This is
                      on by default and behaves like the organization knowledge base.
                    </p>
                  </div>
                  <label className="inline-flex items-center gap-2 text-sm font-medium text-foreground">
                    <input
                      checked={useDefaultPolicyLibrary}
                      className="h-4 w-4 rounded border-border text-accent focus:ring-accent"
                      disabled={defaultPolicyDocuments.length === 0}
                      onChange={(event) =>
                        setUseDefaultPolicyLibrary(event.target.checked)
                      }
                      type="checkbox"
                    />
                    Use default policy library
                  </label>
                </div>
                <div className="mt-4 grid gap-3 md:grid-cols-3">
                  <div className="rounded-2xl bg-[#f4f8f7] px-4 py-3">
                    <p className="text-xs font-semibold uppercase tracking-[0.18em] text-muted">
                      Preload status
                    </p>
                    <p className="mt-2 text-sm font-semibold text-foreground">
                      {defaultLibraryDetailLabel}
                    </p>
                  </div>
                  <div className="rounded-2xl bg-[#f4f8f7] px-4 py-3">
                    <p className="text-xs font-semibold uppercase tracking-[0.18em] text-muted">
                      PDFs loaded
                    </p>
                    <p className="mt-2 text-sm font-semibold text-foreground">
                      {defaultPolicyDocuments.length}
                    </p>
                  </div>
                  <div className="rounded-2xl bg-[#f4f8f7] px-4 py-3">
                    <p className="text-xs font-semibold uppercase tracking-[0.18em] text-muted">
                      Chunks loaded
                    </p>
                    <p className="mt-2 text-sm font-semibold text-foreground">
                      {totalDefaultChunks}
                    </p>
                  </div>
                </div>
                <p className="mt-4 text-sm text-muted">
                  {defaultPolicyDocuments.length > 0
                    ? `${defaultPolicyDocuments.length} preloaded policies · ${totalDefaultChunks} chunks`
                    : "No preloaded policy PDFs found in the /policies folder yet."}
                </p>
              </div>

              <label className="flex cursor-pointer flex-col rounded-[24px] border border-dashed border-border bg-[#fcfbf8] p-5 transition hover:border-accent">
                <span className="text-sm font-semibold text-foreground">
                  Upload additional policy PDFs
                </span>
                <span className="mt-2 text-sm leading-6 text-muted">
                  Optional. These files are processed for this session and merged with
                  the default policy library during retrieval.
                </span>
                <input
                  accept="application/pdf"
                  className="mt-4 block text-sm text-muted file:mr-4 file:rounded-full file:border-0 file:bg-foreground file:px-4 file:py-2 file:font-semibold file:text-white hover:file:bg-slate-800"
                  multiple
                  onChange={(event) => {
                    setPolicyFiles(Array.from(event.target.files ?? []));
                    setUploadedDatasetId(null);
                    setUploadedPolicyDocuments([]);
                    setSelectedDocumentIds([]);
                    setResults([]);
                  }}
                  type="file"
                />
              </label>

              {policyFiles.length > 0 ? (
                <div className="rounded-[24px] border border-border bg-white/90 p-4">
                  <p className="text-sm font-semibold text-foreground">
                    Staged uploads
                  </p>
                  <ul className="mt-3 space-y-2 text-sm text-muted">
                    {policyFiles.map((file) => (
                      <li key={`${file.name}-${file.size}`}>
                        {file.name} · {formatBytes(file.size)}
                      </li>
                    ))}
                  </ul>
                </div>
              ) : null}

              <button
                className="h-12 rounded-2xl bg-foreground px-5 text-sm font-semibold text-white transition hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-50"
                disabled={policyFiles.length === 0 || loadingState.parsingPolicies}
                onClick={handleParsePolicies}
                type="button"
              >
                {loadingState.parsingPolicies
                  ? "Parsing..."
                  : "Parse uploaded policies"}
              </button>
            </div>

            <div className="space-y-4">
              {defaultPolicyDocuments.length > 0 ? (
                <div className="rounded-[24px] border border-border bg-white/92 p-4">
                  <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                    <div>
                      <p className="text-sm font-semibold text-foreground">
                        Preloaded policy library
                      </p>
                      <p className="mt-2 text-sm text-muted">
                        Keep the default view lightweight, then expand the full file
                        list only when you need document-level detail.
                      </p>
                    </div>
                    <button
                      className="rounded-2xl border border-border bg-[#fcfbf8] px-4 py-2 text-sm font-semibold text-foreground transition hover:border-accent hover:text-accent"
                      onClick={() =>
                        setShowDefaultLibraryDocuments((current) => !current)
                      }
                      type="button"
                    >
                      {showDefaultLibraryDocuments ? "Hide file list" : "Show file list"}
                    </button>
                  </div>
                  <div className="mt-4 grid gap-3 md:grid-cols-3">
                    <div className="rounded-2xl bg-[#f4f8f7] px-4 py-3">
                      <p className="text-xs font-semibold uppercase tracking-[0.18em] text-muted">
                        Total PDFs
                      </p>
                      <p className="mt-2 text-sm font-semibold text-foreground">
                        {defaultPolicyDocuments.length}
                      </p>
                    </div>
                    <div className="rounded-2xl bg-[#f4f8f7] px-4 py-3">
                      <p className="text-xs font-semibold uppercase tracking-[0.18em] text-muted">
                        Total chunks
                      </p>
                      <p className="mt-2 text-sm font-semibold text-foreground">
                        {totalDefaultChunks}
                      </p>
                    </div>
                    <div className="rounded-2xl bg-[#f4f8f7] px-4 py-3">
                      <p className="text-xs font-semibold uppercase tracking-[0.18em] text-muted">
                        Library mode
                      </p>
                      <p className="mt-2 text-sm font-semibold text-foreground">
                        {useDefaultPolicyLibrary ? "Enabled" : "Off"}
                      </p>
                    </div>
                  </div>

                  {showDefaultLibraryDocuments ? (
                    <ul className="mt-4 max-h-72 space-y-3 overflow-y-auto pr-1 text-sm text-muted">
                      {defaultPolicyDocuments.map((document) => (
                        <li
                          className="flex items-center justify-between gap-3 rounded-2xl bg-[#fcfbf8] px-4 py-3"
                          key={document.id}
                        >
                          <div className="min-w-0">
                            <p className="truncate font-medium text-foreground">
                              {document.fileName}
                            </p>
                            <p className="mt-1 text-xs uppercase tracking-[0.18em] text-muted">
                              {document.chunkCount} chunks
                            </p>
                          </div>
                          <span className="rounded-full bg-white px-3 py-1 text-xs font-semibold text-accent">
                            {document.pageCount} pages
                          </span>
                        </li>
                      ))}
                    </ul>
                  ) : (
                    <ul className="mt-4 space-y-3 text-sm text-muted">
                      {libraryPreviewDocuments.map((document) => (
                        <li
                          className="flex items-center justify-between gap-3 rounded-2xl bg-[#fcfbf8] px-4 py-3"
                          key={document.id}
                        >
                          <span className="truncate">{document.fileName}</span>
                          <span className="rounded-full bg-white px-3 py-1 text-xs font-semibold text-accent">
                            {document.pageCount} pages
                          </span>
                        </li>
                      ))}
                      {defaultPolicyDocuments.length > libraryPreviewDocuments.length ? (
                        <li className="rounded-2xl border border-dashed border-border px-4 py-3 text-center text-sm text-muted">
                          {defaultPolicyDocuments.length - libraryPreviewDocuments.length} more
                          preloaded files hidden until expanded
                        </li>
                      ) : null}
                    </ul>
                  )}
                </div>
              ) : null}

              {uploadedPolicyDocuments.length === 0 ? (
                <p className="rounded-2xl bg-[#fcfbf8] px-4 py-5 text-sm text-muted">
                  Uploaded policies are optional. Parse them to add session-specific
                  retrieval on top of the default library.
                </p>
              ) : (
                uploadedPolicyDocuments.map((document) => (
                  <label
                    key={document.id}
                    className="flex gap-4 rounded-[24px] border border-border bg-white/92 p-4"
                  >
                    <input
                      checked={selectedDocumentIds.includes(document.id)}
                      className="mt-1 h-4 w-4 rounded border-border text-accent focus:ring-accent"
                      onChange={() => toggleDocumentSelection(document.id)}
                      type="checkbox"
                    />
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center justify-between gap-3">
                        <p className="font-semibold text-foreground">
                          {document.fileName}
                        </p>
                        <span className="rounded-full bg-[#f4f8f7] px-3 py-1 text-xs font-semibold text-accent">
                          {document.chunkCount} chunks
                        </span>
                      </div>
                      <p className="mt-2 text-sm leading-6 text-muted">
                        {document.pageCount} pages parsed for this session. Source:
                        uploaded.
                      </p>
                    </div>
                  </label>
                ))
              )}

              {uploadedPolicyDocuments.length > 0 ? (
                <p className="text-sm text-muted">
                  {selectedPolicyCount} of {uploadedPolicyDocuments.length} uploaded
                  policies selected for hybrid retrieval.
                </p>
              ) : null}
            </div>
          </div>
        </StepCard>
        </div>

        <div id="milestone-4">
        <StepCard
          eyebrow="Milestone 4"
          title="Run Compliance Review"
          description="Use hybrid retrieval to gather the most relevant policy chunks for each question, then ask the LLM for a conservative grounded Yes/No answer."
          status={results.length > 0 ? "complete" : canRunReview ? "ready" : "locked"}
        >
          <div className="flex flex-col gap-5 lg:flex-row lg:items-center lg:justify-between">
            <div className="max-w-2xl rounded-[24px] bg-[#fcfbf8] p-5">
              <p className="text-sm font-semibold text-foreground">
                Review will use:
              </p>
              <ul className="mt-3 space-y-2 text-sm leading-6 text-muted">
                <li>{questions.length} reviewed audit questions</li>
                <li>
                  Default library:{" "}
                  {useDefaultPolicyLibrary && defaultPolicyDocuments.length > 0
                    ? `${defaultPolicyDocuments.length} policies enabled`
                    : "off"}
                </li>
                <li>{selectedDocumentIds.length} uploaded policies selected</li>
                <li>{totalPolicyChunks} total chunks available for retrieval</li>
                <li>Retrieval uses lexical plus vector search before LLM evaluation</li>
              </ul>
              {loadingState.evaluating ? (
                <div className="mt-4 rounded-2xl bg-white px-4 py-3">
                  <div className="flex items-center justify-between gap-3 text-sm text-muted">
                    <span>
                      {reviewProgress.completedQuestions} / {reviewProgress.totalQuestions} questions reviewed
                    </span>
                    <span>{reviewProgressValue}%</span>
                  </div>
                  <div className="mt-3 h-2 rounded-full bg-slate-200">
                    <div
                      className="h-2 rounded-full bg-accent transition-[width] duration-300"
                      style={{ width: `${reviewProgressValue}%` }}
                    />
                  </div>
                </div>
              ) : null}
            </div>
            <button
              className="h-12 rounded-2xl bg-accent px-6 text-sm font-semibold text-white transition hover:bg-accent-strong disabled:cursor-not-allowed disabled:opacity-50"
              disabled={!canRunReview || loadingState.evaluating}
              onClick={handleRunReview}
              type="button"
            >
              {loadingState.evaluating ? "Running review..." : "Run review"}
            </button>
          </div>
        </StepCard>
        </div>

        <div id="milestone-5">
        <StepCard
          eyebrow="Milestone 5"
          title="Review Results And Export"
          description="Inspect each Yes/No answer, edit the question if needed, re-run one question, set a review state, and export the results to CSV."
          status={results.length > 0 ? "complete" : "locked"}
        >
          {results.length === 0 ? (
              <p className="rounded-2xl bg-[#fcfbf8] px-4 py-5 text-sm text-muted">
                Run the review to generate grounded Yes/No answers with direct
                evidence and citations.
              </p>
          ) : (
            <div className="space-y-5">
              <div className="flex flex-col gap-4 rounded-[24px] bg-[#14313d] p-5 text-white md:flex-row md:items-center md:justify-between">
                <div>
                  <p className="text-lg font-semibold">Results ready for analyst review</p>
                  <p className="mt-2 text-sm text-slate-200">
                    Update review state inline and export the current result set at
                    any time.
                  </p>
                </div>
                <button
                  className="rounded-2xl bg-white px-4 py-3 text-sm font-semibold text-foreground transition hover:bg-slate-100"
                  onClick={exportResultsToCsv}
                  type="button"
                >
                  Export CSV
                </button>
              </div>

              <div className="space-y-4">
                {questions
                  .filter((question) => resultsByQuestionId.has(question.id))
                  .map((question) => (
                    <ResultCard
                      isRerunning={loadingState.rerunningQuestionId === question.id}
                      key={question.id}
                      onQuestionChange={updateQuestionText}
                      onReviewStateChange={updateReviewState}
                      onRerun={handleRerunQuestion}
                      question={question}
                      result={resultsByQuestionId.get(question.id)!}
                    />
                  ))}
              </div>
            </div>
          )}
        </StepCard>
        </div>
      </div>
    </main>
  );
}
