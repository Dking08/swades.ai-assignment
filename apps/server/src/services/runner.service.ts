/**
 * Runner service — orchestrates eval runs with concurrency control,
 * resumability, and idempotency.
 */
import { randomUUID } from "crypto";
import { eq, and } from "drizzle-orm";
import { db } from "@test-evals/db";
import { evalRuns, evalCases, evalTraces } from "@test-evals/db/schema";
import { detectProviderFromEnv, extractWithRetry } from "@test-evals/llm";
import { computePromptHash } from "@test-evals/llm/prompt-hash";
import type { LLMProviderName } from "@test-evals/llm";
import type {
  PromptStrategy,
  CaseScores,
  HallucinationItem,
  SSEEvent,
} from "@test-evals/shared";
import {
  MAX_CONCURRENT_CASES,
  RATE_LIMIT_BASE_DELAY_MS,
  RATE_LIMIT_MAX_DELAY_MS,
  HAIKU_INPUT_PRICE_PER_1M,
  HAIKU_OUTPUT_PRICE_PER_1M,
  HAIKU_45_TOTAL_PRICE_PER_1M,
} from "@test-evals/shared";
import {
  scoreCase,
  detectHallucinations,
  computeAggregates,
} from "./evaluate.service";
import {
  listTranscriptIds,
  loadTranscript,
  loadGold,
} from "./dataset.service";

// ─── Semaphore ─────────────────────────────────────────────────────────────

class Semaphore {
  private permits: number;
  private waiters: Array<() => void> = [];

  constructor(maxPermits: number) {
    this.permits = maxPermits;
  }

  async acquire(): Promise<void> {
    if (this.permits > 0) {
      this.permits--;
      return;
    }
    return new Promise<void>((resolve) => {
      this.waiters.push(resolve);
    });
  }

  release(): void {
    const next = this.waiters.shift();
    if (next) {
      next();
    } else {
      this.permits++;
    }
  }
}

// ─── Active run tracking (for SSE) ─────────────────────────────────────────

type EventCallback = (event: SSEEvent) => void;
type WaitUntil = (promise: Promise<unknown>) => void;
const activeListeners = new Map<string, Set<EventCallback>>();

export function subscribeToRun(
  runId: string,
  callback: EventCallback
): () => void {
  if (!activeListeners.has(runId)) {
    activeListeners.set(runId, new Set());
  }
  activeListeners.get(runId)!.add(callback);
  return () => {
    activeListeners.get(runId)?.delete(callback);
    if (activeListeners.get(runId)?.size === 0) {
      activeListeners.delete(runId);
    }
  };
}

function emitEvent(runId: string, event: SSEEvent): void {
  const listeners = activeListeners.get(runId);
  if (listeners) {
    for (const cb of listeners) {
      cb(event);
    }
  }
}

// ─── Cost Calculation ──────────────────────────────────────────────────────

const HAIKU_45_MODEL_RE = /haiku[-_.]?4[-_.]?5/i;

function isHaiku45Model(modelId: string): boolean {
  return HAIKU_45_MODEL_RE.test(modelId);
}

function computeCost(
  inputTokens: number,
  outputTokens: number,
  modelId: string
): number {
  if (isHaiku45Model(modelId)) {
    const totalTokens = inputTokens + outputTokens;
    return (totalTokens / 1_000_000) * HAIKU_45_TOTAL_PRICE_PER_1M;
  }

  return (
    (inputTokens / 1_000_000) * HAIKU_INPUT_PRICE_PER_1M +
    (outputTokens / 1_000_000) * HAIKU_OUTPUT_PRICE_PER_1M
  );
}

// ─── Rate Limit Backoff ────────────────────────────────────────────────────

async function withRateLimitRetry<T>(
  fn: () => Promise<T>,
  maxRetries = 5
): Promise<T> {
  let delay = RATE_LIMIT_BASE_DELAY_MS;
  for (let i = 0; i <= maxRetries; i++) {
    try {
      return await fn();
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      const isRateLimit =
        msg.includes("ThrottlingException") ||
        msg.includes("429") ||
        msg.includes("Too many requests") ||
        msg.includes("Rate exceeded") ||
        msg.includes("RESOURCE_EXHAUSTED");

      if (!isRateLimit || i === maxRetries) throw err;

      const jitter = Math.random() * delay * 0.3;
      await new Promise((r) => setTimeout(r, delay + jitter));
      delay = Math.min(delay * 2, RATE_LIMIT_MAX_DELAY_MS);
    }
  }
  throw new Error("Unreachable");
}

