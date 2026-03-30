import type { PdfPage, PolicyChunk, PolicySourceType } from "@/types/compliance";

function sanitizeForId(value: string) {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
}

function splitTextIntoChunkBodies(text: string, targetSize = 1400, overlapSize = 200) {
  const paragraphs = text
    .split(/\n{2,}/)
    .map((paragraph) => paragraph.trim())
    .filter(Boolean);

  if (paragraphs.length === 0) {
    return [];
  }

  const chunks: string[] = [];
  let current = "";

  for (const paragraph of paragraphs) {
    const nextValue = current ? `${current}\n\n${paragraph}` : paragraph;

    if (nextValue.length <= targetSize) {
      current = nextValue;
      continue;
    }

    if (current) {
      chunks.push(current);
      current = `${current.slice(-overlapSize)} ${paragraph}`.trim();
      continue;
    }

    let cursor = 0;
    while (cursor < paragraph.length) {
      const slice = paragraph.slice(cursor, cursor + targetSize).trim();
      if (slice) {
        chunks.push(slice);
      }
      cursor += targetSize - overlapSize;
    }
  }

  if (current.trim()) {
    chunks.push(current.trim());
  }

  return chunks;
}

export function chunkPolicyDocument({
  documentId,
  fileName,
  pages,
  sourceType,
}: {
  documentId: string;
  fileName: string;
  pages: PdfPage[];
  sourceType: PolicySourceType;
}) {
  const baseId = sanitizeForId(fileName);
  const chunks: PolicyChunk[] = [];

  for (const page of pages) {
    const chunkBodies = splitTextIntoChunkBodies(page.text);

    chunkBodies.forEach((text, index) => {
      chunks.push({
        chunkId: `${baseId}-p${page.pageNumber}-c${index + 1}`,
        documentId,
        fileName,
        pageNumber: page.pageNumber,
        text,
        sourceType,
      });
    });
  }

  return chunks;
}
