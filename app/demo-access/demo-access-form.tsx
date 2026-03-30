"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

export function DemoAccessForm({ redirectTo }: { redirectTo: string }) {
  const router = useRouter();
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

      router.replace(redirectTo);
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
  );
}
