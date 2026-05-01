/**
 * Core extraction engine with retry-with-error-feedback loop.
 * Uses the modular LLM provider system — works with Bedrock, Anthropic, or Gemini.
 */
import Ajv from "ajv";
import addFormats from "ajv-formats";
import type {
  ClinicalExtraction,
  PromptStrategy,
  TraceRecord,
} from "@test-evals/shared";
import { MAX_RETRY_ATTEMPTS } from "@test-evals/shared";
import {
  createAutoProvider,
  createProvider,
  detectProviderFromEnv,
  getModelId,
  type LLMProvider,
  type LLMProviderName,
  type LLMToolSchema,
} from "./providers/index";
import { getStrategy } from "./strategies/index";
import { EXTRACTION_TOOL_NAME } from "./tool-schema";

// ─── JSON Schema Validator ─────────────────────────────────────────────────
const ajv = new Ajv({ allErrors: true, strict: false });
addFormats(ajv);

const extractionSchema = {
  type: "object",
  additionalProperties: false,
  required: [
    "chief_complaint",
    "vitals",
    "medications",
    "diagnoses",
    "plan",
    "follow_up",
  ],
  properties: {
    chief_complaint: { type: "string", minLength: 1 },
    vitals: {
      type: "object",
      additionalProperties: false,
      required: ["bp", "hr", "temp_f", "spo2"],
      properties: {
        bp: { type: ["string", "null"] },
        hr: { type: ["integer", "null"] },
        temp_f: { type: ["number", "null"] },
        spo2: { type: ["integer", "null"] },
      },
    },
    medications: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["name", "dose", "frequency", "route"],
        properties: {
          name: { type: "string", minLength: 1 },
          dose: { type: ["string", "null"] },
          frequency: { type: ["string", "null"] },
          route: { type: ["string", "null"] },
        },
      },
    },
    diagnoses: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["description"],
        properties: {
          description: { type: "string", minLength: 1 },
          icd10: { type: "string" },
        },
      },
    },
    plan: { type: "array", items: { type: "string", minLength: 1 } },
    follow_up: {
      type: "object",
      additionalProperties: false,
      required: ["interval_days", "reason"],
      properties: {
        interval_days: { type: ["integer", "null"] },
        reason: { type: ["string", "null"] },
      },
    },
  },
};

const validate = ajv.compile(extractionSchema);

// ─── Portable Tool Schema ──────────────────────────────────────────────────

function getPortableToolSchema(): LLMToolSchema {
  return {
    name: EXTRACTION_TOOL_NAME,
    description:
      "Extract structured clinical data from a doctor-patient transcript. " +
      "All fields are required. Use null for missing values.",
    inputSchema: extractionSchema as Record<string, unknown>,
  };
}

// ─── Types ─────────────────────────────────────────────────────────────────
export interface ExtractionResult {
  extraction: ClinicalExtraction | null;
  schemaValid: boolean;
  attempts: TraceRecord[];
  totalInputTokens: number;
  totalOutputTokens: number;
  provider: string;
  model: string;
}

export interface ExtractOptions {
  /** Provider name — if not set, auto-detected from env */
  provider?: LLMProviderName;
  /** Model ID override — if not set, uses default for the provider */
  modelId?: string;
  /** AWS region — only needed for Bedrock */
  region?: string;
  /** Prompt strategy */
  strategy: PromptStrategy;
  /** Max retry attempts (default: 3) */
  maxAttempts?: number;
}

