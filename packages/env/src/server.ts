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

    // AWS Bedrock — API Key auth (simplest)
    AWS_BEARER_TOKEN_BEDROCK: z.string().min(1),
    AWS_REGION: z.string().default("us-west-2"),
    BEDROCK_MODEL_ID: z
      .string()
      .default("us.anthropic.claude-haiku-4-5-20251001-v1:0"),
  },
  runtimeEnv: process.env,
  emptyStringAsUndefined: true,
});