// ─── Start Run ─────────────────────────────────────────────────────────────

export interface StartRunOptions {
  strategy: PromptStrategy;
  model: string;
  region: string;
  provider?: LLMProviderName;
  waitUntil?: WaitUntil;
  datasetFilter?: string[]; // optional transcript IDs to filter
  force?: boolean;
}

export async function startRun(options: StartRunOptions): Promise<string> {
  const { strategy, model, datasetFilter, waitUntil } = options;

  const runId = randomUUID();
  const promptHash = computePromptHash(strategy);

  // Get transcript IDs
  let transcriptIds = await listTranscriptIds();
  if (datasetFilter && datasetFilter.length > 0) {
    transcriptIds = transcriptIds.filter((id) =>
      datasetFilter.includes(id)
    );
  }

  // Create run record
  await db.insert(evalRuns).values({
    id: runId,
    strategy,
    model,
    promptHash,
    status: "running",
    totalCases: transcriptIds.length,
    completedCases: 0,
  });

  const runPromise = processRun(runId, transcriptIds, options).catch((err) => {
    console.error(`Run ${runId} failed:`, err);
  });

  // Run asynchronously. On Netlify, waitUntil keeps this work alive after the
  // POST response returns; in a long-lived local server, normal fire-and-forget
  // behavior is fine.
  if (waitUntil) {
    waitUntil(runPromise);
  }

  return runId;
}

// ─── Resume Run ────────────────────────────────────────────────────────────

export async function resumeRun(
  runId: string,
  region: string
): Promise<void> {
  const [run] = await db
    .select()
    .from(evalRuns)
    .where(eq(evalRuns.id, runId))
    .limit(1);

  if (!run) throw new Error(`Run ${runId} not found`);
  if (run.status !== "running" && run.status !== "failed") {
    throw new Error(`Run ${runId} is ${run.status}, cannot resume`);
  }

  // Get completed case IDs
  const completedCases = await db
    .select({ transcriptId: evalCases.transcriptId })
    .from(evalCases)
    .where(
      and(eq(evalCases.runId, runId), eq(evalCases.status, "completed"))
    );

  const completedSet = new Set(completedCases.map((c) => c.transcriptId));
  const allIds = await listTranscriptIds();
  const remaining = allIds.filter((id) => !completedSet.has(id));

  if (remaining.length === 0) {
    await db
      .update(evalRuns)
      .set({ status: "completed" })
      .where(eq(evalRuns.id, runId));
    return;
  }

  await db
    .update(evalRuns)
    .set({ status: "running" })
    .where(eq(evalRuns.id, runId));

  processRun(runId, remaining, {
    strategy: run.strategy as PromptStrategy,
    model: run.model,
    region,
    provider: detectProviderFromEnv() ?? undefined,
  }).catch((err) => {
    console.error(`Resume of run ${runId} failed:`, err);
  });
}

// ─── Process Run (internal) ────────────────────────────────────────────────

