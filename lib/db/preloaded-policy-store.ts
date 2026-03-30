import type { Sql } from "postgres";
import { getDb } from "@/lib/db/client";
import { callOpenRouterEmbeddings } from "@/lib/llm/openrouter";
import type { VectorizedPolicyChunk } from "@/lib/rag/vector-store";
import type {
  PolicyChunk,
  PolicyDocument,
  PolicyLibraryResponse,
  PolicySourceType,
} from "@/types/compliance";

type DbPolicyChunkRow = {
  chunkId: string;
  documentId: string;
  fileName: string;
  pageNumber: number;
  text: string;
  sourceType: PolicySourceType;
  rank: number;
  rankSource: "lexical" | "vector" | "fallback";
  embedding: string | null;
};

type DbPreloadedDocumentSourceRow = {
  id: string;
  sourceKey: string;
  sourceChecksum: string | null;
  chunkCount: number;
  embeddedChunkCount: number;
};

function getEmbeddingDimensions() {
  const rawValue = process.env.OPENROUTER_EMBEDDING_DIMENSIONS ?? "1536";
  const parsedValue = Number.parseInt(rawValue, 10);

  if (!Number.isFinite(parsedValue) || parsedValue <= 0) {
    throw new Error("OPENROUTER_EMBEDDING_DIMENSIONS must be a positive integer.");
  }

  return parsedValue;
}

function toVectorLiteral(values: number[]) {
  return `[${values.join(",")}]`;
}

function toSqlStringLiteral(value: string) {
  return `'${value.replace(/'/g, "''")}'`;
}

function parseVectorLiteral(value: string | null) {
  if (!value) {
    return [];
  }

  const trimmed = value.trim();
  const inner =
    trimmed.startsWith("[") && trimmed.endsWith("]")
      ? trimmed.slice(1, -1)
      : trimmed;

  if (!inner) {
    return [];
  }

  return inner.split(",").map((item) => Number.parseFloat(item));
}

function getPositiveNumberEnv(name: string, fallback: number) {
  const rawValue = process.env[name];

  if (!rawValue) {
    return fallback;
  }

  const parsedValue = Number.parseFloat(rawValue);
  return Number.isFinite(parsedValue) && parsedValue >= 0 ? parsedValue : fallback;
}

const PRELOADED_LEXICAL_WEIGHT = getPositiveNumberEnv(
  "PRELOADED_LEXICAL_WEIGHT",
  1,
);
const PRELOADED_VECTOR_WEIGHT = getPositiveNumberEnv(
  "PRELOADED_VECTOR_WEIGHT",
  0.35,
);

let schemaReadyPromise: Promise<void> | null = null;

export async function ensurePolicyStoreSchema(sql: Sql = getDb()) {
  if (schemaReadyPromise) {
    await schemaReadyPromise;
    return;
  }

  schemaReadyPromise = (async () => {
  const dimensions = getEmbeddingDimensions();

    await sql`CREATE EXTENSION IF NOT EXISTS vector`;

    await sql`
      CREATE TABLE IF NOT EXISTS policy_documents (
        id TEXT PRIMARY KEY,
        source_key TEXT NOT NULL UNIQUE,
        source_checksum TEXT,
        file_name TEXT NOT NULL,
        page_count INTEGER NOT NULL,
        chunk_count INTEGER NOT NULL,
        source_type TEXT NOT NULL DEFAULT 'preloaded',
        ingested_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `;

    await sql`
      ALTER TABLE policy_documents
      ADD COLUMN IF NOT EXISTS source_checksum TEXT
    `;

    await sql`
      CREATE TABLE IF NOT EXISTS policy_chunks (
        id TEXT PRIMARY KEY,
        document_id TEXT NOT NULL REFERENCES policy_documents(id) ON DELETE CASCADE,
        file_name TEXT NOT NULL,
        page_number INTEGER NOT NULL,
        chunk_index INTEGER NOT NULL,
        text TEXT NOT NULL,
        source_type TEXT NOT NULL DEFAULT 'preloaded',
        search_vector TSVECTOR GENERATED ALWAYS AS (to_tsvector('english', COALESCE(text, ''))) STORED
      )
    `;

    await sql.unsafe(
      `ALTER TABLE policy_chunks ADD COLUMN IF NOT EXISTS embedding vector(${dimensions})`,
    );

    await sql`
      CREATE INDEX IF NOT EXISTS policy_chunks_document_id_idx
      ON policy_chunks (document_id)
    `;

    await sql`
      CREATE INDEX IF NOT EXISTS policy_chunks_search_vector_idx
      ON policy_chunks
      USING GIN (search_vector)
    `;

    await sql`
      CREATE INDEX IF NOT EXISTS policy_chunks_embedding_hnsw_idx
      ON policy_chunks
      USING hnsw (embedding vector_cosine_ops)
    `;
  })().catch((error) => {
    schemaReadyPromise = null;
    throw error;
  });

  await schemaReadyPromise;
}

