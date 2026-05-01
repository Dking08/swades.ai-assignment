/**
 * Evaluation API routes — mounted at /api/v1
 */
import { Hono } from "hono";
import { streamSSE } from "hono/streaming";
import { eq, desc } from "drizzle-orm";
import { db } from "@test-evals/db";
import { evalRuns, evalCases, evalTraces } from "@test-evals/db/schema";
import { env } from "@test-evals/env/server";
import type {
  PromptStrategy,
  CaseScores,
  HallucinationItem,
  RunAggregates,
  TokenUsage,
  CompareFieldDelta,
} from "@test-evals/shared";
import { PROMPT_STRATEGIES } from "@test-evals/shared";
import { detectProviderFromEnv, getModelId } from "@test-evals/llm";
import {
  startRun,
  resumeRun,
  cancelRun,
  subscribeToRun,
} from "../services/runner.service";
import { loadTranscript } from "../services/dataset.service";

const runs = new Hono();

type WaitUntil = (promise: Promise<unknown>) => void;

function getWaitUntil(c: { env?: unknown }): WaitUntil | undefined {
  const netlifyContext = (c.env as { netlifyContext?: { waitUntil?: WaitUntil } } | undefined)
    ?.netlifyContext;
  return netlifyContext?.waitUntil?.bind(netlifyContext);
}

// ─── POST /runs — Start a new eval run ─────────────────────────────────────
runs.post("/runs", async (c) => {
  const body = await c.req.json<{
    strategy: PromptStrategy;
    model?: string;
    dataset_filter?: string[];
    force?: boolean;
  }>();

  if (!PROMPT_STRATEGIES.includes(body.strategy)) {
    return c.json({ error: `Invalid strategy. Must be one of: ${PROMPT_STRATEGIES.join(", ")}` }, 400);
  }

  const providerName = detectProviderFromEnv();
  if (!providerName) {
    return c.json({ error: "No LLM provider configured. Set ANTHROPIC_API_KEY, AWS_BEARER_TOKEN_BEDROCK, or GEMINI_API_KEY" }, 500);
  }

  const modelId = body.model ?? getModelId(providerName);

  const runId = await startRun({
    strategy: body.strategy,
    model: modelId,
    region: env.AWS_REGION,
    provider: providerName,
    waitUntil: getWaitUntil(c),
    datasetFilter: body.dataset_filter,
    force: body.force,
  });

  return c.json({ run_id: runId, provider: providerName, model: modelId }, 201);
});

// ─── POST /runs/:id/resume — Resume a crashed/failed run ──────────────────
runs.post("/runs/:id/resume", async (c) => {
  const runId = c.req.param("id");
  try {
    await resumeRun(runId, env.AWS_REGION ?? "us-west-2");
    return c.json({ status: "resumed" });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    return c.json({ error: msg }, 400);
  }
});

// ─── POST /runs/:id/cancel — Request cancellation of a running run ──────────
runs.post("/runs/:id/cancel", async (c) => {
  const runId = c.req.param("id");

  // Verify run exists and is actually running before flagging
  const [run] = await db
    .select({ status: evalRuns.status })
    .from(evalRuns)
    .where(eq(evalRuns.id, runId))
    .limit(1);

  if (!run) return c.json({ error: "Run not found" }, 404);
  if (run.status !== "running") {
    return c.json({ error: `Run is ${run.status}, can only cancel a running run` }, 400);
  }

  // Flag for cooperative cancellation — actual DB status update happens in processRun
  cancelRun(runId);

  return c.json({ status: "cancellation_requested", run_id: runId });
});


// ─── GET /runs — List all runs ─────────────────────────────────────────────
runs.get("/runs", async (c) => {
  const allRuns = await db
    .select()
    .from(evalRuns)
    .orderBy(desc(evalRuns.createdAt));

  return c.json(
    allRuns.map((r) => ({
      id: r.id,
      strategy: r.strategy,
      model: r.model,
      prompt_hash: r.promptHash,
      status: r.status,
      total_cases: r.totalCases,
      completed_cases: r.completedCases,
      aggregates: r.aggregateScores as RunAggregates | null,
      total_tokens: r.totalTokens as TokenUsage | null,
      total_cost_usd: r.totalCostUsd,
      wall_time_ms: r.wallTimeMs,
      created_at: r.createdAt.toISOString(),
    }))
  );
});

