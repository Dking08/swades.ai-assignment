import {
  pgTable,
  text,
  timestamp,
  integer,
  boolean,
  jsonb,
  real,
  index,
} from "drizzle-orm/pg-core";
import { relations } from "drizzle-orm";

// ─── Eval Runs ─────────────────────────────────────────────────────────────
export const evalRuns = pgTable(
  "eval_runs",
  {
    id: text("id").primaryKey(),
    strategy: text("strategy").notNull(), // zero_shot | few_shot | cot
    model: text("model").notNull(),
    promptHash: text("prompt_hash").notNull(),
    status: text("status").notNull().default("pending"), // pending | running | completed | failed | cancelled
    totalCases: integer("total_cases").notNull().default(0),
    completedCases: integer("completed_cases").notNull().default(0),
    aggregateScores: jsonb("aggregate_scores"), // RunAggregates | null
    totalTokens: jsonb("total_tokens"), // TokenUsage | null
    totalCostUsd: real("total_cost_usd"),
    wallTimeMs: integer("wall_time_ms"),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at")
      .defaultNow()
      .$onUpdate(() => new Date())
      .notNull(),
  },
  (table) => [
    index("eval_runs_status_idx").on(table.status),
    index("eval_runs_strategy_idx").on(table.strategy),
  ]
);

// ─── Eval Cases ────────────────────────────────────────────────────────────
export const evalCases = pgTable(
  "eval_cases",
  {
    id: text("id").primaryKey(),
    runId: text("run_id")
      .notNull()
      .references(() => evalRuns.id, { onDelete: "cascade" }),
    transcriptId: text("transcript_id").notNull(), // e.g. "case_001"
    status: text("status").notNull().default("pending"), // pending | running | completed | failed
    predicted: jsonb("predicted"), // ClinicalExtraction | null
    gold: jsonb("gold"), // ClinicalExtraction
    scores: jsonb("scores"), // CaseScores | null
    hallucinations: jsonb("hallucinations").default("[]"), // HallucinationItem[]
    schemaValid: boolean("schema_valid").default(true),
    attemptsCount: integer("attempts_count").notNull().default(0),
    inputTokens: integer("input_tokens").default(0),
    outputTokens: integer("output_tokens").default(0),
    durationMs: integer("duration_ms"),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (table) => [
    index("eval_cases_run_id_idx").on(table.runId),
    index("eval_cases_transcript_id_idx").on(table.transcriptId),
    index("eval_cases_run_transcript_idx").on(table.runId, table.transcriptId),
  ]
);

// ─── Eval Traces (one per LLM attempt) ────────────────────────────────────
export const evalTraces = pgTable(
  "eval_traces",
  {
    id: text("id").primaryKey(),
    caseId: text("case_id")
      .notNull()
      .references(() => evalCases.id, { onDelete: "cascade" }),
    attemptNumber: integer("attempt_number").notNull(),
    request: jsonb("request"), // the prompt sent
    response: jsonb("response"), // the full model response
    inputTokens: integer("input_tokens").default(0),
    outputTokens: integer("output_tokens").default(0),
    cacheReadTokens: integer("cache_read_tokens").default(0),
    cacheWriteTokens: integer("cache_write_tokens").default(0),
    durationMs: integer("duration_ms"),
    error: text("error"),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (table) => [index("eval_traces_case_id_idx").on(table.caseId)]
);

// ─── Relations ─────────────────────────────────────────────────────────────
export const evalRunsRelations = relations(evalRuns, ({ many }) => ({
  cases: many(evalCases),
}));

export const evalCasesRelations = relations(evalCases, ({ one, many }) => ({
  run: one(evalRuns, {
    fields: [evalCases.runId],
    references: [evalRuns.id],
  }),
  traces: many(evalTraces),
}));

export const evalTracesRelations = relations(evalTraces, ({ one }) => ({
  case_: one(evalCases, {
    fields: [evalTraces.caseId],
    references: [evalCases.id],
  }),
}));
