"use client";

import { useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { DEMO_ACCESS_REDIRECT_PARAM } from "@/lib/auth/demo-access";

export default function DemoAccessPage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [code, setCode] = useState("");
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setErrorMessage(null);
    setSubmitting(true);

    try {
      const response = await fetch("/api/demo-access", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ code }),
      });
      const payload = (await response.json().catch(() => null)) as
        | { error?: string }
        | null;

      if (!response.ok) {
        throw new Error(payload?.error ?? "Invalid access code.");
      }

      const redirectTo = searchParams.get(DEMO_ACCESS_REDIRECT_PARAM);
      const nextPath = redirectTo && redirectTo.startsWith("/") ? redirectTo : "/";
      router.replace(nextPath);
      router.refresh();
    } catch (error) {
      setErrorMessage(
        error instanceof Error ? error.message : "Failed to unlock the demo.",
      );
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <main className="min-h-screen bg-[#f5f4ef] px-6 py-10 text-foreground md:px-10">
      <div className="mx-auto flex min-h-[calc(100vh-5rem)] max-w-5xl items-center justify-center">
        <section className="grid w-full overflow-hidden rounded-[32px] border border-border bg-white shadow-[0_24px_80px_rgba(15,23,42,0.08)] lg:grid-cols-[1.08fr_0.92fr]">
          <div className="bg-[#14313d] px-8 py-10 text-white md:px-10 md:py-12">
            <p className="text-xs font-semibold uppercase tracking-[0.28em] text-slate-300">
              Readily Compliance Review
            </p>
            <h1 className="mt-5 max-w-md text-4xl font-semibold tracking-[-0.03em] text-balance">
              Secure access for the hosted demo environment
            </h1>
            <p className="mt-5 max-w-xl text-sm leading-7 text-slate-200">
              This lightweight access gate protects the live review workspace while
              keeping the workflow simple for stakeholders to evaluate.
            </p>
            <div className="mt-8 grid gap-4 md:grid-cols-2">
              <div className="rounded-[24px] border border-white/10 bg-white/6 p-5">
                <p className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-300">
                  Demo mode
                </p>
                <p className="mt-3 text-sm leading-6 text-slate-100">
                  Access is intentionally limited while the deployment uses private
                  LLM credentials and billable model access.
                </p>
              </div>
              <div className="rounded-[24px] border border-white/10 bg-white/6 p-5">
                <p className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-300">
                  Workflow
                </p>
                <p className="mt-3 text-sm leading-6 text-slate-100">
                  Enter the access code once, then continue into the full audit
                  extraction and review flow.
                </p>
              </div>
            </div>
          </div>

          <div className="px-8 py-10 md:px-10 md:py-12">
            <p className="text-sm font-semibold text-foreground">Enter access code</p>
            <p className="mt-2 text-sm leading-6 text-muted">
              Use the shared code provided for the live demo to unlock the hosted
              review workspace.
            </p>

            <form className="mt-8 space-y-5" onSubmit={handleSubmit}>
              <div>
                <label
                  className="block text-xs font-semibold uppercase tracking-[0.18em] text-muted"
                  htmlFor="demo-access-code"
                >
                  Access code
                </label>
                <input
                  autoComplete="one-time-code"
                  className="mt-3 h-12 w-full rounded-2xl border border-border bg-[#fcfbf8] px-4 text-sm font-medium uppercase tracking-[0.18em] text-foreground outline-none transition focus:border-accent"
                  id="demo-access-code"
                  onChange={(event) => setCode(event.target.value)}
                  placeholder="Enter code"
                  type="password"
                  value={code}
                />
              </div>

              {errorMessage ? (
                <p className="rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">
                  {errorMessage}
                </p>
              ) : null}

              <button
                className="h-12 w-full rounded-2xl bg-accent px-5 text-sm font-semibold text-white transition hover:bg-accent-strong disabled:cursor-not-allowed disabled:opacity-50"
                disabled={submitting || code.trim().length === 0}
                type="submit"
              >
                {submitting ? "Unlocking..." : "Unlock demo"}
              </button>
            </form>
          </div>
        </section>
      </div>
    </main>
  );
}