// ─── GET /runs/:id — Get run detail ────────────────────────────────────────
runs.get("/runs/:id", async (c) => {
  const runId = c.req.param("id");

  const [run] = await db
    .select()
    .from(evalRuns)
    .where(eq(evalRuns.id, runId))
    .limit(1);

  if (!run) return c.json({ error: "Run not found" }, 404);

  const cases = await db
    .select()
    .from(evalCases)
    .where(eq(evalCases.runId, runId))
    .orderBy(evalCases.transcriptId);

  return c.json({
    id: run.id,
    strategy: run.strategy,
    model: run.model,
    prompt_hash: run.promptHash,
    status: run.status,
    total_cases: run.totalCases,
    completed_cases: run.completedCases,
    aggregates: run.aggregateScores as RunAggregates | null,
    total_tokens: run.totalTokens as TokenUsage | null,
    total_cost_usd: run.totalCostUsd,
    wall_time_ms: run.wallTimeMs,
    created_at: run.createdAt.toISOString(),
    cases: cases.map((c) => ({
      id: c.id,
      transcript_id: c.transcriptId,
      status: c.status,
      scores: c.scores as CaseScores | null,
      schema_valid: c.schemaValid,
      attempts_count: c.attemptsCount,
      hallucination_count: ((c.hallucinations as HallucinationItem[]) ?? []).length,
    })),
  });
});

// ─── GET /runs/:id/cases/:caseId — Get single case detail ──────────────────
runs.get("/runs/:id/cases/:caseId", async (c) => {
  const caseId = c.req.param("caseId");

  const [caseRow] = await db
    .select()
    .from(evalCases)
    .where(eq(evalCases.id, caseId))
    .limit(1);

  if (!caseRow) return c.json({ error: "Case not found" }, 404);

  const traces = await db
    .select()
    .from(evalTraces)
    .where(eq(evalTraces.caseId, caseId))
    .orderBy(evalTraces.attemptNumber);

  // Load transcript text
  let transcriptText = "";
  try {
    transcriptText = await loadTranscript(caseRow.transcriptId);
  } catch {
    transcriptText = "(transcript not found)";
  }

  return c.json({
    id: caseRow.id,
    run_id: caseRow.runId,
    transcript_id: caseRow.transcriptId,
    status: caseRow.status,
    predicted: caseRow.predicted,
    gold: caseRow.gold,
    scores: caseRow.scores as CaseScores | null,
    hallucinations: (caseRow.hallucinations as HallucinationItem[]) ?? [],
    schema_valid: caseRow.schemaValid,
    attempts_count: caseRow.attemptsCount,
    transcript_text: transcriptText,
    traces: traces.map((t) => ({
      attempt_number: t.attemptNumber,
      request: t.request,
      response: t.response,
      input_tokens: t.inputTokens,
      output_tokens: t.outputTokens,
      cache_read_tokens: t.cacheReadTokens,
      cache_write_tokens: t.cacheWriteTokens,
      duration_ms: t.durationMs,
      error: t.error,
    })),
  });
});

// ─── GET /runs/:id/stream — SSE endpoint for live progress ─────────────────
runs.get("/runs/:id/stream", async (c) => {
  const runId = c.req.param("id");

  return streamSSE(c, async (stream) => {
    const unsubscribe = subscribeToRun(runId, async (event) => {
      await stream.writeSSE({
        data: JSON.stringify(event),
        event: event.type,
        id: Date.now().toString(),
      });
    });

    // Keep connection alive
    stream.onAbort(() => {
      unsubscribe();
    });

    // Send heartbeat and check if run is still active
    while (true) {
      const [run] = await db
        .select({ status: evalRuns.status })
        .from(evalRuns)
        .where(eq(evalRuns.id, runId))
        .limit(1);

      if (!run || run.status === "completed" || run.status === "failed" || run.status === "cancelled") {
        unsubscribe();
        break;
      }

      await stream.writeSSE({
        data: JSON.stringify({ type: "heartbeat" }),
        event: "heartbeat",
      });
      await stream.sleep(3000);
    }
  });
});

