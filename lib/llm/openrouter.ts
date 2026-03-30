import { z } from "zod";

const openRouterEnvelopeSchema = z.object({
  choices: z
    .array(
      z.object({
        message: z.object({
          content: z.union([
            z.string(),
            z.array(
              z.object({
                type: z.string().optional(),
                text: z.string().optional(),
              }),
            ),
          ]),
        }),
      }),
    )
    .min(1),
});

const openRouterEmbeddingEnvelopeSchema = z.object({
  data: z.array(
    z.object({
      embedding: z.array(z.number()),
      index: z.number().int().nonnegative().optional(),
    }),
  ),
});

function extractTextContent(content: string | Array<{ text?: string }>) {
  if (typeof content === "string") {
    return content;
  }

  return content.map((item) => item.text ?? "").join("\n");
}

function stripMarkdownCodeFence(text: string) {
  return text
    .replace(/^```json\s*/i, "")
    .replace(/^```\s*/i, "")
    .replace(/```$/i, "")
    .trim();
}

function extractJsonObjectCandidate(text: string) {
  const startIndex = text.indexOf("{");
  if (startIndex === -1) {
    return null;
  }

  let depth = 0;
  let inString = false;
  let isEscaped = false;

  for (let index = startIndex; index < text.length; index += 1) {
    const character = text[index];

    if (inString) {
      if (isEscaped) {
        isEscaped = false;
        continue;
      }

      if (character === "\\") {
        isEscaped = true;
        continue;
      }

      if (character === '"') {
        inString = false;
      }

      continue;
    }

    if (character === '"') {
      inString = true;
      continue;
    }

    if (character === "{") {
      depth += 1;
      continue;
    }

    if (character === "}") {
      depth -= 1;
      if (depth === 0) {
        return text.slice(startIndex, index + 1);
      }
    }
  }

  return null;
}

async function requestOpenRouterChat({
  systemPrompt,
  userPrompt,
  responseLabel,
  model,
  maxTokens,
  responseFormat,
  timeoutMs,
}: {
  systemPrompt: string;
  userPrompt: string;
  responseLabel: string;
  model?: string;
  maxTokens?: number;
  responseFormat?: { type: "json_object" };
  timeoutMs?: number;
}) {
  const apiKey = process.env.OPENROUTER_API_KEY;
  const resolvedModel = model ?? process.env.OPENROUTER_MODEL;

  if (!apiKey) {
    throw new Error("OPENROUTER_API_KEY is not set.");
  }

  if (!resolvedModel) {
    throw new Error("OPENROUTER_MODEL is not set.");
  }

  const abortController = new AbortController();
  const timeoutHandle = setTimeout(() => abortController.abort(), timeoutMs ?? 12000);

  let response: Response;

  try {
    response = await fetch("https://openrouter.ai/api/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      signal: abortController.signal,
      body: JSON.stringify({
        model: resolvedModel,
        temperature: 0,
        max_tokens: maxTokens,
        ...(responseFormat ? { response_format: responseFormat } : {}),
        messages: [
          {
            role: "system",
            content: systemPrompt,
          },
          {
            role: "user",
            content: userPrompt,
          },
        ],
      }),
    });
  } catch (error) {
    if (error instanceof Error && error.name === "AbortError") {
      throw new Error(`OpenRouter request timed out for ${responseLabel}.`);
    }

    throw error;
  } finally {
    clearTimeout(timeoutHandle);
  }

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(
      `OpenRouter request failed for ${responseLabel}: ${response.status} ${errorText}`,
    );
  }

  const envelope = openRouterEnvelopeSchema.parse(await response.json());
  return stripMarkdownCodeFence(extractTextContent(envelope.choices[0].message.content));
}

export async function callOpenRouterText({
  systemPrompt,
  userPrompt,
  responseLabel,
  model,
  maxTokens,
  timeoutMs,
}: {
  systemPrompt: string;
  userPrompt: string;
  responseLabel: string;
  model?: string;
  maxTokens?: number;
  timeoutMs?: number;
}) {
  return requestOpenRouterChat({
    systemPrompt,
    userPrompt,
    responseLabel,
    model,
    maxTokens,
    timeoutMs,
  });
}

export async function callOpenRouterJson<T>({
  systemPrompt,
  userPrompt,
  schema,
  responseLabel,
  model,
  maxTokens,
  fallbackParser,
  timeoutMs,
}: {
  systemPrompt: string;
  userPrompt: string;
  schema: z.ZodSchema<T>;
  responseLabel: string;
  model?: string;
  maxTokens?: number;
  fallbackParser?: (rawText: string) => T | null;
  timeoutMs?: number;
}) {
  const rawText = await requestOpenRouterChat({
    systemPrompt,
    userPrompt,
    responseLabel,
    model,
    maxTokens,
    responseFormat: {
      type: "json_object",
    },
    timeoutMs,
  });

  let parsedJson: unknown;

  try {
    parsedJson = JSON.parse(rawText);
  } catch {
    const jsonCandidate = extractJsonObjectCandidate(rawText);

    if (!jsonCandidate) {
      const fallbackResult = fallbackParser?.(rawText);
      if (fallbackResult) {
        return schema.parse(fallbackResult);
      }

      throw new Error(`OpenRouter returned non-JSON content for ${responseLabel}.`);
    }

    try {
      parsedJson = JSON.parse(jsonCandidate);
    } catch {
      const fallbackResult = fallbackParser?.(rawText);
      if (fallbackResult) {
        return schema.parse(fallbackResult);
      }

      throw new Error(`OpenRouter returned invalid JSON for ${responseLabel}.`);
    }
  }

  return schema.parse(parsedJson);
}

export async function callOpenRouterEmbeddings({
  texts,
  responseLabel,
}: {
  texts: string[];
  responseLabel: string;
}) {
  const apiKey = process.env.OPENROUTER_API_KEY;
  const model = process.env.OPENROUTER_EMBEDDING_MODEL;

  if (!apiKey) {
    throw new Error("OPENROUTER_API_KEY is not set.");
  }

  if (!model) {
    throw new Error("OPENROUTER_EMBEDDING_MODEL is not set.");
  }

  if (texts.length === 0) {
    return [];
  }

  const response = await fetch("https://openrouter.ai/api/v1/embeddings", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model,
      input: texts,
    }),
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(
      `OpenRouter embedding request failed for ${responseLabel}: ${response.status} ${errorText}`,
    );
  }

  const envelope = openRouterEmbeddingEnvelopeSchema.parse(await response.json());
  return envelope.data
    .slice()
    .sort((left, right) => (left.index ?? 0) - (right.index ?? 0))
    .map((item) => item.embedding);
}
