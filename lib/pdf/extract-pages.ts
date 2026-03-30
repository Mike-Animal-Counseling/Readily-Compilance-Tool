import PDFParser, {
  type Output as ParsedPdfOutput,
  type Page as ParsedPdfPage,
  type Text as ParsedPdfText,
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

async function parsePdfBuffer(data: Uint8Array): Promise<ParsedPdfOutput> {
  return new Promise((resolve, reject) => {
    const parser = new PDFParser(null, false);

    parser.on("pdfParser_dataReady", (pdfData) => {
      parser.destroy();
      resolve(pdfData);
    });

    parser.on("pdfParser_dataError", (error) => {
      parser.destroy();
      reject(
        error instanceof Error
          ? error
          : error?.parserError instanceof Error
            ? error.parserError
            : new Error("Failed to parse PDF."),
      );
    });

    parser.parseBuffer(Buffer.from(data));
  });
}

async function extractPdfPagesFromData(data: Uint8Array): Promise<PdfPage[]> {
  const parsedPdf = await parsePdfBuffer(data);

  return parsedPdf.Pages.map((page, index) => convertParsedPage(page, index + 1));
}

export async function extractPdfPages(file: File): Promise<PdfPage[]> {
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
