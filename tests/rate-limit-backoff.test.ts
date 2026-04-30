/**
 * Test: Rate-limit backoff.
 * Verifies exponential backoff behavior when rate limited.
 */
import { describe, expect, test } from "bun:test";
import { RATE_LIMIT_BASE_DELAY_MS, RATE_LIMIT_MAX_DELAY_MS } from "@test-evals/shared";

// We test the backoff logic independently since we can't easily mock the SDK

describe("Rate Limit Backoff", () => {
  test("base delay is 500ms", () => {
    expect(RATE_LIMIT_BASE_DELAY_MS).toBe(500);
  });

  test("max delay caps at 16 seconds", () => {
    expect(RATE_LIMIT_MAX_DELAY_MS).toBe(16_000);
  });

  test("exponential backoff sequence is correct", () => {
    let delay = RATE_LIMIT_BASE_DELAY_MS;
    const delays: number[] = [];

    for (let i = 0; i < 6; i++) {
      delays.push(delay);
      delay = Math.min(delay * 2, RATE_LIMIT_MAX_DELAY_MS);
    }

    expect(delays).toEqual([500, 1000, 2000, 4000, 8000, 16000]);
  });

  test("delay never exceeds max", () => {
    let delay = RATE_LIMIT_BASE_DELAY_MS;
    for (let i = 0; i < 20; i++) {
      delay = Math.min(delay * 2, RATE_LIMIT_MAX_DELAY_MS);
      expect(delay).toBeLessThanOrEqual(RATE_LIMIT_MAX_DELAY_MS);
    }
  });
});
