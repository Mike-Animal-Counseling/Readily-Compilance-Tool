import { z } from "zod";
import {
  auditAnswers,
  confidenceLevels,
  policySourceTypes,
  reviewStates,
} from "@/types/compliance";

export const auditQuestionSchema = z.object({
  id: z.string(),
  order: z.number().int().positive(),
  text: z.string(),
});

export const pdfPageSchema = z.object({
  pageNumber: z.number().int().positive(),
  text: z.string(),
});

export const policyChunkSchema = z.object({
  chunkId: z.string(),
  documentId: z.string(),
  fileName: z.string(),
  pageNumber: z.number().int().positive(),
  text: z.string(),
  sourceType: z.enum(policySourceTypes),
});

export const policyDocumentSchema = z.object({
  id: z.string(),
  fileName: z.string(),
  pageCount: z.number().int().positive(),
  chunkCount: z.number().int().nonnegative(),
  sourceType: z.enum(policySourceTypes),
});

export const extractAuditQuestionsSchema = z.object({
  questions: z.array(
    z.object({
      text: z.string(),
    }),
  ),
});

export const evaluationModelResponseSchema = z.object({
  answer: z.enum(auditAnswers),
  reason: z.string(),
  confidence: z.enum(confidenceLevels),
  citation: z
    .object({
      chunkId: z.string(),
      snippet: z.string(),
    })
    .nullable(),
});

export const evaluateReviewRequestSchema = z.object({
  uploadedDatasetId: z.string().uuid().nullable().optional(),
  useDefaultPolicyLibrary: z.boolean(),
  questions: z.array(auditQuestionSchema),
  selectedDocumentIds: z.array(z.string()),
});

export const evaluateOneRequestSchema = z.object({
  uploadedDatasetId: z.string().uuid().nullable().optional(),
  useDefaultPolicyLibrary: z.boolean(),
  question: auditQuestionSchema,
  selectedDocumentIds: z.array(z.string()),
});

export const evaluationResultSchema = z.object({
  questionId: z.string(),
  questionText: z.string(),
  answer: z.enum(auditAnswers),
  reason: z.string(),
  evidence: z.string(),
  confidence: z.enum(confidenceLevels),
  sourceFile: z.string(),
  sourcePage: z.number().int().nonnegative(),
  sourceType: z.enum(policySourceTypes).nullable(),
  reviewState: z.enum(reviewStates),
});
