import { ReviewStateSelect } from "@/components/review-state-select";
import { useState } from "react";
import type {
  AuditQuestion,
  EvaluationResult,
  ReviewState,
} from "@/types/compliance";

type ResultCardProps = {
  question: AuditQuestion;
  result: EvaluationResult;
  onQuestionChange: (questionId: string, text: string) => void;
  onReviewStateChange: (questionId: string, reviewState: ReviewState) => void;
  onRerun: (questionId: string) => Promise<void>;
  isRerunning: boolean;
};

const badgeClasses: Record<EvaluationResult["answer"], string> = {
  Yes: "bg-emerald-100 text-emerald-800",
  No: "bg-rose-100 text-rose-800",
};

export function ResultCard({
  question,
  result,
  onQuestionChange,
  onReviewStateChange,
  onRerun,
  isRerunning,
}: ResultCardProps) {
  const [showFullChunk, setShowFullChunk] = useState(false);
  const [showRetrievedChunks, setShowRetrievedChunks] = useState(false);

  return (
    <article className="rounded-[24px] border border-border bg-white/92 p-5 shadow-sm">
      <div className="flex flex-col gap-4 border-b border-border pb-4 lg:flex-row lg:items-start lg:justify-between">
        <div className="space-y-3">
          <div className="flex flex-wrap items-center gap-2">
            <span className="rounded-full bg-accent-soft px-3 py-1 text-xs font-semibold text-accent">
              Question {question.order}
            </span>
            <span
              className={`rounded-full px-3 py-1 text-xs font-semibold ${badgeClasses[result.answer]}`}
            >
              {result.answer}
            </span>
            <span className="rounded-full bg-slate-100 px-3 py-1 text-xs font-semibold text-slate-700">
              Confidence: {result.confidence}
            </span>
          </div>
          <textarea
            className="min-h-24 w-full rounded-2xl border border-border bg-[#fcfbf8] px-4 py-3 text-sm leading-6 text-foreground outline-none transition focus:border-accent"
            value={question.text}
            onChange={(event) => onQuestionChange(question.id, event.target.value)}
          />
        </div>
        <div className="flex flex-col gap-3">
          <ReviewStateSelect
            value={result.reviewState}
            onChange={(nextValue) =>
              onReviewStateChange(result.questionId, nextValue)
            }
          />
          <button
            className="rounded-xl bg-foreground px-4 py-2 text-sm font-semibold text-white transition hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-50"
            disabled={isRerunning}
            onClick={() => onRerun(question.id)}
            type="button"
          >
            {isRerunning ? "Re-running..." : "Re-run question"}
          </button>
        </div>
      </div>

      <div className="mt-4 grid gap-4 lg:grid-cols-[1.2fr_0.8fr]">
        <div className="rounded-2xl bg-[#f9f6ef] p-4">
          <p className="text-xs font-semibold uppercase tracking-[0.18em] text-muted">
            Reason
          </p>
          <p className="mt-2 text-sm leading-6 text-foreground">{result.reason}</p>
        </div>
        <div className="space-y-3 rounded-2xl bg-[#f4f8f7] p-4">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.18em] text-muted">
              {result.answer === "Yes"
                ? "Evidence"
                : result.evidence
                  ? "Reference evidence"
                  : "Evidence summary"}
            </p>
            <p className="mt-2 text-sm leading-6 text-foreground">
              {result.evidence || "No evidence supported."}
            </p>
            {result.evidenceChunkText ? (
              <div className="mt-3">
                <button
                  className="text-sm font-semibold text-accent transition hover:text-accent-strong"
                  onClick={() => setShowFullChunk((current) => !current)}
                  type="button"
                >
                  {showFullChunk ? "Hide full chunk" : "Show full chunk"}
                </button>
                {showFullChunk ? (
                  <div className="mt-3 rounded-2xl border border-border bg-white px-4 py-3">
                    <p className="text-xs font-semibold uppercase tracking-[0.18em] text-muted">
                      Full evidence chunk
                    </p>
                    <pre className="mt-2 whitespace-pre-wrap break-words font-sans text-sm leading-6 text-foreground">
                      {result.evidenceChunkText}
                    </pre>
                  </div>
                ) : null}
              </div>
            ) : null}
            {result.retrievedChunks.length > 0 ? (
              <div className="mt-3">
                <button
                  className="text-sm font-semibold text-accent transition hover:text-accent-strong"
                  onClick={() => setShowRetrievedChunks((current) => !current)}
                  type="button"
                >
                  {showRetrievedChunks
                    ? "Hide retrieved chunks"
                    : `Show retrieved chunks (${result.retrievedChunks.length})`}
                </button>
                {showRetrievedChunks ? (
                  <div className="mt-3 space-y-3">
                    {result.retrievedChunks.map((chunk) => (
                      <div
                        className="rounded-2xl border border-border bg-white px-4 py-3"
                        key={chunk.chunkId}
                      >
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="text-xs font-semibold uppercase tracking-[0.18em] text-muted">
                            Retrieved chunk
                          </span>
                          {chunk.isPrimary ? (
                            <span className="rounded-full bg-accent-soft px-2 py-1 text-[11px] font-semibold text-accent">
                              Primary
                            </span>
                          ) : null}
                        </div>
                        <p className="mt-2 text-xs text-muted">
                          {chunk.fileName} · Page {chunk.pageNumber} ·{" "}
                          {chunk.sourceType === "preloaded"
                            ? "Default library"
                            : "Uploaded"}
                        </p>
                        <pre className="mt-3 whitespace-pre-wrap break-words font-sans text-sm leading-6 text-foreground">
                          {chunk.text}
                        </pre>
                      </div>
                    ))}
                  </div>
                ) : null}
              </div>
            ) : null}
          </div>
          {result.sourceFile ? (
            <div className="grid gap-3 text-sm text-muted sm:grid-cols-2">
              <div>
                <p className="font-semibold text-foreground">Source file</p>
                <p className="mt-1 break-words">{result.sourceFile || "No source"}</p>
              </div>
              <div>
                <p className="font-semibold text-foreground">Source page</p>
                <p className="mt-1">
                  {result.sourcePage > 0 ? `Page ${result.sourcePage}` : "N/A"}
                </p>
              </div>
              <div>
                <p className="font-semibold text-foreground">Source type</p>
                <p className="mt-1">
                  {result.sourceType === "preloaded"
                    ? "Default library"
                    : result.sourceType === "uploaded"
                      ? "Uploaded"
                      : "N/A"}
                </p>
              </div>
            </div>
          ) : null}
        </div>
      </div>
    </article>
  );
}
