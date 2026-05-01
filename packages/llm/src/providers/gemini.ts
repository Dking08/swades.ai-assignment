/**
 * Google Gemini provider.
 * Uses @google/genai SDK with forced function calling (mode: ANY).
 * Auth: GEMINI_API_KEY env var.
 * Model: gemini-3.1-flash-lite-preview
 */
import { GoogleGenAI, type FunctionCallingConfigMode } from "@google/genai";
import type {
  LLMProvider,
  LLMProviderResponse,
  LLMMessage,
  LLMToolSchema,
  LLMErrorFeedback,
} from "./provider";

let _client: GoogleGenAI | null = null;

function getClient(apiKey: string): GoogleGenAI {
  if (!_client) {
    _client = new GoogleGenAI({ apiKey });
  }
  return _client;
}

export class GeminiProvider implements LLMProvider {
  readonly name = "gemini" as const;
  private apiKey: string;
  private modelId: string;

  constructor(apiKey: string, modelId: string) {
    this.apiKey = apiKey;
    this.modelId = modelId;
  }

  async callWithToolUse(
    system: string,
    messages: LLMMessage[],
    toolSchema: LLMToolSchema,
    config?: { maxTokens?: number; temperature?: number }
  ): Promise<LLMProviderResponse> {
    const client = getClient(this.apiKey);

    // Build Gemini contents from messages
    const contents = messages.map((m) => ({
      role: m.role === "assistant" ? "model" : "user",
      parts: [{ text: m.content }],
    }));

    try {
      const response = await client.models.generateContent({
        model: this.modelId,
        contents,
        config: {
          systemInstruction: system,
          maxOutputTokens: config?.maxTokens ?? 4096,
          temperature: config?.temperature ?? 0.0,
          tools: [
            {
              functionDeclarations: [
                {
                  name: toolSchema.name,
                  description: toolSchema.description,
                  parameters: toolSchema.inputSchema,
                },
              ],
            },
          ],
          toolConfig: {
            functionCallingConfig: {
              mode: "ANY" as FunctionCallingConfigMode,
              allowedFunctionNames: [toolSchema.name],
            },
          },
        },
      });

      const inputTokens = response.usageMetadata?.promptTokenCount ?? 0;
      const outputTokens =
        response.usageMetadata?.candidatesTokenCount ?? 0;

      // Check for function call in response
      const functionCalls = response.functionCalls;
      if (!functionCalls || functionCalls.length === 0) {
        return {
          toolCallResult: null,
          toolCallId: null,
          rawAssistantResponse: response,
          inputTokens,
          outputTokens,
          cacheReadTokens: (response.usageMetadata as any)?.cachedContentTokenCount ?? 0,
          cacheWriteTokens: 0,
          error: "No function call in Gemini response",
        };
      }

      const fc = functionCalls[0]!;
      return {
        toolCallResult: (fc.args ?? {}) as Record<string, unknown>,
        toolCallId: fc.id ?? null,
        rawAssistantResponse: response,
        inputTokens,
        outputTokens,
        cacheReadTokens: (response.usageMetadata as any)?.cachedContentTokenCount ?? 0,
        cacheWriteTokens: 0,
        error: null,
      };
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      throw new Error(`Gemini API error: ${msg}`);
    }
  }

  async callWithRetryFeedback(
    system: string,
    messages: LLMMessage[],
    _previousResponse: unknown,
    feedback: LLMErrorFeedback,
    toolSchema: LLMToolSchema,
    config?: { maxTokens?: number; temperature?: number }
  ): Promise<LLMProviderResponse> {
    // Gemini doesn't have a native tool_result feedback mechanism like Anthropic.
    // We append the error as a user message and re-call.
    const retryMessages: LLMMessage[] = [
      ...messages,
      {
        role: "user",
        content: `The previous extraction output had validation errors. Please fix them and call the ${toolSchema.name} function again:\n\n${feedback.errorMessage}`,
      },
    ];

    return this.callWithToolUse(system, retryMessages, toolSchema, config);
  }
}

export function resetGeminiClient(): void {
  _client = null;
}
