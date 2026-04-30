/**
 * Bedrock Runtime client factory.
 * Uses the same proven pattern from scripts/test-bedrock.ts.
 */
import {
  BedrockRuntimeClient,
  ConverseCommand,
  type ConverseCommandInput,
  type ConverseCommandOutput,
} from "@aws-sdk/client-bedrock-runtime";
import { NodeHttpHandler } from "@smithy/node-http-handler";

let _client: BedrockRuntimeClient | null = null;

export interface BedrockConfig {
  region: string;
  modelId: string;
}

/**
 * Get or create a singleton Bedrock client.
 * The AWS_BEARER_TOKEN_BEDROCK env var is picked up automatically
 * by the AWS SDK credential chain.
 */
export function getBedrockClient(region: string): BedrockRuntimeClient {
  if (!_client) {
    _client = new BedrockRuntimeClient({
      region,
      // Force HTTP/1.1 to avoid http2 issues
      requestHandler: new NodeHttpHandler({
        connectionTimeout: 15_000,
        requestTimeout: 120_000, // LLM calls can be slow
      }),
    });
  }
  return _client;
}

/**
 * Send a Converse command to Bedrock and return the response.
 */
export async function converseWithBedrock(
  region: string,
  input: ConverseCommandInput
): Promise<ConverseCommandOutput> {
  const client = getBedrockClient(region);
  const command = new ConverseCommand(input);
  return client.send(command);
}

/**
 * Reset the client (useful for testing).
 */
export function resetClient(): void {
  _client = null;
}
