import { promises as fs } from "node:fs";
import path from "node:path";
import { config as loadEnv } from "dotenv";
import { extractPdfPagesFromBuffer } from "@/lib/pdf/extract-pages";

loadEnv({ path: ".env.local" });
loadEnv();

async function main() {
  const filePath = process.argv[2];

  if (!filePath) {
    throw new Error("Pass a PDF path to inspect.");
  }

  const resolvedPath = path.resolve(filePath);
  const buffer = await fs.readFile(resolvedPath);
  const pages = await extractPdfPagesFromBuffer(buffer);

  for (const page of pages.slice(0, 10)) {
    console.log(`===== PAGE ${page.pageNumber} =====`);
    console.log(page.text.slice(0, 6000));
    console.log();
  }

  console.log(`TOTAL_PAGES=${pages.length}`);
}

void main().catch((error) => {
  console.error("[inspect-audit-pdf] failed", {
    message: error instanceof Error ? error.message : "Unknown error",
  });
  process.exit(1);
});
