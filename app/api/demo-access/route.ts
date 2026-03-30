import { NextResponse } from "next/server";
import {
  DEMO_ACCESS_COOKIE,
  getConfiguredDemoAccessCode,
  isDemoAccessEnabled,
} from "@/lib/auth/demo-access";

export async function POST(request: Request) {
  if (!isDemoAccessEnabled()) {
    return NextResponse.json({ ok: true, enabled: false });
  }

  const body = (await request.json().catch(() => null)) as
    | { code?: string }
    | null;
  const submittedCode = body?.code?.trim() ?? "";
  const configuredCode = getConfiguredDemoAccessCode();

  if (!submittedCode || submittedCode !== configuredCode) {
    return NextResponse.json(
      { error: "Invalid access code." },
      { status: 401 },
    );
  }

  const response = NextResponse.json({ ok: true, enabled: true });
  response.cookies.set(DEMO_ACCESS_COOKIE, configuredCode, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: 60 * 60 * 12,
  });

  return response;
}

export async function DELETE() {
  const response = NextResponse.json({ ok: true });
  response.cookies.set(DEMO_ACCESS_COOKIE, "", {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: 0,
  });

  return response;
}
