import { z } from "zod";
import {
  auditAnswers,
  confidenceLevels,
  policySourceTypes,
  reviewStates,
} from "@/types/compliance";

export const auditQuestionSchema = z.object({
  id: z.string().max(20000),
  order: z.number().int().positive(),
  text: z.string().min(1).max(4000),
});

export const pdfPageSchema = z.object({
  pageNumber: z.number().int().positive(),
  text: z.string().min(1).max(4000),
});

export const policyChunkSchema = z.object({
  chunkId: z.string().max(20000),
  documentId: z.string().max(20000),
  fileName: z.string().max(20000),
  pageNumber: z.number().int().positive(),
  text: z.string().min(1).max(4000),
  sourceType: z.enum(policySourceTypes),
});

export const policyDocumentSchema = z.object({
  id: z.string().max(20000),
  fileName: z.string().max(20000),
  pageCount: z.number().int().positive(),
  chunkCount: z.number().int().nonnegative(),
  sourceType: z.enum(policySourceTypes),
});

export const extractAuditQuestionsSchema = z.object({
  questions: z.array(
    z.object({
      text: z.string().min(1).max(4000),
    }),
  ),
});

export const evaluationModelResponseSchema = z.object({
  answer: z.enum(auditAnswers),
  reason: z.string().max(20000),
  confidence: z.enum(confidenceLevels),
  citation: z
    .object({
      chunkId: z.string().max(20000),
      snippet: z.string().max(20000),
    })
    .nullable(),
});

export const evaluateReviewRequestSchema = z.object({
  uploadedDatasetId: z.string().max(20000).uuid().nullable().optional(),
  useDefaultPolicyLibrary: z.boolean(),
  questions: z.array(auditQuestionSchema).max(50),
  selectedDocumentIds: z.array(z.string().max(80)).max(100),
});

export const evaluateOneRequestSchema = z.object({
  uploadedDatasetId: z.string().max(20000).uuid().nullable().optional(),
  useDefaultPolicyLibrary: z.boolean(),
  question: auditQuestionSchema,
  selectedDocumentIds: z.array(z.string().max(80)).max(100),
});

export const evaluationResultSchema = z.object({
  questionId: z.string().max(20000),
  questionText: z.string().max(20000),
  answer: z.enum(auditAnswers),
  reason: z.string().max(20000),
  evidence: z.string().max(20000),
  confidence: z.enum(confidenceLevels),
  sourceFile: z.string().max(20000),
  sourcePage: z.number().int().nonnegative(),
  sourceType: z.enum(policySourceTypes).nullable(),
  reviewState: z.enum(reviewStates),
});
