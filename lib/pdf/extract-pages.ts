import type { PdfPage } from "@/types/compliance";

type TextItem = {
  str: string;
  hasEOL?: boolean;
  transform: number[];
};

type PdfJsModule = typeof import("pdfjs-dist/legacy/build/pdf.mjs");

let pdfJsModulePromise: Promise<PdfJsModule> | null = null;

async function loadPdfJsModule() {
  if (!pdfJsModulePromise) {
    pdfJsModulePromise = (async () => {
      const runtimeGlobal = globalThis as typeof globalThis & {
        DOMMatrix?: unknown;
        ImageData?: unknown;
        Path2D?: unknown;
      };

      if (
        runtimeGlobal.DOMMatrix === undefined ||
        runtimeGlobal.ImageData === undefined ||
        runtimeGlobal.Path2D === undefined
      ) {
        const canvasModule = await import("@napi-rs/canvas");

        runtimeGlobal.DOMMatrix ??= canvasModule.DOMMatrix;
        runtimeGlobal.ImageData ??= canvasModule.ImageData;
        runtimeGlobal.Path2D ??= canvasModule.Path2D;
      }

      return import("pdfjs-dist/legacy/build/pdf.mjs");
    })();
  }

  return pdfJsModulePromise;
}

function normalizePageText(items: TextItem[]) {
  const lines: string[] = [];
  let currentLine = "";
  let previousY: number | null = null;

  for (const item of items) {
    const currentY = Math.round(item.transform[5] ?? 0);
    const startsNewLine =
      previousY !== null && Math.abs(currentY - previousY) > 2 && currentLine.trim();

    if (startsNewLine) {
      lines.push(currentLine.trim());
      currentLine = "";
    }

    const nextToken = item.str.trim();
    if (!nextToken) {
      previousY = currentY;
      continue;
    }

    currentLine += currentLine ? ` ${nextToken}` : nextToken;

    if (item.hasEOL) {
      lines.push(currentLine.trim());
      currentLine = "";
    }

    previousY = currentY;
  }

  if (currentLine.trim()) {
    lines.push(currentLine.trim());
  }

  return lines.join("\n").replace(/\n{3,}/g, "\n\n").trim();
}

async function extractPdfPagesFromData(data: Uint8Array): Promise<PdfPage[]> {
  const { getDocument } = await loadPdfJsModule();

  const pdf = await getDocument({
    data,
    disableFontFace: true,
    useSystemFonts: true,
    isEvalSupported: false,
  }).promise;

  const pages: PdfPage[] = [];

  for (let pageNumber = 1; pageNumber <= pdf.numPages; pageNumber += 1) {
    const page = await pdf.getPage(pageNumber);
    const textContent = await page.getTextContent();
    const pageItems: TextItem[] = textContent.items.flatMap((item) =>
      "str" in item && Array.isArray(item.transform)
        ? [
            {
              str: item.str,
              hasEOL: item.hasEOL,
              transform: item.transform,
            },
          ]
        : [],
    );
    const pageText = normalizePageText(pageItems);

    pages.push({
      pageNumber,
      text: pageText,
    });
  }

  return pages;
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
