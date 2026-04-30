/**
 * Strategy registry. Adding a 4th strategy = one new file + one entry here.
 */
import type { SystemContentBlock, Message } from "@aws-sdk/client-bedrock-runtime";
import type { PromptStrategy } from "@test-evals/shared";
import { ZERO_SHOT_SYSTEM, buildZeroShotMessages } from "./zero-shot";
import { FEW_SHOT_SYSTEM, buildFewShotMessages } from "./few-shot";
import { COT_SYSTEM, buildCotMessages } from "./cot";

export interface StrategyConfig {
  system: SystemContentBlock[];
  buildMessages: (transcript: string) => Message[];
}

const strategies: Record<PromptStrategy, StrategyConfig> = {
  zero_shot: {
    system: ZERO_SHOT_SYSTEM,
    buildMessages: buildZeroShotMessages,
  },
  few_shot: {
    system: FEW_SHOT_SYSTEM,
    buildMessages: buildFewShotMessages,
  },
  cot: {
    system: COT_SYSTEM,
    buildMessages: buildCotMessages,
  },
};

export function getStrategy(name: PromptStrategy): StrategyConfig {
  const strategy = strategies[name];
  if (!strategy) {
    throw new Error(`Unknown strategy: ${name}`);
  }
  return strategy;
}

export { strategies };
