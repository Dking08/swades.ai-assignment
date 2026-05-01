/**
 * Amazon Bedrock provider.
 * Uses the ConverseCommand API with forced tool use.
 * Auth: AWS_BEARER_TOKEN_BEDROCK env var.
 */
import {
  BedrockRuntimeClient,
  ConverseCommand,
} from "@aws-sdk/client-bedrock-runtime";
import { NodeHttpHandler } from "@smithy/node-http-handler";
import type {
  LLMProvider,
  LLMProviderResponse,
  LLMMessage,
  LLMToolSchema,
  LLMErrorFeedback,
} from "./provider";

let _client: BedrockRuntimeClient | null = null;

function getClient(region: string): BedrockRuntimeClient {
  if (!_client) {
    _client = new BedrockRuntimeClient({
      region,
      requestHandler: new NodeHttpHandler({
        connectionTimeout: 15_000,
        requestTimeout: 120_000,
      }),
    });
  }
  return _client;
}

export class BedrockProvider implements LLMProvider {
  readonly name = "bedrock" as const;
  private region: string;
  private modelId: string;

  constructor(region: string, modelId: string) {
    this.region = region;
    this.modelId = modelId;
  }

  async callWithToolUse(
    system: string,
    messages: LLMMessage[],
    toolSchema: LLMToolSchema,
    config?: { maxTokens?: number; temperature?: number }
  ): Promise<LLMProviderResponse> {
    const client = getClient(this.region);

    const bedrockMessages = messages.map((m) => ({
      role: m.role as "user" | "assistant",
      content: [{ text: m.content }],
    }));

    const command = new ConverseCommand({
      modelId: this.modelId,
      system: [{ text: system }],
      messages: bedrockMessages,
      toolConfig: {
        tools: [
          {
            toolSpec: {
              name: toolSchema.name,
              description: toolSchema.description,
              inputSchema: { json: toolSchema.inputSchema as any },
            },
          },
        ],
        toolChoice: { tool: { name: toolSchema.name } },
      },
      inferenceConfig: {
        maxTokens: config?.maxTokens ?? 4096,
        temperature: config?.temperature ?? 0.0,
      },
    });

    const response = await client.send(command);

    const usage = response.usage;
    const inputTokens = usage?.inputTokens ?? 0;
    const outputTokens = usage?.outputTokens ?? 0;

    const assistantMessage = response.output?.message;
    const toolUseBlock = assistantMessage?.content?.find(
      (block) => "toolUse" in block
    );

    if (!toolUseBlock || !("toolUse" in toolUseBlock)) {
      return {
        toolCallResult: null,
        toolCallId: null,
        rawAssistantResponse: assistantMessage,
        inputTokens,
        outputTokens,
        cacheReadTokens: 0,
        cacheWriteTokens: 0,
        error: "No tool_use block in Bedrock response",
      };
    }

    const toolUse = toolUseBlock.toolUse!;
    return {
      toolCallResult: toolUse.input as Record<string, unknown>,
      toolCallId: toolUse.toolUseId ?? null,
      rawAssistantResponse: assistantMessage,
      inputTokens,
      outputTokens,
      cacheReadTokens: 0,
      cacheWriteTokens: 0,
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
    const client = getClient(this.region);

    // Build the full conversation including the failed attempt
    const bedrockMessages = messages.map((m) => ({
      role: m.role as "user" | "assistant",
      content: [{ text: m.content }],
    }));

    // Add the previous assistant response
    if (previousResponse) {
      bedrockMessages.push(previousResponse as any);
    }

    // Add tool result with error
    if (feedback.toolCallId) {
      bedrockMessages.push({
        role: "user" as const,
        content: [
          {
            toolResult: {
              toolUseId: feedback.toolCallId,
              status: "error",
              content: [{ text: feedback.errorMessage }],
            },
          } as any,
        ],
      });
    } else {
      bedrockMessages.push({
        role: "user",
        content: [
          {
            text: `Error: ${feedback.errorMessage}\nPlease call the ${toolSchema.name} tool again with corrected data.`,
          },
        ],
      });
    }

    const command = new ConverseCommand({
      modelId: this.modelId,
      system: [{ text: system }],
      messages: bedrockMessages,
      toolConfig: {
        tools: [
          {
            toolSpec: {
              name: toolSchema.name,
              description: toolSchema.description,
              inputSchema: { json: toolSchema.inputSchema as any },
            },
          },
        ],
        toolChoice: { tool: { name: toolSchema.name } },
      },
      inferenceConfig: {
        maxTokens: config?.maxTokens ?? 4096,
        temperature: config?.temperature ?? 0.0,
      },
    });

    const response = await client.send(command);
    const usage = response.usage;
    const assistantMessage = response.output?.message;
    const toolUseBlock = assistantMessage?.content?.find(
      (block) => "toolUse" in block
    );

    if (!toolUseBlock || !("toolUse" in toolUseBlock)) {
      return {
        toolCallResult: null,
        toolCallId: null,
        rawAssistantResponse: assistantMessage,
        inputTokens: usage?.inputTokens ?? 0,
        outputTokens: usage?.outputTokens ?? 0,
        cacheReadTokens: 0,
        cacheWriteTokens: 0,
        error: "No tool_use block in retry response",
      };
    }

    const toolUse = toolUseBlock.toolUse!;
    return {
      toolCallResult: toolUse.input as Record<string, unknown>,
      toolCallId: toolUse.toolUseId ?? null,
      rawAssistantResponse: assistantMessage,
      inputTokens: usage?.inputTokens ?? 0,
      outputTokens: usage?.outputTokens ?? 0,
      cacheReadTokens: 0,
      cacheWriteTokens: 0,
      error: null,
    };
  }
}

export function resetBedrockClient(): void {
  _client = null;
}
