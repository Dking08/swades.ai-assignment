// Provider system
export {
  createAutoProvider,
  createProvider,
  detectProviderFromEnv,
  detectProvider,
  getModelId,
  BedrockProvider,
  AnthropicProvider,
  GeminiProvider,
  type LLMProvider,
  type LLMProviderName,
  type LLMProviderResponse,
  type LLMMessage,
  type LLMToolSchema,
  type LLMErrorFeedback,
  type ProviderConfig,
} from "./providers/index";

// Extraction
export { extractWithRetry, type ExtractionResult, type ExtractOptions } from "./extract";

// Strategies
export { getStrategy, strategies, type StrategyConfig } from "./strategies/index";

// Utilities
export { computePromptHash } from "./prompt-hash";
export { getToolConfig, EXTRACTION_TOOL_NAME } from "./tool-schema";

// Legacy Bedrock client (kept for test-bedrock.ts script compatibility)
export { converseWithBedrock, getBedrockClient, resetClient } from "./client";