export async function getPreloadedPolicySources(sql: Sql = getDb()) {
  await ensurePolicyStoreSchema(sql);

  const rows = await sql<DbPreloadedDocumentSourceRow[]>`
    SELECT
      id,
      source_key AS "sourceKey",
      source_checksum AS "sourceChecksum",
      chunk_count AS "chunkCount",
      (
        SELECT COUNT(*)::int
        FROM policy_chunks
        WHERE document_id = policy_documents.id
          AND embedding IS NOT NULL
      ) AS "embeddedChunkCount"
    FROM policy_documents
    WHERE source_type = 'preloaded'
  `;

  return new Map(rows.map((row) => [row.sourceKey, row]));
}

export async function upsertPreloadedPolicyDocument({
  document,
  chunks,
  sql = getDb(),
}: {
  document: {
    id: string;
    sourceKey: string;
    sourceChecksum: string;
    fileName: string;
    pageCount: number;
    chunkCount: number;
  };
  chunks: Array<PolicyChunk & { chunkIndex: number; embedding: number[] }>;
  sql?: Sql;
}) {
  await ensurePolicyStoreSchema(sql);

  await sql`
    DELETE FROM policy_documents
    WHERE source_key = ${document.sourceKey}
      AND source_type = 'preloaded'
  `;

  await sql`
    INSERT INTO policy_documents (
      id,
      source_key,
      source_checksum,
      file_name,
      page_count,
      chunk_count,
      source_type
    ) VALUES (
      ${document.id},
      ${document.sourceKey},
      ${document.sourceChecksum},
      ${document.fileName},
      ${document.pageCount},
      ${document.chunkCount},
      'preloaded'
    )
  `;

  if (chunks.length === 0) {
    return;
  }

  for (let index = 0; index < chunks.length; index += 250) {
    const batch = chunks.slice(index, index + 250);
    const values = batch
      .map(
        (chunk) =>
          `(${toSqlStringLiteral(chunk.chunkId)}, ${toSqlStringLiteral(chunk.documentId)}, ${toSqlStringLiteral(chunk.fileName)}, ${chunk.pageNumber}, ${chunk.chunkIndex}, ${toSqlStringLiteral(chunk.text)}, ${toSqlStringLiteral(chunk.sourceType)}, ${toSqlStringLiteral(toVectorLiteral(chunk.embedding))}::vector)`,
      )
      .join(", ");

    await sql.unsafe(`
      INSERT INTO policy_chunks (
        id,
        document_id,
        file_name,
        page_number,
        chunk_index,
        text,
        source_type,
        embedding
      ) VALUES ${values}
    `);
  }
}

export async function deletePreloadedPolicyDocumentsBySourceKeys(
  sourceKeys: string[],
  sql: Sql = getDb(),
) {
  await ensurePolicyStoreSchema(sql);

  if (sourceKeys.length === 0) {
    return 0;
  }

  const deletedRows = await sql<Array<{ sourceKey: string }>>`
    DELETE FROM policy_documents
    WHERE source_type = 'preloaded'
      AND source_key IN ${sql(sourceKeys)}
    RETURNING source_key AS "sourceKey"
  `;

  return deletedRows.length;
}

export async function getPreloadedPolicyLibraryMetadata(sql: Sql = getDb()) {
  await ensurePolicyStoreSchema(sql);

  const rows = await sql<PolicyDocument[]>`
    SELECT
      id,
      file_name AS "fileName",
      page_count AS "pageCount",
      chunk_count AS "chunkCount",
      source_type AS "sourceType"
    FROM policy_documents
    WHERE source_type = 'preloaded'
    ORDER BY file_name ASC
  `;

  return rows;
}

export async function getPreloadedPolicyLibraryStatus(
  sql: Sql = getDb(),
): Promise<Pick<PolicyLibraryResponse, "preloaded" | "documentCount" | "chunkCount">> {
  await ensurePolicyStoreSchema(sql);

  const [documentStats] = await sql<
    Array<{ documentCount: number; chunkCount: number }>
  >`
    SELECT
      COUNT(*)::int AS "documentCount",
      COALESCE(SUM(chunk_count), 0)::int AS "chunkCount"
    FROM policy_documents
    WHERE source_type = 'preloaded'
  `;

  return {
    preloaded: documentStats.documentCount > 0,
    documentCount: documentStats.documentCount,
    chunkCount: documentStats.chunkCount,
  };
}

