import { Worker } from "node:worker_threads";
import type {
  Output as ParsedPdfOutput,
  Page as ParsedPdfPage,
  Text as ParsedPdfText,
} from "pdf2json";
import type { PdfPage } from "@/types/compliance";

type NormalizedTextItem = {
  text: string;
  x: number;
  y: number;
};

const LINE_Y_THRESHOLD = 0.35;

function decodePdfText(value: string) {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

function normalizePageText(items: NormalizedTextItem[]) {
  if (items.length === 0) {
    return "";
  }

  const sortedItems = [...items].sort((left, right) => {
    if (Math.abs(left.y - right.y) > LINE_Y_THRESHOLD) {
      return left.y - right.y;
    }

    return left.x - right.x;
  });

  const lines: string[] = [];
  let currentLine = "";
  let previousY: number | null = null;

  for (const item of sortedItems) {
    const nextToken = item.text.replace(/\s+/g, " ").trim();

    if (!nextToken) {
      continue;
    }

    const startsNewLine =
      previousY !== null &&
      Math.abs(item.y - previousY) > LINE_Y_THRESHOLD &&
      currentLine.trim().length > 0;

    if (startsNewLine) {
      lines.push(currentLine.trim());
      currentLine = "";
    }

    currentLine += currentLine ? ` ${nextToken}` : nextToken;
    previousY = item.y;
  }

  if (currentLine.trim()) {
    lines.push(currentLine.trim());
  }

  return lines.join("\n").replace(/\n{3,}/g, "\n\n").trim();
}

function convertParsedPage(page: ParsedPdfPage, pageNumber: number): PdfPage {
  const items: NormalizedTextItem[] = page.Texts.flatMap((textBlock: ParsedPdfText) =>
    textBlock.R.map((run) => ({
      text: decodePdfText(run.T),
      x: textBlock.x,
      y: textBlock.y,
    })),
  );

  return {
    pageNumber,
    text: normalizePageText(items),
  };
}

let activeWorkers = 0;
async function parsePdfBuffer(data: Uint8Array): Promise<ParsedPdfOutput> {
  if (data.length > 2 * 1024 * 1024 || Buffer.from(data.subarray(0, 5)).toString() !== '%PDF-') throw new Error('PDF must be valid and at most 2 MiB');
  if (activeWorkers >= 2) throw new Error("PDF processor busy");
  activeWorkers++;
  try { return await new Promise<ParsedPdfOutput>((resolve, reject) => {
    const worker = new Worker(new URL('./pdf-worker.mjs', import.meta.url), { workerData: data, resourceLimits: { maxOldGenerationSizeMb: 128 } });
    const timer = setTimeout(() => { void worker.terminate(); reject(new Error('PDF parsing timed out')); }, 10000);
    const finish = () => { clearTimeout(timer); void worker.terminate(); };
    worker.once('message', (result) => { finish(); if (result.error) reject(new Error('Invalid PDF')); else resolve(result.data); });
    worker.once('error', () => { finish(); reject(new Error('Invalid PDF')); });
    worker.once('exit', code => { clearTimeout(timer); if (code !== 0) reject(new Error('PDF parsing stopped')); });
  }); } finally { activeWorkers--; }
}
async function extractPdfPagesFromData(data: Uint8Array): Promise<PdfPage[]> {
  const parsedPdf = await parsePdfBuffer(data);

  const pages = parsedPdf.Pages.map((page, index) => convertParsedPage(page, index + 1));
  if (pages.length > 30 || pages.reduce((n, page) => n + page.text.length, 0) > 500000) throw new Error("PDF content exceeds limits");
  return pages;
}

export async function extractPdfPages(file: File): Promise<PdfPage[]> {
  if (file.size > 2 * 1024 * 1024) throw new Error("PDF exceeds 2 MiB");
  const buffer = await file.arrayBuffer();
  return extractPdfPagesFromData(new Uint8Array(buffer));
}

export async function extractPdfPagesFromBuffer(
  buffer: ArrayBuffer | Uint8Array,
): Promise<PdfPage[]> {
  const data =
    buffer instanceof Uint8Array
      ? new Uint8Array(buffer.buffer, buffer.byteOffset, buffer.byteLength)
      : new Uint8Array(buffer);

  return extractPdfPagesFromData(data);
}
