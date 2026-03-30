import { DEMO_ACCESS_REDIRECT_PARAM } from "@/lib/auth/demo-access";
import { DemoAccessForm } from "@/app/demo-access/demo-access-form";

function getSafeRedirectTarget(value: string | string[] | undefined) {
  const candidate = Array.isArray(value) ? value[0] : value;
  return candidate && candidate.startsWith("/") ? candidate : "/";
}

export default async function DemoAccessPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = await searchParams;
  const redirectTo = getSafeRedirectTarget(params[DEMO_ACCESS_REDIRECT_PARAM]);

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

            <DemoAccessForm redirectTo={redirectTo} />
          </div>
        </section>
      </div>
    </main>
  );
}
