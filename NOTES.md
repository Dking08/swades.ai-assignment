# HEALOSBENCH — Implementation Notes

## Final Note for Evaluators

### Brief Project Description

HEALOSBENCH is a repeatable evaluation harness for LLM-powered structured clinical extraction. It loads synthetic doctor-patient transcripts, forces the model to produce schema-conformant JSON, retries invalid outputs with validation feedback, scores each extraction against gold labels with field-appropriate metrics, persists run/case/trace data, and exposes a dashboard for inspecting runs and comparing prompt strategies.

The core workflow is:
1. Select a prompt strategy (`zero_shot`, `few_shot`, or `cot`)
2. Run the extractor over selected or full transcript sets
3. Validate and retry outputs through tool/function calling
4. Score predictions against gold standards
5. Review aggregate scores, case-level failures, hallucination flags, and LLM traces in the dashboard

### Provider Choice Note

I initially implemented Amazon Bedrock support because direct Claude Haiku access through Anthropic requires paid API funds, while I already had AWS credits available. Using Bedrock let me build and test the Claude/Haiku path without spending additional personal funds. The project also supports direct Anthropic and Gemini providers through the same provider interface, so the evaluator can choose whichever credential path is easiest to run.

### Tech Stack Used

| Layer | Technology |
|---|---|
| Language/runtime | TypeScript, Bun |
| Monorepo/build | Bun workspaces, Turborepo |
| Backend API | Hono |
| Frontend | Next.js 16, React 19 |
| Styling/UI | Tailwind CSS v4, shadcn-style shared UI primitives, lucide-react |
| Database | PostgreSQL, Drizzle ORM |
| Auth | better-auth |
| LLM providers | Amazon Bedrock, Anthropic SDK, Google Gemini |
| Validation/eval | AJV JSON Schema validation, fuzzball fuzzy matching |
| Testing | Bun test |
| Deployment config | Netlify config for the web dashboard |

### Additional Notes / Instructions to Run

Required local services:
- PostgreSQL must be running
- `apps/server/.env` must include `DATABASE_URL`, auth config, CORS config, and at least one LLM provider key
- `apps/web/.env` should set `NEXT_PUBLIC_SERVER_URL=http://localhost:3000`

Local setup:

```bash
bun install
docker compose up -d
bun run db:push
bun run dev
```

Useful commands:

```bash
# CLI eval
bun run eval -- --strategy=zero_shot
bun run eval -- --strategy=few_shot --filter=case_001,case_002,case_003
bun run eval -- --strategy=zero_shot --filter=case_001,case_002 --dry-run

# Tests and checks
bun test tests/
bun run check-types
bun run build
```

Ports:
- API server: `http://localhost:3000`
- Dashboard: `http://localhost:3001`

### Netlify Deployment Notes

I added `netlify.toml` for deploying the Next.js dashboard. Netlify should build the web app with:

```bash
bun run build:web
```

and publish:

```bash
apps/web/.next
```

Important: this repository has a separate Hono API server that performs database writes, SSE streaming, and LLM calls. The dashboard can be hosted on Netlify, but the API should be deployed separately on a Node/Bun-capable server or container platform with PostgreSQL access. In Netlify, set:

```env
NEXT_PUBLIC_SERVER_URL=https://your-api-host.example.com
```

Do not put LLM provider keys in Netlify frontend environment variables. LLM keys belong only in the server/API deployment.

## Hard Requirements Compliance

### 1. Tool Use / Structured Output (✅)

We **never** `JSON.parse` raw model text. All three providers use native forced tool use:

| Provider | API | Forced Tool Use Mechanism |
|----------|-----|--------------------------|
| **Bedrock** | `ConverseCommand` | `toolChoice: { tool: { name: "extract_clinical_data" } }` |
| **Anthropic** | `messages.create` | `tool_choice: { type: "tool", name: "extract_clinical_data" }` |
| **Gemini** | `models.generateContent` | `toolConfig.functionCallingConfig.mode: "ANY"` + `allowedFunctionNames` |

The model is **forced** to call the `extract_clinical_data` tool. The structured JSON comes directly from the tool call result (`toolUse.input` / `toolUseBlock.input` / `fc.args`), never from parsing model text.

**Files**: `packages/llm/src/providers/bedrock.ts`, `anthropic.ts`, `gemini.ts`

---

### 2. Retry-with-Error-Feedback Loop (✅)

