export const auditAnswers = ["Yes", "No"] as const;
export type AuditAnswer = (typeof auditAnswers)[number];

export const confidenceLevels = ["High", "Low"] as const;
export type ConfidenceLevel = (typeof confidenceLevels)[number];

export const reviewStates = ["pending", "approved", "needs_review"] as const;
export type ReviewState = (typeof reviewStates)[number];

export const policySourceTypes = ["preloaded", "uploaded"] as const;
export type PolicySourceType = (typeof policySourceTypes)[number];

export interface PdfPage {
  pageNumber: number;
  text: string;
}

export interface AuditQuestion {
  id: string;
  order: number;
  text: string;
}

export interface PolicyChunk {
  chunkId: string;
  documentId: string;
  fileName: string;
  pageNumber: number;
  text: string;
  sourceType: PolicySourceType;
}

export interface RetrievedEvidenceChunk {
  chunkId: string;
  fileName: string;
  pageNumber: number;
  sourceType: PolicySourceType;
  text: string;
  isPrimary: boolean;
}

export interface PolicyDocument {
  id: string;
  fileName: string;
  pageCount: number;
  chunkCount: number;
  sourceType: PolicySourceType;
}

export interface PolicyDocumentRecord {
  id: string;
  fileName: string;
  pages: PdfPage[];
  chunkIds: string[];
  sourceType: PolicySourceType;
}

export interface EvaluationResult {
  questionId: string;
  questionText: string;
  answer: AuditAnswer;
  reason: string;
  evidence: string;
  confidence: ConfidenceLevel;
  evidenceChunkText: string;
  retrievedChunks: RetrievedEvidenceChunk[];
  sourceFile: string;
  sourcePage: number;
  sourceType: PolicySourceType | null;
  reviewState: ReviewState;
}

export interface ExtractAuditResponse {
  auditFileName: string;
  pageCount: number;
  questions: AuditQuestion[];
  extractionMethod: "llm" | "heuristic" | "mixed";
}

export type ExtractAuditJobStatus =
  | "queued"
  | "running"
  | "completed"
  | "failed";

export type ExtractAuditStage =
  | "starting"
  | "reading_pdf"
  | "preparing_batches"
  | "extracting_batch"
  | "deduping"
  | "complete";

export interface ExtractAuditJobStartResponse {
  jobId: string;
}

export interface ExtractAuditJobStatusResponse {
  jobId: string;
  status: ExtractAuditJobStatus;
  stage: ExtractAuditStage;
  message: string;
  completedBatches: number;
  totalBatches: number;
  payload?: ExtractAuditResponse;
  error?: string;
}

export interface ExtractAuditProgressEvent {
  type: "progress";
  stage: ExtractAuditStage;
  message: string;
  completedBatches: number;
  totalBatches: number;
}

export interface ExtractAuditCompleteEvent {
  type: "complete";
  payload: ExtractAuditResponse;
}

export interface ExtractAuditErrorEvent {
  type: "error";
  error: string;
}

export type ExtractAuditStreamEvent =
  | ExtractAuditProgressEvent
  | ExtractAuditCompleteEvent
  | ExtractAuditErrorEvent;

export interface ParsePoliciesResponse {
  datasetId: string;
  documents: PolicyDocument[];
}

export interface PolicyLibraryResponse {
  enabled: boolean;
  preloaded: boolean;
  documentCount: number;
  chunkCount: number;
  documents: PolicyDocument[];
}

export interface EvaluateResponse {
  results: EvaluationResult[];
}

export interface EvaluateOneResponse {
  result: EvaluationResult;
}
