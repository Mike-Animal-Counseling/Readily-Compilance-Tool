import { NextResponse } from "next/server";
import {
  getPreloadedPolicyLibraryMetadata,
  getPreloadedPolicyLibraryStatus,
} from "@/lib/db/preloaded-policy-store";
import type { PolicyLibraryResponse } from "@/types/compliance";

export const runtime = "nodejs";

export async function GET() {
  try {
    const [documents, status] = await Promise.all([
      getPreloadedPolicyLibraryMetadata(),
      getPreloadedPolicyLibraryStatus(),
    ]);

    const response: PolicyLibraryResponse = {
      enabled: documents.length > 0,
      preloaded: status.preloaded,
      documentCount: status.documentCount,
      chunkCount: status.chunkCount,
      documents,
    };

    return NextResponse.json(response);
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Failed to load default policy library.";

    return NextResponse.json({ error: message }, { status: 500 });
  }
}
