import "dotenv/config";
import { createEnv } from "@t3-oss/env-core";
import { z } from "zod";

export const env = createEnv({
  server: {
    DATABASE_URL: z.string().min(1),
    BETTER_AUTH_SECRET: z.string().min(1),
    BETTER_AUTH_URL: z.string().min(1),
    CORS_ORIGIN: z.string().min(1),
    NODE_ENV: z
      .enum(["development", "production", "test"])
      .default("development"),

    // ─── LLM Provider Keys (at least ONE required) ──────────────────────
    // Set whichever provider you want to use.
    // Priority: ANTHROPIC_API_KEY > AWS_BEARER_TOKEN_BEDROCK > GEMINI_API_KEY

    // Option A: Anthropic Direct API
    ANTHROPIC_API_KEY: z.string().min(1).optional(),
    ANTHROPIC_MODEL_ID: z.string().optional(),

    // Option B: Amazon Bedrock (API Key auth)
    AWS_BEARER_TOKEN_BEDROCK: z.string().min(1).optional(),
    AWS_REGION: z.string().default("us-west-2"),
    BEDROCK_MODEL_ID: z
      .string()
      .default("us.anthropic.claude-haiku-4-5-20251001-v1:0"),

    // Option C: Google Gemini
    GEMINI_API_KEY: z.string().min(1).optional(),
    GEMINI_MODEL_ID: z.string().default("gemini-3.1-flash-lite-preview"),
  },
  runtimeEnv: process.env,
  emptyStringAsUndefined: true,
});