// ─── Main Extraction Function ──────────────────────────────────────────────
export async function extractWithRetry(
  transcript: string,
  options: ExtractOptions
): Promise<ExtractionResult> {
  const {
    strategy,
    maxAttempts = MAX_RETRY_ATTEMPTS,
  } = options;

  // Resolve the provider
  let llmProvider: LLMProvider;
  let providerName: LLMProviderName;

  if (options.provider) {
    providerName = options.provider;
    llmProvider = createProvider(providerName, {
      awsRegion: options.region ?? process.env.AWS_REGION,
      bedrockModelId: options.modelId ?? process.env.BEDROCK_MODEL_ID,
      anthropicApiKey: process.env.ANTHROPIC_API_KEY,
      anthropicModelId: options.modelId ?? process.env.ANTHROPIC_MODEL_ID,
      geminiApiKey: process.env.GEMINI_API_KEY,
      geminiModelId: options.modelId ?? process.env.GEMINI_MODEL_ID,
    });
  } else {
    const detected = detectProviderFromEnv();
    if (!detected) {
      throw new Error(
        "No LLM provider configured. Set ANTHROPIC_API_KEY, AWS_BEARER_TOKEN_BEDROCK, or GEMINI_API_KEY"
      );
    }
    providerName = detected;
    llmProvider = createAutoProvider();
  }

  const modelId = options.modelId ?? getModelId(providerName);
  const strategyConfig = getStrategy(strategy);
  const toolSchema = getPortableToolSchema();
  const traces: TraceRecord[] = [];

  let totalInputTokens = 0;
  let totalOutputTokens = 0;

  // Build system prompt as a single string
  const systemText = strategyConfig.system
    .map((block) => ("text" in block ? (block as any).text : ""))
    .join("\n");

  // Build initial user message
  const userMessage = strategyConfig
    .buildMessages(transcript)
    .map((m) => {
      const textBlock = m.content?.find(
        (c: any) => typeof c === "object" && "text" in c
      );
      return (textBlock as any)?.text ?? "";
    })
    .join("\n");

  const messages = [{ role: "user" as const, content: userMessage }];
  let lastResponse: unknown = null;

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    const startTime = Date.now();
    let traceRecord: TraceRecord;

    try {
      let response;

      if (attempt === 1 || !lastResponse) {
        // First attempt or no previous response to reference
        response = await llmProvider.callWithToolUse(
          systemText,
          messages,
          toolSchema,
          { maxTokens: 4096, temperature: 0.0 }
        );
      } else {
        // Retry with feedback
        const lastError =
          traces[traces.length - 1]?.error ?? "Unknown error";
        response = await llmProvider.callWithRetryFeedback(
          systemText,
          messages,
          lastResponse,
          {
            toolCallId:
              traces[traces.length - 1]?.error?.includes("Schema validation")
                ? (lastResponse as any)?.toolCallId ?? null
                : null,
            errorMessage: lastError,
          },
          toolSchema,
          { maxTokens: 4096, temperature: 0.0 }
        );
      }

      const durationMs = Date.now() - startTime;
      totalInputTokens += response.inputTokens;
      totalOutputTokens += response.outputTokens;
      lastResponse = response.rawAssistantResponse;

      if (!response.toolCallResult) {
        traceRecord = {
          attempt_number: attempt,
          request: { system: "...", messages: messages.length },
          response: null,
          input_tokens: response.inputTokens,
          output_tokens: response.outputTokens,
          cache_read_tokens: response.cacheReadTokens,
          cache_write_tokens: response.cacheWriteTokens,
          duration_ms: durationMs,
          error: response.error ?? "No tool call returned",
        };
        traces.push(traceRecord);
        continue;
      }

      const extractedData = response.toolCallResult;

      traceRecord = {
        attempt_number: attempt,
        request: {
          system: "...",
          messages: messages.length,
          provider: providerName,
        },
        response: extractedData,
        input_tokens: response.inputTokens,
        output_tokens: response.outputTokens,
        cache_read_tokens: response.cacheReadTokens,
        cache_write_tokens: response.cacheWriteTokens,
        duration_ms: durationMs,
        error: null,
      };

      // Validate against JSON Schema
      const valid = validate(extractedData);

      if (valid) {
        traces.push(traceRecord);
        return {
          extraction: extractedData as unknown as ClinicalExtraction,
          schemaValid: true,
          attempts: traces,
          totalInputTokens,
          totalOutputTokens,
          provider: providerName,
          model: modelId,
        };
      }

      // Validation failed — build error feedback
      const errors = validate.errors
        ?.map(
          (e) =>
            `${e.instancePath || "/"}: ${e.message} (${JSON.stringify(e.params)})`
        )
        .join("\n");

      traceRecord.error = `Schema validation failed: ${errors}`;
      traces.push(traceRecord);

      // The lastResponse and error will be used in next iteration's retry
    } catch (err: unknown) {
      const durationMs = Date.now() - startTime;
      const errorMessage =
        err instanceof Error ? err.message : String(err);

      traceRecord = {
        attempt_number: attempt,
        request: { system: "...", messages: messages.length },
        response: null,
        input_tokens: 0,
        output_tokens: 0,
        cache_read_tokens: 0,
        cache_write_tokens: 0,
        duration_ms: durationMs,
        error: errorMessage,
      };
      traces.push(traceRecord);

      // Rate limit errors bubble up to the runner
      if (
        errorMessage.includes("ThrottlingException") ||
        errorMessage.includes("429") ||
        errorMessage.includes("Too many requests") ||
        errorMessage.includes("Rate exceeded") ||
        errorMessage.includes("RESOURCE_EXHAUSTED")
      ) {
        throw err;
      }
    }
  }

  // All attempts exhausted
  return {
    extraction: null,
    schemaValid: false,
    attempts: traces,
    totalInputTokens,
    totalOutputTokens,
    provider: providerName,
    model: modelId,
  };
}
