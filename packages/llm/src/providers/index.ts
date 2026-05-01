/**
 * Provider registry & auto-detection.
 * Detects which LLM provider to use based on available env vars.
 *
 * Priority order:
 * 1. ANTHROPIC_API_KEY → Anthropic Direct
 * 2. AWS_BEARER_TOKEN_BEDROCK → Amazon Bedrock
 * 3. GEMINI_API_KEY → Google Gemini
 *
 * You can also explicitly request a provider by name.
 */
import type { LLMProvider, LLMProviderName } from "./provider";
import { BedrockProvider } from "./bedrock";
import { AnthropicProvider } from "./anthropic";
import { GeminiProvider } from "./gemini";

export interface ProviderConfig {
  // Bedrock
  awsBearerToken?: string;
  awsRegion?: string;
  bedrockModelId?: string;
  // Anthropic Direct
  anthropicApiKey?: string;
  anthropicModelId?: string;
  // Gemini
  geminiApiKey?: string;
  geminiModelId?: string;
}

/** Default model IDs per provider */
const DEFAULT_MODELS: Record<LLMProviderName, string> = {
  bedrock: "us.anthropic.claude-haiku-4-5-20251001-v1:0",
  anthropic: "claude-haiku-4-5-20251001",
  gemini: "gemini-3.1-flash-lite-preview",
};

/**
 * Detect which provider to use based on available configuration.
 */
export function detectProvider(config: ProviderConfig): LLMProviderName | null {
  if (config.anthropicApiKey) return "anthropic";
  if (config.awsBearerToken) return "bedrock";
  if (config.geminiApiKey) return "gemini";
  return null;
}

/**
 * Detect provider from process.env directly.
 */
export function detectProviderFromEnv(): LLMProviderName | null {
  return detectProvider({
    anthropicApiKey: process.env.ANTHROPIC_API_KEY,
    awsBearerToken: process.env.AWS_BEARER_TOKEN_BEDROCK,
    geminiApiKey: process.env.GEMINI_API_KEY,
  });
}

/**
 * Create a provider instance by name.
 */
export function createProvider(
  name: LLMProviderName,
  config: ProviderConfig
): LLMProvider {
  switch (name) {
    case "bedrock":
      return new BedrockProvider(
        config.awsRegion ?? "us-west-2",
        config.bedrockModelId ?? DEFAULT_MODELS.bedrock
      );

    case "anthropic":
      if (!config.anthropicApiKey) {
        throw new Error("ANTHROPIC_API_KEY is required for Anthropic provider");
      }
      return new AnthropicProvider(
        config.anthropicApiKey,
        config.anthropicModelId ?? DEFAULT_MODELS.anthropic
      );

    case "gemini":
      if (!config.geminiApiKey) {
        throw new Error("GEMINI_API_KEY is required for Gemini provider");
      }
      return new GeminiProvider(
        config.geminiApiKey,
        config.geminiModelId ?? DEFAULT_MODELS.gemini
      );

    default:
      throw new Error(`Unknown provider: ${name}`);
  }
}

/**
 * Auto-detect and create the best available provider.
 * Throws if no provider credentials are found.
 */
export function createAutoProvider(
  configOverride?: Partial<ProviderConfig>
): LLMProvider {
  const config: ProviderConfig = {
    anthropicApiKey: process.env.ANTHROPIC_API_KEY,
    anthropicModelId: process.env.ANTHROPIC_MODEL_ID,
    awsBearerToken: process.env.AWS_BEARER_TOKEN_BEDROCK,
    awsRegion: process.env.AWS_REGION,
    bedrockModelId: process.env.BEDROCK_MODEL_ID,
    geminiApiKey: process.env.GEMINI_API_KEY,
    geminiModelId: process.env.GEMINI_MODEL_ID,
    ...configOverride,
  };

  const providerName = detectProvider(config);
  if (!providerName) {
    throw new Error(
      "No LLM provider configured. Set one of: ANTHROPIC_API_KEY, AWS_BEARER_TOKEN_BEDROCK, or GEMINI_API_KEY"
    );
  }

  return createProvider(providerName, config);
}

/**
 * Get the model ID that will be used for a given provider.
 */
export function getModelId(
  providerName: LLMProviderName,
  config?: ProviderConfig
): string {
  switch (providerName) {
    case "bedrock":
      return config?.bedrockModelId ?? process.env.BEDROCK_MODEL_ID ?? DEFAULT_MODELS.bedrock;
    case "anthropic":
      return config?.anthropicModelId ?? process.env.ANTHROPIC_MODEL_ID ?? DEFAULT_MODELS.anthropic;
    case "gemini":
      return config?.geminiModelId ?? process.env.GEMINI_MODEL_ID ?? DEFAULT_MODELS.gemini;
  }
}

export { BedrockProvider } from "./bedrock";
export { AnthropicProvider } from "./anthropic";
export { GeminiProvider } from "./gemini";
export type { LLMProvider, LLMProviderName, LLMProviderResponse, LLMMessage, LLMToolSchema, LLMErrorFeedback } from "./provider";
