import "dotenv/config";
import { createEnv } from "@t3-oss/env-core";
import { z } from "zod";

export const env = createEnv({
  server: {
    DATABASE_URL: z.string().min(1),
    BETTER_AUTH_SECRET: z.string().min(32),
    BETTER_AUTH_URL: z.url(),
    CORS_ORIGIN: z.url(),
    NODE_ENV: z.enum(["development", "production", "test"]).default("development"),

    // AWS Bedrock credentials (for Anthropic Claude access)
    AWS_ACCESS_KEY_ID: z.string().min(1),
    AWS_SECRET_ACCESS_KEY: z.string().min(1),
    AWS_SESSION_TOKEN: z.string().optional(),
    AWS_REGION: z.string().default("ap-south-1"),
    BEDROCK_MODEL_ID: z.string().default("anthropic.claude-3-haiku-20240307-v1:0"),
  },
  runtimeEnv: process.env,
  emptyStringAsUndefined: true,
});
