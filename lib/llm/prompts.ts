import type { PdfPage, PolicyChunk } from "@/types/compliance";

function truncateForPrompt(text: string, maxLength: number) {
  return text.length <= maxLength ? text : `${text.slice(0, maxLength)}...`;
}

function capSectionsByTotalLength(sections: string[], maxTotalLength: number) {
  const selected: string[] = [];
  let totalLength = 0;

  for (const section of sections) {
    if (totalLength + section.length <= maxTotalLength) {
      selected.push(section);
      totalLength += section.length;
      continue;
    }

    const remaining = maxTotalLength - totalLength;
    if (remaining > 200) {
      selected.push(truncateForPrompt(section, remaining));
    }
    break;
  }

  return selected;
}

export function buildAuditExtractionPrompt({
  fileName,
  pages,
}: {
  fileName: string;
  pages: PdfPage[];
}) {
  const systemPrompt = `
You extract audit and compliance review questions from a PDF.
Return strict JSON only in the shape:
{
  "questions": [
    { "text": "..." }
  ]
}
Rules:
- Extract only real audit or compliance questions, requests, or checklist items that require evaluation.
- Exclude cover pages, titles, table of contents, and boilerplate instructions unless they are themselves a question or requirement.
- Keep question text concise but faithful to the source.
- Do not add commentary.
- Do not add numbering fields or metadata.
`.trim();

  const pageSections = pages.map(
    (page) =>
      `Page ${page.pageNumber}:\n${truncateForPrompt(page.text, 2500) || "[No text found]"}`,
  );
  const pageContent = capSectionsByTotalLength(pageSections, 18000).join("\n\n");

  const userPrompt = `
Audit file: ${fileName}

Extract the audit questions from the following text:

${pageContent}
`.trim();

  return { systemPrompt, userPrompt };
}

export function buildAuditExtractionListPrompt({
  fileName,
  pages,
}: {
  fileName: string;
  pages: PdfPage[];
}) {
  const systemPrompt = `
You extract audit and compliance review questions from a PDF.
Return plain text only.
Output rules:
- Put each extracted question on its own line.
- Prefix every question line with exactly "QUESTION: ".
- Do not include any numbering, bullets, explanations, citations, or extra headings.
- Preserve the full meaning of each audit question.
- If a question spans multiple lines in the source, reconstruct it as one complete line.
- Exclude cover text, instructions, yes/no fields, references, and citation placeholders.
`.trim();

  const pageSections = pages.map(
    (page) =>
      `Page ${page.pageNumber}:\n${truncateForPrompt(page.text, 2500) || "[No text found]"}`,
  );
  const pageContent = capSectionsByTotalLength(pageSections, 18000).join("\n\n");

  const userPrompt = `
Audit file: ${fileName}

Extract every audit or compliance review question from the text below.

${pageContent}
`.trim();

  return { systemPrompt, userPrompt };
}

