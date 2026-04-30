/**
 * Test script to verify Amazon Bedrock connectivity with Anthropic Claude.
 *
 * Usage:
 *   npx bun run scripts/test-bedrock.ts
 *
 * Authentication (pick one):
 *   Option A — Bedrock API Key (recommended, simplest):
 *     AWS_BEARER_TOKEN_BEDROCK=your-bedrock-api-key
 *
 *   Option B — IAM credentials (legacy):
 *     AWS_ACCESS_KEY_ID + AWS_SECRET_ACCESS_KEY (+ AWS_SESSION_TOKEN if temporary)
 *
 * Set AWS_REGION in .env or environment (defaults to ap-south-1)
 */

import {
  BedrockRuntimeClient,
  ConverseCommand,
} from "@aws-sdk/client-bedrock-runtime";
import { NodeHttpHandler } from "@smithy/node-http-handler";
import * as dotenv from "dotenv";
import * as path from "path";

// Load env from apps/server/.env if it exists
dotenv.config({ path: path.resolve(__dirname, "../apps/server/.env") });

const REGION = process.env.AWS_REGION || "ap-south-1";

// Model ID for Claude on Bedrock
const MODEL_ID =
  process.env.BEDROCK_MODEL_ID || "anthropic.claude-3-haiku-20240307-v1:0";

// Detect which auth method is being used (for logging only)
const authMethod = process.env.AWS_BEARER_TOKEN_BEDROCK
  ? "Bedrock API Key (AWS_BEARER_TOKEN_BEDROCK)"
  : process.env.AWS_ACCESS_KEY_ID
    ? "IAM credentials (AWS_ACCESS_KEY_ID)"
    : "~/.aws/credentials or IAM role";

async function testBedrockConnection() {
  console.log("╔════════════════════════════════════════════════════╗");
  console.log("║  Amazon Bedrock — Anthropic Claude Connection Test ║");
  console.log("╚════════════════════════════════════════════════════╝");
  console.log();
  console.log(`  Region:   ${REGION}`);
  console.log(`  Model:    ${MODEL_ID}`);
  console.log(`  Auth:     ${authMethod}`);
  console.log();

  // Force HTTP/1.1 — fixes "http2 request did not get a response" in some environments
  const client = new BedrockRuntimeClient({
    region: REGION,
    requestHandler: new NodeHttpHandler({
      connectionTimeout: 10_000,
      requestTimeout: 30_000,
    }),
  });

  const userMessage = "Hello, what model are you? Please respond briefly.";

  console.log(`  Sending:  "${userMessage}"`);
  console.log("  ...");
  console.log();

  try {
    const command = new ConverseCommand({
      modelId: MODEL_ID,
      messages: [
        {
          role: "user",
          content: [{ text: userMessage }],
        },
      ],
      inferenceConfig: {
        maxTokens: 256,
        temperature: 0.0,
      },
    });

    const startTime = Date.now();
    const response = await client.send(command);
    const elapsed = Date.now() - startTime;

    // Extract response text
    const responseText =
      response.output?.message?.content?.[0]?.text ?? "(no text in response)";

    console.log("  ┌─── Response ───────────────────────────────────┐");
    console.log(`  │ ${responseText.replace(/\n/g, "\n  │ ")}`);
    console.log("  └────────────────────────────────────────────────┘");
    console.log();
    console.log(`  ✅ Connection successful! (${elapsed}ms)`);
    console.log();

    if (response.usage) {
      console.log("  Token Usage:");
      console.log(`    Input:  ${response.usage.inputTokens}`);
      console.log(`    Output: ${response.usage.outputTokens}`);
      console.log(`    Total:  ${response.usage.totalTokens}`);
    }

    console.log();
    console.log(`  Stop reason: ${response.stopReason}`);
    console.log();
  } catch (error: any) {
    console.error("  ❌ Connection FAILED!");
    console.error(`  RAW ERROR NAME: ${error.name}`);
    console.error(`  RAW ERROR MSG:  ${error.message}`);
    console.error(`  RAW FULL:       ${JSON.stringify(error, null, 2)}`);
    console.error();

    if (
      error.name === "CredentialsProviderError" ||
      error.message?.includes("credentials") ||
      error.name === "UnrecognizedClientException"
    ) {
      console.error("  Auth error. Make sure your .env has ONE of the following:");
      console.error();
      console.error(
        "  ✅ Option A — Bedrock API Key (simplest, from Bedrock console → API Keys):"
      );
      console.error(
        "    AWS_BEARER_TOKEN_BEDROCK=your-key-here"
      );
      console.error();
      console.error("  Option B — IAM long-term credentials (from IAM console → Users → Security credentials):");
      console.error("    AWS_ACCESS_KEY_ID=AKIAxxxxxxxxxxx");
      console.error("    AWS_SECRET_ACCESS_KEY=your-secret");
      console.error();
      console.error("  Option C — AWS CLI (run: aws configure)");
    } else if (error.name === "AccessDeniedException") {
      console.error(
        "  Access denied. Check that your key/user has Bedrock permissions"
      );
      console.error(
        "  and that the model is enabled under Bedrock → Model access."
      );
    } else if (error.name === "ValidationException") {
      console.error(
        `  Model "${MODEL_ID}" may not be available in region "${REGION}".`
      );
      console.error("  Check available models in your Bedrock console.");
    } else {
      console.error(`  Error (${error.name}): ${error.message}`);
    }

    console.error();
    process.exit(1);
  }
}

testBedrockConnection();