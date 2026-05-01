/**
 * Test: Multi-provider auto-detection and creation.
 */
import { describe, expect, test, beforeEach, afterEach } from "bun:test";
import {
  detectProvider,
  createProvider,
  detectProviderFromEnv,
  type ProviderConfig,
} from "@test-evals/llm/providers";

describe("Multi-Provider Detection", () => {
  // Save original env
  const originalEnv = { ...process.env };

  afterEach(() => {
    // Restore env
    process.env = { ...originalEnv };
  });

  test("detects Anthropic when ANTHROPIC_API_KEY is set", () => {
    const config: ProviderConfig = {
      anthropicApiKey: "sk-ant-test123",
      awsBearerToken: "aws-token",
      geminiApiKey: "gemini-key",
    };
    // Anthropic has highest priority
    expect(detectProvider(config)).toBe("anthropic");
  });

  test("detects Bedrock when only AWS_BEARER_TOKEN_BEDROCK is set", () => {
    const config: ProviderConfig = {
      awsBearerToken: "aws-token",
    };
    expect(detectProvider(config)).toBe("bedrock");
  });

  test("detects Gemini when only GEMINI_API_KEY is set", () => {
    const config: ProviderConfig = {
      geminiApiKey: "gemini-key",
    };
    expect(detectProvider(config)).toBe("gemini");
  });

  test("returns null when no keys are set", () => {
    const config: ProviderConfig = {};
    expect(detectProvider(config)).toBe(null);
  });

  test("priority: Anthropic > Bedrock > Gemini", () => {
    // All set → Anthropic wins
    expect(
      detectProvider({
        anthropicApiKey: "sk-ant-test",
        awsBearerToken: "aws-token",
        geminiApiKey: "gemini-key",
      })
    ).toBe("anthropic");

    // Bedrock + Gemini → Bedrock wins
    expect(
      detectProvider({
        awsBearerToken: "aws-token",
        geminiApiKey: "gemini-key",
      })
    ).toBe("bedrock");
  });

  test("creates Bedrock provider", () => {
    const provider = createProvider("bedrock", {
      awsRegion: "us-east-1",
      bedrockModelId: "test-model",
    });
    expect(provider.name).toBe("bedrock");
  });

  test("creates Anthropic provider", () => {
    const provider = createProvider("anthropic", {
      anthropicApiKey: "sk-ant-test",
    });
    expect(provider.name).toBe("anthropic");
  });

  test("creates Gemini provider", () => {
    const provider = createProvider("gemini", {
      geminiApiKey: "test-gemini-key",
    });
    expect(provider.name).toBe("gemini");
  });

  test("throws when creating Anthropic without API key", () => {
    expect(() => createProvider("anthropic", {})).toThrow(
      "ANTHROPIC_API_KEY is required"
    );
  });

  test("throws when creating Gemini without API key", () => {
    expect(() => createProvider("gemini", {})).toThrow(
      "GEMINI_API_KEY is required"
    );
  });

  test("detectProviderFromEnv reads process.env", () => {
    process.env.ANTHROPIC_API_KEY = "";
    process.env.AWS_BEARER_TOKEN_BEDROCK = "";
    process.env.GEMINI_API_KEY = "test-key";

    const result = detectProviderFromEnv();
    expect(result).toBe("gemini");
  });
});