Capped at `MAX_RETRY_ATTEMPTS = 3` (defined in `packages/shared/src/constants.ts`).

The loop in `extract.ts` works as follows:
1. **Attempt 1**: Call `provider.callWithToolUse()` — forces a tool call
2. **If schema validation fails**: Call `provider.callWithRetryFeedback()` which:
   - Includes the previous assistant response in conversation context
   - Sends a `tool_result` with `status: "error"` (Anthropic/Bedrock) or appends the error as a user message (Gemini)
   - Forces the model to try again
3. **All attempts logged**: Every attempt creates a `TraceRecord` with `attempt_number`, tokens, duration, and error — persisted to `eval_traces` in PostgreSQL

**Files**: `packages/llm/src/extract.ts` lines 192-330

---

### 3. Prompt Caching (✅)

Implemented via Anthropic's `cache_control: { type: "ephemeral" }` on:
- **System prompt** (clinical extraction instructions — identical across all cases)
- **Tool definition** (the `extract_clinical_data` schema — identical across all cases)

```typescript
system: [{
  type: "text",
  text: system,
  cache_control: { type: "ephemeral" },
}],
tools: [{
  name: toolSchema.name,
  // ...
  cache_control: { type: "ephemeral" },
}],
```

The first request in a run writes ~1500 tokens to cache. Subsequent requests read from cache, saving ~90% of system+tool input tokens. Cache tokens are tracked per-trace:
- `cache_read_input_tokens` → `traceRecord.cache_read_tokens`
- `cache_creation_input_tokens` → `traceRecord.cache_write_tokens`

These are visible in the dashboard's case detail trace inspector and persisted to `eval_traces.cache_read_tokens` / `cache_write_tokens`.

For Bedrock and Gemini, caching is handled at the infrastructure level (not client-side), so these fields are 0.

**File**: `packages/llm/src/providers/anthropic.ts`

---

### 4. Concurrency Control & 429 Strategy (✅)

#### Concurrency: Semaphore (not `Promise.all`)

We use a custom `Semaphore` class that limits concurrent in-flight cases to `MAX_CONCURRENT_CASES = 5`:

```typescript
class Semaphore {
  private permits: number;
  private waiters: Array<() => void> = [];
  
  async acquire() { /* blocks if no permits */ }
  release() { /* wakes next waiter */ }
}
```

Each case calls `semaphore.acquire()` before starting and `semaphore.release()` in a `finally` block. This means at most 5 LLM calls are in-flight simultaneously — the rest queue.

#### Rate Limit (429) Handling: Exponential Backoff with Jitter

When any provider returns a rate limit error, the `withRateLimitRetry` wrapper catches it and retries with exponential backoff:

```
Attempt 0: immediate
Attempt 1: 500ms + jitter (±30%)
Attempt 2: 1000ms + jitter
Attempt 3: 2000ms + jitter
Attempt 4: 4000ms + jitter
Attempt 5: 8000ms + jitter (capped at 16s max)
```

**Rate limit detection** covers all three providers:
- Anthropic/Bedrock: `ThrottlingException`, `429`, `Too many requests`, `Rate exceeded`
- Gemini: `RESOURCE_EXHAUSTED`