// ─── GET /compare — Compare two runs ───────────────────────────────────────
runs.get("/compare", async (c) => {
  const runAId = c.req.query("runA");
  const runBId = c.req.query("runB");

  if (!runAId || !runBId) {
    return c.json({ error: "runA and runB query params required" }, 400);
  }

  const [runA] = await db.select().from(evalRuns).where(eq(evalRuns.id, runAId)).limit(1);
  const [runB] = await db.select().from(evalRuns).where(eq(evalRuns.id, runBId)).limit(1);

  if (!runA || !runB) return c.json({ error: "One or both runs not found" }, 404);

  const casesA = await db.select().from(evalCases).where(eq(evalCases.runId, runAId));
  const casesB = await db.select().from(evalCases).where(eq(evalCases.runId, runBId));

  const aggA = runA.aggregateScores as RunAggregates | null;
  const aggB = runB.aggregateScores as RunAggregates | null;

  // Per-field deltas
  const fieldDeltas: CompareFieldDelta[] = [];
  if (aggA && aggB) {
    const fields: Array<{ name: string; keyA: keyof RunAggregates; keyB: keyof RunAggregates }> = [
      { name: "Chief Complaint", keyA: "chief_complaint_avg", keyB: "chief_complaint_avg" },
      { name: "Vitals", keyA: "vitals_avg", keyB: "vitals_avg" },
      { name: "Medications (F1)", keyA: "medications_f1_avg", keyB: "medications_f1_avg" },
      { name: "Diagnoses (F1)", keyA: "diagnoses_f1_avg", keyB: "diagnoses_f1_avg" },
      { name: "Plan (F1)", keyA: "plan_f1_avg", keyB: "plan_f1_avg" },
      { name: "Follow-up", keyA: "follow_up_avg", keyB: "follow_up_avg" },
      { name: "Overall", keyA: "overall_f1", keyB: "overall_f1" },
    ];

    for (const f of fields) {
      const scoreA = aggA[f.keyA] as number;
      const scoreB = aggB[f.keyB] as number;
      const delta = scoreB - scoreA;
      fieldDeltas.push({
        field: f.name,
        run_a_score: scoreA,
        run_b_score: scoreB,
        delta: Math.round(delta * 1000) / 1000,
        winner: delta > 0.005 ? "b" : delta < -0.005 ? "a" : "tie",
      });
    }
  }

  // Per-case comparison
  const caseMapA = new Map(casesA.map((c) => [c.transcriptId, c]));
  const caseMapB = new Map(casesB.map((c) => [c.transcriptId, c]));
  const allTranscriptIds = [...new Set([...caseMapA.keys(), ...caseMapB.keys()])].sort();

  const perCase = allTranscriptIds.map((tid) => {
    const cA = caseMapA.get(tid);
    const cB = caseMapB.get(tid);
    const scoresA = cA?.scores as CaseScores | null;
    const scoresB = cB?.scores as CaseScores | null;

    const overallA = scoresA
      ? (scoresA.chief_complaint + scoresA.vitals + scoresA.medications.f1 + scoresA.diagnoses.f1 + scoresA.plan.f1 + scoresA.follow_up) / 6
      : 0;
    const overallB = scoresB
      ? (scoresB.chief_complaint + scoresB.vitals + scoresB.medications.f1 + scoresB.diagnoses.f1 + scoresB.plan.f1 + scoresB.follow_up) / 6
      : 0;

    return {
      transcript_id: tid,
      run_a_overall: Math.round(overallA * 1000) / 1000,
      run_b_overall: Math.round(overallB * 1000) / 1000,
      delta: Math.round((overallB - overallA) * 1000) / 1000,
    };
  });

  const formatRun = (r: typeof runA) => ({
    id: r.id,
    strategy: r.strategy,
    model: r.model,
    prompt_hash: r.promptHash,
    status: r.status,
    total_cases: r.totalCases,
    completed_cases: r.completedCases,
    aggregates: r.aggregateScores as RunAggregates | null,
    total_tokens: r.totalTokens as TokenUsage | null,
    total_cost_usd: r.totalCostUsd,
    wall_time_ms: r.wallTimeMs,
    created_at: r.createdAt.toISOString(),
  });

  return c.json({
    run_a: formatRun(runA),
    run_b: formatRun(runB),
    field_deltas: fieldDeltas,
    per_case: perCase,
  });
});

export default runs;
