/**
 * LLM Provider Interface.
 * All providers (Bedrock, Anthropic, Gemini) implement this interface.
 * This makes it trivial to add new providers.
 */

export type LLMProviderName = "bedrock" | "anthropic" | "gemini";

/** A simplified message format that all providers can consume. */
export interface LLMMessage {
  role: "user" | "assistant";
  content: string;
}

/** System prompt (just text for simplicity, providers adapt as needed). */
export interface LLMSystemPrompt {
  text: string;
}

/** The tool schema in a provider-agnostic JSON Schema format. */
export interface LLMToolSchema {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
}

/** What every provider must return from a tool-use call. */
export interface LLMProviderResponse {
  /** The extracted JSON from the tool call, or null if the model didn't call the tool. */
  toolCallResult: Record<string, unknown> | null;
  /** Unique ID for the tool call (for retry feedback). Some providers may not have this. */
  toolCallId: string | null;
  /** The raw assistant response (for re-sending in retry conversation). */
  rawAssistantResponse: unknown;
  /** Token usage */
  inputTokens: number;
  outputTokens: number;
  /** Error message if something went wrong at the model level */
  error: string | null;
}

/** Error feedback for retry — tells the model what went wrong. */
export interface LLMErrorFeedback {
  toolCallId: string | null;
  errorMessage: string;
}

/**
 * Every LLM provider must implement this interface.
 */
export interface LLMProvider {
  readonly name: LLMProviderName;

  /**
   * Send a request with forced tool use and return the structured result.
   * The provider is responsible for adapting the generic types to its
   * native API format.
   *
   * @param system     System prompt text
   * @param messages   Conversation messages (for retry context)
   * @param toolSchema The extraction tool definition
   * @param config     Model-specific config (temperature, max_tokens, etc.)
   */
  callWithToolUse(
    system: string,
    messages: LLMMessage[],
    toolSchema: LLMToolSchema,
    config?: { maxTokens?: number; temperature?: number }
  ): Promise<LLMProviderResponse>;

  /**
   * Send a retry request with error feedback.
   * This is the retry path: we include the previous assistant response
   * and the error, then ask again.
   */
  callWithRetryFeedback(
    system: string,
    messages: LLMMessage[],
    previousResponse: unknown,
    feedback: LLMErrorFeedback,
    toolSchema: LLMToolSchema,
    config?: { maxTokens?: number; temperature?: number }
  ): Promise<LLMProviderResponse>;
}
