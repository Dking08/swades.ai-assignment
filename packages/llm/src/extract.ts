/**
 * Core extraction engine with retry-with-error-feedback loop.
 * Uses Bedrock Converse API with forced tool use.
 */
import Ajv from "ajv";
import addFormats from "ajv-formats";
import type { Message } from "@aws-sdk/client-bedrock-runtime";
import type {
  ClinicalExtraction,
  PromptStrategy,
  TraceRecord,
} from "@test-evals/shared";
import { MAX_RETRY_ATTEMPTS } from "@test-evals/shared";
import { converseWithBedrock } from "./client";
import { getToolConfig, EXTRACTION_TOOL_NAME } from "./tool-schema";
import { getStrategy } from "./strategies/index";

// ─── JSON Schema Validator ─────────────────────────────────────────────────
const ajv = new Ajv({ allErrors: true, strict: false });
addFormats(ajv);

// Inline the schema (matches data/schema.json) for validation
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

// ─── Types ─────────────────────────────────────────────────────────────────
export interface ExtractionResult {
  extraction: ClinicalExtraction | null;
  schemaValid: boolean;
  attempts: TraceRecord[];
  totalInputTokens: number;
  totalOutputTokens: number;
}

export interface ExtractOptions {
  region: string;
  modelId: string;
  strategy: PromptStrategy;
  maxAttempts?: number;
}

// ─── Main Extraction Function ──────────────────────────────────────────────
export async function extractWithRetry(
  transcript: string,
  options: ExtractOptions
): Promise<ExtractionResult> {
  const {
    region,
    modelId,
    strategy,
    maxAttempts = MAX_RETRY_ATTEMPTS,
  } = options;

  const strategyConfig = getStrategy(strategy);
  const toolConfig = getToolConfig();
  const traces: TraceRecord[] = [];

  let totalInputTokens = 0;
  let totalOutputTokens = 0;

  // Build initial messages from strategy
  const messages: Message[] = [...strategyConfig.buildMessages(transcript)];

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    const startTime = Date.now();
    let traceRecord: TraceRecord;

    try {
      const response = await converseWithBedrock(region, {
        modelId,
        system: strategyConfig.system,
        messages: [...messages],
        toolConfig,
        inferenceConfig: {
          maxTokens: 4096,
          temperature: 0.0,
        },
      });

      const durationMs = Date.now() - startTime;
      const usage = response.usage;
      const inputTokens = usage?.inputTokens ?? 0;
      const outputTokens = usage?.outputTokens ?? 0;

      totalInputTokens += inputTokens;
      totalOutputTokens += outputTokens;

      // Extract tool use from response
      const assistantMessage = response.output?.message;
      const toolUseBlock = assistantMessage?.content?.find(
        (block) => "toolUse" in block
      );

      if (!toolUseBlock || !("toolUse" in toolUseBlock)) {
        traceRecord = {
          attempt_number: attempt,
          request: { system: strategyConfig.system, messages, toolConfig },
          response: response.output,
          input_tokens: inputTokens,
          output_tokens: outputTokens,
          cache_read_tokens: 0,
          cache_write_tokens: 0,
          duration_ms: durationMs,
          error: "No tool_use block in response",
        };
        traces.push(traceRecord);

        // Append error as user message for retry
        if (assistantMessage) {
          messages.push(assistantMessage);
        }
        messages.push({
          role: "user",
          content: [
            {
              text: "Error: You did not call the extract_clinical_data tool. Please call it now with the extracted data.",
            },
          ],
        });
        continue;
      }

      const toolUse = toolUseBlock.toolUse!;
      const extractedData = toolUse.input as Record<string, unknown>;

      traceRecord = {
        attempt_number: attempt,
        request: { system: "...", messages: messages.length, toolConfig: "..." },
        response: extractedData,
        input_tokens: inputTokens,
        output_tokens: outputTokens,
        cache_read_tokens: 0,
        cache_write_tokens: 0,
        duration_ms: durationMs,
        error: null,
      };

      // Validate against JSON Schema
      const valid = validate(extractedData);

      if (valid) {
        traceRecord.error = null;
        traces.push(traceRecord);
        return {
          extraction: extractedData as unknown as ClinicalExtraction,
          schemaValid: true,
          attempts: traces,
          totalInputTokens,
          totalOutputTokens,
        };
      }

      // Validation failed — build error feedback
      const errors = validate.errors
        ?.map(
          (e) => `${e.instancePath || "/"}: ${e.message} (${JSON.stringify(e.params)})`
        )
        .join("\n");

      traceRecord.error = `Schema validation failed: ${errors}`;
      traces.push(traceRecord);

      // Send the assistant's response + validation errors back for retry
      if (assistantMessage) {
        messages.push(assistantMessage);
      }

      // Send tool result with error to continue conversation
      messages.push({
        role: "user",
        content: [
          {
            toolResult: {
              toolUseId: toolUse.toolUseId!,
              status: "error",
              content: [
                {
                  text: `The extraction output failed JSON Schema validation. Please fix these errors and try again:\n${errors}`,
                },
              ],
            },
          },
        ],
      });
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

      // Check if it's a rate limit error → will be handled by runner's semaphore
      if (
        errorMessage.includes("ThrottlingException") ||
        errorMessage.includes("429") ||
        errorMessage.includes("Too many requests")
      ) {
        throw err; // Let the runner handle rate limiting
      }
    }
  }

  // All attempts exhausted — return last extraction attempt if any
  return {
    extraction: null,
    schemaValid: false,
    attempts: traces,
    totalInputTokens,
    totalOutputTokens,
  };
}