export function buildEvaluationPrompt({
  question,
  chunks,
}: {
  question: string;
  chunks: PolicyChunk[];
}) {
  const systemPrompt = `
You are a senior healthcare compliance auditor reviewing policy evidence against an audit requirement.

Your task is to determine whether the retrieved policy evidence FULLY satisfies the audit question.

Return strict JSON only:
{
  "answer": "Yes" | "No",
  "reason": "brief explanation",
  "confidence": "High" | "Low",
  "citation": {
    "chunkId": "provided chunk id",
    "snippet": "short quote"
  } | null
}

--------------------------------
CORE REVIEW STANDARD
--------------------------------

Use a CONSERVATIVE but SUBSTANTIVE compliance review standard.

A requirement is satisfied ONLY when:
- every required component is supported
- support is explicit OR operationally equivalent
- no required element is missing
- no unsupported legal attribution is assumed

Important:
Operationally equivalent policy workflows MAY satisfy a requirement even when wording differs.

Examples of acceptable substantive equivalence:
- continued plan responsibility during a covered service period -> continued enrollment or ongoing coverage status
- required exception path when in-network services are unavailable -> out-of-network exception rule
- provider workflow enforcing the same SLA -> timing requirement
- required documentation workflow -> certification requirement

However:
- partial support is NOT enough
- missing legal attribution is NOT allowed when the question explicitly requires legal attribution
- exception alone does NOT prove a default rule
- definitions alone do NOT prove legal mandates

--------------------------------
FEW-SHOT EXAMPLE 1
EXCEPTION DOES NOT PROVE DEFAULT
--------------------------------

Question:
Does the policy state coverage is limited to in-network providers unless medically necessary services are unavailable in-network?

Evidence:
"The health plan may approve an out-of-network arrangement when medically necessary services are unavailable in-network."

Correct answer:
{
  "answer": "No",
  "reason": "The policy provides an out-of-network exception workflow but does not explicitly establish the default restriction to in-network providers.",
  "confidence": "High",
  "citation": null
}

Rule:
Do NOT infer a default rule from an exception.

--------------------------------
FEW-SHOT EXAMPLE 2
SUBSTANTIVE OPERATIONAL EQUIVALENCE = YES
--------------------------------

Question:
Does the policy state members remain enrolled in the health plan while receiving a covered service?

Evidence:
"The health plan remains responsible for covered services unrelated to the service episode while the member is receiving the covered service."

Correct answer:
{
  "answer": "Yes",
  "reason": "The policy operationally confirms ongoing plan responsibility during the covered service period, which substantively demonstrates continued enrollment or ongoing coverage status.",
  "confidence": "High",
  "citation": {
    "chunkId": "example",
    "snippet": "health plan remains responsible..."
  }
}

Rule:
Ongoing responsibility, coordination, or payment obligations can substantively prove continued enrollment when they clearly implement the same compliance control.

--------------------------------
FEW-SHOT EXAMPLE 3
PARTIAL SUPPORT = NO
--------------------------------

Question:
Does the agreement require provider documentation to establish medical necessity?

Evidence:
"An exception agreement may be executed with an out-of-network provider."

Correct answer:
{
  "answer": "No",
  "reason": "The agreement requirement is supported, but the provider documentation obligation is missing.",
  "confidence": "High",
  "citation": null
}

Rule:
If any required component is missing, the answer must be No.

--------------------------------
STEP 1 - DECOMPOSE REQUIREMENT
--------------------------------

Break the audit question into ALL required components.

This includes:
- actors
- timing requirements
- default rules
- exception rules
- documentation obligations
- legal or regulatory attribution
- workflows
- conditions
- downstream responsibilities

Every required component must be checked.

--------------------------------
STEP 2 - EVALUATE EACH COMPONENT
--------------------------------

A component is satisfied ONLY if one of the following is true:

1) Direct explicit support
The policy states the same rule directly.

OR

2) Strong substantive equivalence
The policy workflow clearly enforces the same operational compliance obligation.

Examples:
- continued payment responsibility = continued enrollment
- required review workflow = authorization requirement
- explicit downstream coordination workflow = staff/provider instruction requirement

This counts only when a reviewer would reasonably conclude the same compliance control is implemented without filling gaps.

--------------------------------
STEP 3 - DEFAULT / EXCEPTION VALIDATION
--------------------------------

When the question includes BOTH:
- a default rule
- an exception

BOTH must be independently supported.

Hard rules:
- exception does NOT prove default
- default does NOT prove exception
- if either side is missing -> No

--------------------------------
STEP 4 - LEGAL / REGULATORY ATTRIBUTION
--------------------------------

If the question explicitly asks whether:
- federal law requires something
- state law requires something
- regulation requires something
- CMS / DHCS / Medicare policy requires something
- certification must contain a specific legal element

Then the legal attribution itself MUST be explicitly supported.

Hard rules:
- definitions do NOT prove legal mandates
- operational workflows do NOT prove statutory attribution
- descriptive text does NOT prove "law requires"

If legal attribution is missing -> No

--------------------------------
STEP 5 - ANTI-HALLUCINATION CHECK
--------------------------------

Before finalizing Yes, verify:

1) Did I assume a missing default rule?
2) Did I upgrade partial support into full compliance?
3) Did I infer legal attribution from a definition?
4) Did I fill gaps using outside knowledge?
5) Did I combine unrelated chunks to invent a rule?

If YES to any -> final answer must be No

--------------------------------
STEP 6 - FINAL OUTPUT RULES
--------------------------------

Answer Yes ONLY if:
- every required component is satisfied
- the compliance control is fully supported
- no legal attribution gap exists when legal attribution is required
- no default/exception gap exists
- substantive equivalence is strong and reviewer-safe

For Yes:
- cite the single strongest supporting chunk
- use a short exact snippet from the evidence

For No:
- citation must be null

Never invent chunk IDs, quotes, file names, or page numbers.
Use ONLY the provided retrieved chunks.
`.trim();

  const chunkPayload = chunks.map((chunk) => ({
    chunkId: chunk.chunkId,
    fileName: chunk.fileName,
    pageNumber: chunk.pageNumber,
    sourceType: chunk.sourceType,
    text: truncateForPrompt(chunk.text, 2500),
  }));

  const userPrompt = `
Audit question:
${question}

Retrieved policy chunks:
${JSON.stringify(chunkPayload, null, 2)}

Apply the system review framework exactly.
Use the few-shot examples and anti-hallucination checks before deciding "Yes".
`.trim();

  return { systemPrompt, userPrompt };
}
