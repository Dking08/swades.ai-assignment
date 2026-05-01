/**
 * Anthropic Direct API provider.
 * Uses @anthropic-ai/sdk with forced tool_choice.
 * Implements PROMPT CACHING via cache_control on system prompt + tool definition.
 * Auth: ANTHROPIC_API_KEY env var.
 */
import Anthropic from "@anthropic-ai/sdk";
import type {
  LLMProvider,
  LLMProviderResponse,
  LLMMessage,
  LLMToolSchema,
  LLMErrorFeedback,
} from "./provider";

let _client: Anthropic | null = null;

function getClient(apiKey: string): Anthropic {
  if (!_client) {
    _client = new Anthropic({ apiKey });
  }
  return _client;
}

export class AnthropicProvider implements LLMProvider {
  readonly name = "anthropic" as const;
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

    const anthropicMessages = messages.map((m) => ({
      role: m.role as "user" | "assistant",
      content: m.content,
    }));

    const response = await client.messages.create({
      model: this.modelId,
      max_tokens: config?.maxTokens ?? 4096,
      temperature: config?.temperature ?? 0.0,
      // System prompt with cache_control for prompt caching
      system: [
        {
          type: "text" as const,
          text: system,
          cache_control: { type: "ephemeral" as const },
        },
      ],
      messages: anthropicMessages,
      tools: [
        {
          name: toolSchema.name,
          description: toolSchema.description,
          input_schema: toolSchema.inputSchema as Anthropic.Tool.InputSchema,
          // Cache the tool definition too — it's identical across all requests
          cache_control: { type: "ephemeral" as const },
        },
      ],
      tool_choice: { type: "tool", name: toolSchema.name },
    });

    const inputTokens = response.usage?.input_tokens ?? 0;
    const outputTokens = response.usage?.output_tokens ?? 0;
    // Prompt caching tokens from Anthropic's response
    const cacheReadTokens = (response.usage as any)?.cache_read_input_tokens ?? 0;
    const cacheWriteTokens = (response.usage as any)?.cache_creation_input_tokens ?? 0;

    const toolUseBlock = response.content.find(
      (block) => block.type === "tool_use"
    );

    if (!toolUseBlock || toolUseBlock.type !== "tool_use") {
      return {
        toolCallResult: null,
        toolCallId: null,
        rawAssistantResponse: response.content,
        inputTokens,
        outputTokens,
        cacheReadTokens,
        cacheWriteTokens,
        error: "No tool_use block in Anthropic response",
      };
    }

    return {
      toolCallResult: toolUseBlock.input as Record<string, unknown>,
      toolCallId: toolUseBlock.id,
      rawAssistantResponse: response.content,
      inputTokens,
      outputTokens,
      cacheReadTokens,
      cacheWriteTokens,
      error: null,
    };
  }

  async callWithRetryFeedback(
    system: string,
    messages: LLMMessage[],
    previousResponse: unknown,
    feedback: LLMErrorFeedback,
    toolSchema: LLMToolSchema,
    config?: { maxTokens?: number; temperature?: number }
  ): Promise<LLMProviderResponse> {
    const client = getClient(this.apiKey);

    const anthropicMessages: Anthropic.MessageParam[] = messages.map((m) => ({
      role: m.role as "user" | "assistant",
      content: m.content,
    }));

    // Add previous assistant response
    if (previousResponse) {
      anthropicMessages.push({
        role: "assistant",
        content: previousResponse as Anthropic.ContentBlock[],
      });
    }

    // Add tool_result with error
    if (feedback.toolCallId) {
      anthropicMessages.push({
        role: "user",
        content: [
          {
            type: "tool_result",
            tool_use_id: feedback.toolCallId,
            is_error: true,
            content: feedback.errorMessage,
          },
        ],
      });
    } else {
      anthropicMessages.push({
        role: "user",
        content: `Error: ${feedback.errorMessage}\nPlease call the ${toolSchema.name} tool again with corrected data.`,
      });
    }

    const response = await client.messages.create({
      model: this.modelId,
      max_tokens: config?.maxTokens ?? 4096,
      temperature: config?.temperature ?? 0.0,
      system: [
        {
          type: "text" as const,
          text: system,
          cache_control: { type: "ephemeral" as const },
        },
      ],
      messages: anthropicMessages,
      tools: [
        {
          name: toolSchema.name,
          description: toolSchema.description,
          input_schema: toolSchema.inputSchema as Anthropic.Tool.InputSchema,
          cache_control: { type: "ephemeral" as const },
        },
      ],
      tool_choice: { type: "tool", name: toolSchema.name },
    });

    const cacheReadTokens = (response.usage as any)?.cache_read_input_tokens ?? 0;
    const cacheWriteTokens = (response.usage as any)?.cache_creation_input_tokens ?? 0;

    const toolUseBlock = response.content.find(
      (block) => block.type === "tool_use"
    );

    if (!toolUseBlock || toolUseBlock.type !== "tool_use") {
      return {
        toolCallResult: null,
        toolCallId: null,
        rawAssistantResponse: response.content,
        inputTokens: response.usage?.input_tokens ?? 0,
        outputTokens: response.usage?.output_tokens ?? 0,
        cacheReadTokens,
        cacheWriteTokens,
        error: "No tool_use block in retry response",
      };
    }

    return {
      toolCallResult: toolUseBlock.input as Record<string, unknown>,
      toolCallId: toolUseBlock.id,
      rawAssistantResponse: response.content,
      inputTokens: response.usage?.input_tokens ?? 0,
      outputTokens: response.usage?.output_tokens ?? 0,
      cacheReadTokens,
      cacheWriteTokens,
      error: null,
    };
  }
}

export function resetAnthropicClient(): void {
  _client = null;
}