export async function searchPreloadedPolicyChunks(
  question: string,
  limit = 20,
  sql: Sql = getDb(),
) {
  await ensurePolicyStoreSchema(sql);

  const query = question.trim();
  if (!query) {
    return [];
  }

  const queryEmbeddings = await callOpenRouterEmbeddings({
    texts: [query],
    responseLabel: "preloaded policy question embedding",
  });
  const queryVector = queryEmbeddings[0];

  const lexicalRows = await sql<DbPolicyChunkRow[]>`
    SELECT
      id AS "chunkId",
      document_id AS "documentId",
      file_name AS "fileName",
      page_number AS "pageNumber",
      text,
      source_type AS "sourceType",
      ts_rank_cd(search_vector, websearch_to_tsquery('english', ${query})) AS rank,
      'lexical'::text AS "rankSource",
      embedding::text AS "embedding"
    FROM policy_chunks
    WHERE source_type = 'preloaded'
      AND search_vector @@ websearch_to_tsquery('english', ${query})
    ORDER BY rank DESC, file_name ASC, page_number ASC
    LIMIT ${limit}
  `;

  const vectorRows = queryVector
    ? await sql<DbPolicyChunkRow[]>`
        SELECT
          id AS "chunkId",
          document_id AS "documentId",
          file_name AS "fileName",
          page_number AS "pageNumber",
          text,
          source_type AS "sourceType",
          (1 - (embedding <=> ${toVectorLiteral(queryVector)}::vector)) AS rank,
          'vector'::text AS "rankSource",
          embedding::text AS "embedding"
        FROM policy_chunks
        WHERE source_type = 'preloaded'
          AND embedding IS NOT NULL
        ORDER BY embedding <=> ${toVectorLiteral(queryVector)}::vector ASC
        LIMIT ${limit}
      `
    : [];

  const fallbackRows =
    lexicalRows.length === 0
      ? await sql<DbPolicyChunkRow[]>`
          SELECT
            id AS "chunkId",
            document_id AS "documentId",
              file_name AS "fileName",
              page_number AS "pageNumber",
              text,
              source_type AS "sourceType",
              0::float8 AS rank,
              'fallback'::text AS "rankSource",
              embedding::text AS "embedding"
            FROM policy_chunks
            WHERE source_type = 'preloaded'
            AND POSITION(LOWER(${query}) IN LOWER(text)) > 0
          ORDER BY file_name ASC, page_number ASC
          LIMIT ${limit}
        `
      : [];

  const merged = new Map<string, DbPolicyChunkRow>();
  for (const row of [...lexicalRows, ...vectorRows, ...fallbackRows]) {
    const weightedRank =
      row.rankSource === "lexical"
        ? row.rank * PRELOADED_LEXICAL_WEIGHT
        : row.rankSource === "vector"
          ? row.rank * PRELOADED_VECTOR_WEIGHT
          : row.rank;
    const weightedRow = {
      ...row,
      rank: weightedRank,
    };
    const existing = merged.get(row.chunkId);
    if (!existing || weightedRow.rank > existing.rank) {
      merged.set(row.chunkId, weightedRow);
    }
  }

  return Array.from(merged.values())
    .sort((left, right) => right.rank - left.rank)
    .slice(0, limit)
    .map<VectorizedPolicyChunk>((row) => ({
      chunkId: row.chunkId,
      documentId: row.documentId,
      fileName: row.fileName,
      pageNumber: row.pageNumber,
      text: row.text,
      sourceType: row.sourceType,
      embedding: parseVectorLiteral(row.embedding),
    }));
}

export async function createPolicyChunkEmbeddings(chunks: PolicyChunk[]) {
  const batchSize = 64;
  const results: number[][] = [];

  for (let index = 0; index < chunks.length; index += batchSize) {
    const batch = chunks.slice(index, index + batchSize);
    const embeddings = await callOpenRouterEmbeddings({
      texts: batch.map((chunk) => chunk.text),
      responseLabel: `preloaded policy ingest batch ${Math.floor(index / batchSize) + 1}`,
    });
    results.push(...embeddings);
  }

  return chunks.map((chunk, index) => ({
    ...chunk,
    embedding: results[index] ?? [],
  }));
}
