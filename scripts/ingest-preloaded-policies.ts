import { createHash } from "node:crypto";
import { promises as fs } from "node:fs";
import path from "node:path";
import { config as loadEnv } from "dotenv";
import { getDb } from "@/lib/db/client";
import {
  createPolicyChunkEmbeddings,
  deletePreloadedPolicyDocumentsBySourceKeys,
  ensurePolicyStoreSchema,
  getPreloadedPolicySources,
  upsertPreloadedPolicyDocument,
} from "@/lib/db/preloaded-policy-store";
import { extractPdfPagesFromBuffer } from "@/lib/pdf/extract-pages";
import { chunkPolicyDocument } from "@/lib/rag/chunking";

const POLICY_DIRECTORY = path.join(process.cwd(), "policies");

loadEnv({ path: ".env.local" });
loadEnv();

function hashBuffer(buffer: Buffer) {
  return createHash("sha1").update(buffer).digest("hex");
}

async function main() {
  const sql = getDb();
  await ensurePolicyStoreSchema(sql);
  await fs.mkdir(POLICY_DIRECTORY, { recursive: true });

  const entries = await fs.readdir(POLICY_DIRECTORY, { withFileTypes: true });
  const pdfFiles = entries
    .filter((entry) => entry.isFile() && entry.name.toLowerCase().endsWith(".pdf"))
    .map((entry) => entry.name)
    .sort((left, right) => left.localeCompare(right));

  const existingSources = await getPreloadedPolicySources(sql);
  const seenSourceKeys = new Set<string>();
  let ingestedCount = 0;
  let skippedCount = 0;
  let deletedCount = 0;
  let totalChunkCount = 0;

  for (const fileName of pdfFiles) {
    seenSourceKeys.add(fileName);
    const filePath = path.join(POLICY_DIRECTORY, fileName);
    const buffer = await fs.readFile(filePath);
    const sourceChecksum = hashBuffer(buffer);
    const existing = existingSources.get(fileName);
    const embeddingsReady =
      existing && existing.chunkCount > 0 && existing.embeddedChunkCount === existing.chunkCount;

    if (existing?.sourceChecksum === sourceChecksum && embeddingsReady) {
      skippedCount += 1;
      continue;
    }

    const pages = await extractPdfPagesFromBuffer(buffer);

    if (pages.every((page) => page.text.trim().length === 0)) {
      continue;
    }

    const documentId = `preloaded-${fileName.toLowerCase().replace(/[^a-z0-9]+/g, "-")}`;
    const documentChunks = chunkPolicyDocument({
      documentId,
      fileName,
      pages,
      sourceType: "preloaded",
    });
    const chunksWithEmbeddings = await createPolicyChunkEmbeddings(documentChunks);

    await upsertPreloadedPolicyDocument({
      document: {
        id: documentId,
        sourceKey: fileName,
        sourceChecksum,
        fileName,
        pageCount: pages.length,
        chunkCount: documentChunks.length,
      },
      chunks: chunksWithEmbeddings.map((chunk, index) => ({
        ...chunk,
        chunkIndex: index + 1,
      })),
      sql,
    });

    ingestedCount += 1;
    totalChunkCount += documentChunks.length;
  }

  const missingSourceKeys = Array.from(existingSources.keys()).filter(
    (sourceKey) => !seenSourceKeys.has(sourceKey),
  );
  deletedCount = await deletePreloadedPolicyDocumentsBySourceKeys(
    missingSourceKeys,
    sql,
  );

  console.info("[ingest:policies] complete", {
    scannedCount: pdfFiles.length,
    ingestedCount,
    skippedCount,
    deletedCount,
    chunkCount: totalChunkCount,
    source: POLICY_DIRECTORY,
  });

  await sql.end();
}

void main().catch((error) => {
  console.error("[ingest:policies] failed", {
    message: error instanceof Error ? error.message : "Unknown ingest error",
  });
  process.exit(1);
});
