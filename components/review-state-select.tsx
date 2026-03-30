import type { ReviewState } from "@/types/compliance";

type ReviewStateSelectProps = {
  value: ReviewState;
  onChange: (nextValue: ReviewState) => void;
};

export function ReviewStateSelect({
  value,
  onChange,
}: ReviewStateSelectProps) {
  return (
    <select
      className="rounded-xl border border-border bg-white px-3 py-2 text-sm font-medium text-foreground outline-none transition focus:border-accent"
      value={value}
      onChange={(event) => onChange(event.target.value as ReviewState)}
    >
      <option value="pending">Pending</option>
      <option value="approved">Approved</option>
      <option value="needs_review">Needs review</option>
    </select>
  );
}