async function processRun(
  runId: string,
  transcriptIds: string[],
  options: StartRunOptions
): Promise<void> {
  const { strategy, model, region, provider, force = false } = options;
  const semaphore = new Semaphore(MAX_CONCURRENT_CASES);
  const startTime = Date.now();

  let totalInputTokens = 0;
  let totalOutputTokens = 0;
  let completedCount = 0;

  emitEvent(runId, {
    type: "run_started",
    run_id: runId,
    total_cases: transcriptIds.length,
  });

  const allCaseData: Array<{
    scores: CaseScores | null;
    schemaValid: boolean;
    hallucinations: HallucinationItem[];
  }> = [];

  try {
    const tasks = transcriptIds.map(async (transcriptId) => {
      await semaphore.acquire();
      try {
        // Check idempotency
        if (!force) {
          const [existing] = await db
            .select()
            .from(evalCases)
            .where(
              and(
                eq(evalCases.runId, runId),
                eq(evalCases.transcriptId, transcriptId),
                eq(evalCases.status, "completed")
              )
            )
            .limit(1);

          if (existing) {
            completedCount++;
            allCaseData.push({
              scores: existing.scores as CaseScores | null,
              schemaValid: existing.schemaValid ?? true,
              hallucinations: (existing.hallucinations as HallucinationItem[]) ?? [],
            });
            return;
          }
        }

        // Load data
        const transcript = await loadTranscript(transcriptId);
        const gold = await loadGold(transcriptId);

        // Create case record
        const caseId = randomUUID();
        await db.insert(evalCases).values({
          id: caseId,
          runId,
          transcriptId,
          status: "running",
          gold: gold as unknown as Record<string, unknown>,
        });

        // Extract with retry + rate limit backoff
        const result = await withRateLimitRetry(() =>
          extractWithRetry(transcript, {
            strategy,
            modelId: model,
            provider,
            region,
          })
        );

        totalInputTokens += result.totalInputTokens;
        totalOutputTokens += result.totalOutputTokens;

        // Score if we got an extraction
        let scores: CaseScores | null = null;
        let hallucinations: HallucinationItem[] = [];

        if (result.extraction) {
          scores = scoreCase(result.extraction, gold);
          hallucinations = detectHallucinations(result.extraction, transcript);
        }

        // Save traces
        for (const trace of result.attempts) {
          await db.insert(evalTraces).values({
            id: randomUUID(),
            caseId,
            attemptNumber: trace.attempt_number,
            request: trace.request as Record<string, unknown>,
            response: trace.response as Record<string, unknown>,
            inputTokens: trace.input_tokens,
            outputTokens: trace.output_tokens,
            cacheReadTokens: trace.cache_read_tokens,
            cacheWriteTokens: trace.cache_write_tokens,
            durationMs: trace.duration_ms,
            error: trace.error,
          });
        }

        // Update case record
        await db
          .update(evalCases)
          .set({
            status: "completed",
            predicted: result.extraction as unknown as Record<string, unknown>,
            scores: scores as unknown as Record<string, unknown>,
            hallucinations: hallucinations as unknown as Record<string, unknown>[],
            schemaValid: result.schemaValid,
            attemptsCount: result.attempts.length,
            inputTokens: result.totalInputTokens,
            outputTokens: result.totalOutputTokens,
            durationMs: result.attempts.reduce(
              (sum, t) => sum + t.duration_ms,
              0
            ),
          })
          .where(eq(evalCases.id, caseId));

        completedCount++;
        allCaseData.push({
          scores,
          schemaValid: result.schemaValid,
          hallucinations,
        });

        // Emit SSE event
        if (scores) {
          emitEvent(runId, {
            type: "case_complete",
            transcript_id: transcriptId,
            scores,
            completed: completedCount,
            total: transcriptIds.length,
          });
        }

        // Update run progress
        await db
          .update(evalRuns)
          .set({ completedCases: completedCount })
          .where(eq(evalRuns.id, runId));
      } catch (err) {
        console.error(`Case ${transcriptId} failed:`, err);
        // Mark case as failed but continue
        completedCount++;
        allCaseData.push({
          scores: null,
          schemaValid: false,
          hallucinations: [],
        });
      } finally {
        semaphore.release();
      }
    });

    await Promise.all(tasks);

    // Compute final aggregates
    const aggregates = computeAggregates(allCaseData);
    const wallTimeMs = Date.now() - startTime;
    const totalCost = computeCost(
      totalInputTokens,
      totalOutputTokens,
      model
    );

    await db
      .update(evalRuns)
      .set({
        status: "completed",
        completedCases: completedCount,
        aggregateScores: aggregates as unknown as Record<string, unknown>,
        totalTokens: {
          input_tokens: totalInputTokens,
          output_tokens: totalOutputTokens,
          total_tokens: totalInputTokens + totalOutputTokens,
        } as unknown as Record<string, unknown>,
        totalCostUsd: Math.round(totalCost * 10000) / 10000,
        wallTimeMs,
      })
      .where(eq(evalRuns.id, runId));

    emitEvent(runId, {
      type: "run_complete",
      run_id: runId,
      aggregates,
    });
  } catch (err: unknown) {
    const errorMsg = err instanceof Error ? err.message : String(err);
    await db
      .update(evalRuns)
      .set({ status: "failed" })
      .where(eq(evalRuns.id, runId));

    emitEvent(runId, {
      type: "run_error",
      run_id: runId,
      error: errorMsg,
    });
  }
}
