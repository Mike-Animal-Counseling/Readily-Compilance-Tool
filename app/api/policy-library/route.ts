import { guardApi } from "@/lib/security/api";
import { NextResponse } from "next/server";
import {
  getPreloadedPolicyLibraryMetadata,
  getPreloadedPolicyLibraryStatus,
} from "@/lib/db/preloaded-policy-store";
import type { PolicyLibraryResponse } from "@/types/compliance";

export const runtime = "nodejs";

async function handleGET() {
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
  } catch {
    const message =
      "Request could not be completed.";

    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export const GET = guardApi(handleGET, false);
