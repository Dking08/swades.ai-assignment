/**
 * SHA-256 content hash of the full prompt for reproducibility.
 * Changing any character → new hash.
 */
import { createHash } from "crypto";
import type { PromptStrategy } from "@test-evals/shared";
import { getStrategy } from "./strategies/index";
import { getToolConfig } from "./tool-schema";

/**
 * Compute a deterministic hash of the prompt content.
 * Includes: strategy system prompt + tool schema + strategy name.
 */
export function computePromptHash(strategy: PromptStrategy): string {
  const config = getStrategy(strategy);
  const toolConfig = getToolConfig();

  const content = JSON.stringify({
    strategy,
    system: config.system,
    toolConfig,
  });

  return createHash("sha256").update(content).digest("hex").slice(0, 16);
}
