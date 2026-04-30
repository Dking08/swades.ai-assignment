/**
 * Test: Prompt hash stability.
 * Same content → same hash. Different content → different hash.
 */
import { describe, expect, test } from "bun:test";
import { computePromptHash } from "@test-evals/llm/prompt-hash";

describe("Prompt Hash Stability", () => {
  test("same strategy produces same hash", () => {
    const hash1 = computePromptHash("zero_shot");
    const hash2 = computePromptHash("zero_shot");
    expect(hash1).toBe(hash2);
  });

  test("different strategies produce different hashes", () => {
    const hashZero = computePromptHash("zero_shot");
    const hashFew = computePromptHash("few_shot");
    const hashCot = computePromptHash("cot");

    expect(hashZero).not.toBe(hashFew);
    expect(hashZero).not.toBe(hashCot);
    expect(hashFew).not.toBe(hashCot);
  });

  test("hash is deterministic (16 hex chars)", () => {
    const hash = computePromptHash("zero_shot");
    expect(hash).toMatch(/^[a-f0-9]{16}$/);
  });
});
