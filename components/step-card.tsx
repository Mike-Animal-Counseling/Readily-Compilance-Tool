type StepCardProps = {
  eyebrow: string;
  title: string;
  description: string;
  status: "locked" | "ready" | "complete";
  children: React.ReactNode;
};

const statusClasses: Record<StepCardProps["status"], string> = {
  locked: "bg-slate-200 text-slate-600",
  ready: "bg-amber-100 text-amber-800",
  complete: "bg-emerald-100 text-emerald-800",
};

const statusLabels: Record<StepCardProps["status"], string> = {
  locked: "Locked",
  ready: "Ready",
  complete: "Complete",
};

export function StepCard({
  eyebrow,
  title,
  description,
  status,
  children,
}: StepCardProps) {
  return (
    <section className="rounded-[28px] border border-border/70 bg-surface-strong p-6 shadow-[var(--shadow)] backdrop-blur xl:p-8">
      <div className="flex flex-col gap-4 border-b border-border pb-5 md:flex-row md:items-start md:justify-between">
        <div className="max-w-2xl">
          <p className="text-xs font-semibold uppercase tracking-[0.24em] text-accent">
            {eyebrow}
          </p>
          <h2 className="mt-2 text-2xl font-semibold text-foreground">{title}</h2>
          <p className="mt-2 text-sm leading-6 text-muted">{description}</p>
        </div>
        <span
          className={`inline-flex items-center rounded-full px-3 py-1 text-xs font-semibold ${statusClasses[status]}`}
        >
          {statusLabels[status]}
        </span>
      </div>
      <div className="pt-6">{children}</div>
    </section>
  );
}