If a 429 persists after 5 retries, the error bubbles up and the case is marked as failed (but doesn't crash the entire run — other cases continue).

**File**: `apps/server/src/services/runner.service.ts` lines 37-132

---

### 5. Resumable Runs (✅)

The `resumeRun()` function:
1. Loads the run from the DB
2. Queries `eval_cases` for all `status = "completed"` cases
3. Computes the set difference: `remaining = allTranscriptIds - completedSet`
4. Re-starts processing only the remaining cases

If the server crashes mid-run, the run stays in `"running"` status. On restart, calling `POST /api/v1/runs/:id/resume` picks up exactly where it left off.

**Idempotency**: Each case checks for an existing `(runId, transcriptId, status="completed")` record before processing. `force=true` bypasses this check.

**Test**: `tests/resumability.test.ts` (3 tests: set difference, empty set, all completed)

**File**: `apps/server/src/services/runner.service.ts` lines 179-226

---

### 6. Per-Field Metrics Matched to Field Type (✅)

| Field | Type | Scoring Method |
|-------|------|---------------|
| `chief_complaint` | Free text | **Fuzzy**: `fuzzball.token_set_ratio` (threshold: 60) |
| `vitals.bp` | String | **Exact** string match (after trim) |
| `vitals.hr`, `vitals.spo2` | Integer | **Exact** integer match |
| `vitals.temp_f` | Float | **Numeric-tolerant**: ±0.2°F tolerance |
| `medications` | Array of objects | **Set-F1**: fuzzy name match (≥80) + exact dose + normalized frequency |
| `diagnoses` | Array of objects | **Set-F1**: fuzzy description match (≥80) + ICD-10 bonus |
| `plan` | Array of strings | **Set-F1**: fuzzy item match (≥70) |
| `follow_up.interval_days` | Integer | **Exact** integer match |
| `follow_up.reason` | Free text | **Fuzzy**: `fuzzball.token_set_ratio` |

Frequency normalization handles aliases: `bid` → `twice daily`, `q6h` → `every 6 hours`, etc.

**File**: `apps/server/src/services/evaluate.service.ts` lines 45-217

---

### 7. Hallucination Detection (✅)

**Method**: Substring + fuzzy grounding check against the transcript.

For each predicted value, we check if it appears in the transcript:

1. **Chief complaint**: Extract key terms (words > 3 chars) and check if any appear in the transcript
2. **Medications**: Check if normalized drug name is a substring of the transcript OR `fuzzball.partial_ratio ≥ 85`
3. **Diagnoses**: Check if key terms from the diagnosis description appear in the transcript OR `partial_ratio ≥ 75`
4. **Vitals (BP)**: Check if the exact BP string appears in the transcript

Flagged items are stored per-case as `HallucinationItem[]` with `{ field, value, reason }` and the per-run hallucination rate is computed in aggregates.

**File**: `apps/server/src/services/evaluate.service.ts` lines 240-300

---

### 8. Compare View (✅)

The compare view (`/evals/compare?runA=X&runB=Y`) shows:

- **Per-field deltas with winner**: For each of the 6 fields + overall, shows Run A score, Run B score, delta, and winner badge (↑ green / ↓ red / = tie)
- **Per-case breakdown**: Lists every transcript with its overall F1 in both runs and the delta
- Threshold: winner requires delta > 0.005 to avoid noise

**API**: `GET /api/v1/compare?runA=...&runB=...`
**Dashboard**: `apps/web/src/app/evals/compare/page.tsx`

---

### 9. Test Suite (✅ — 40 tests across 10 files)

| # | Test File | Tests | Requirement |
|---|-----------|-------|-------------|
| 1 | `schema-validation-retry.test.ts` | 2 | Schema-validation retry path |
| 2 | `fuzzy-med-matching.test.ts` | 7 | Fuzzy medication matching |
| 3 | `set-f1-correctness.test.ts` | 3 | Set-F1 correctness on synthetic case |
| 4 | `hallucination-detector-positive.test.ts` | 2 | Hallucination detector positive |
| 5 | `hallucination-detector-negative.test.ts` | 2 | Hallucination detector negative |
| 6 | `resumability.test.ts` | 3 | Resumability (set difference) |
| 7 | `idempotency.test.ts` | 3 | Idempotency (composite key) |
| 8 | `rate-limit-backoff.test.ts` | 4 | Rate-limit backoff (mock SDK) |
| 9 | `prompt-hash-stability.test.ts` | 3 | Prompt-hash stability |
| 10 | `multi-provider.test.ts` | 11 | Multi-provider detection |

Run all: `bun test tests/`

---

### 10. No API Key Leaking (✅)

- The **web app** (`apps/web`) is a Next.js client that only talks to the Hono server at `http://localhost:3000`
- The `.env` file with API keys lives in `apps/server/.env` — the server process reads it
- All LLM calls happen server-side in `packages/llm/src/providers/`
- The web app has **zero** imports from `@test-evals/llm` or any SDK package
- API responses never expose raw API keys — they expose run IDs, scores, and traces

---

## Commands Reference

```bash
# Start PostgreSQL
docker compose up -d

# Push DB schema
bun run db:push

# Start API server (port 3000)
bun run dev:server

# Start dashboard (port 3001)
bun run dev:web

# Start BOTH server + dashboard simultaneously
bun run dev

# Run evaluation via CLI
bun run eval -- --strategy=zero_shot
bun run eval -- --strategy=cot --model=gemini-3.1-flash-lite-preview
bun run eval -- --strategy=few_shot --filter=case_001,case_002,case_003

# Run tests
bun test tests/

# View DB (Drizzle Studio)
bun run db:studio
```
