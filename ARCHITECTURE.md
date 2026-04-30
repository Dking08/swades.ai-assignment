# HEALOSBENCH — Architecture & Build Guide

> **Purpose**: This document gives any agent or developer a complete understanding of the project — what it is, what exists, what needs to be built, and how everything connects.

---

## 1. Project Overview

**HEALOSBENCH** is an **LLM evaluation harness** for structured clinical data extraction. 

**The workflow**:
1. Feed a doctor-patient transcript to an LLM (Claude via Amazon Bedrock)
2. The LLM extracts structured JSON (chief complaint, vitals, meds, diagnoses, plan, follow-up)
3. Compare the LLM's output against human-annotated gold standards using field-appropriate metrics
4. Display results in a dashboard with run comparison

**Key constraint**: This uses **Amazon Bedrock** (not direct Anthropic API) to access Claude models.

---

## 2. Tech Stack

| Layer | Technology | Notes |
|---|---|---|
| **Runtime** | Bun | Package manager and runtime |
| **Monorepo** | Bun workspaces + Turborepo | `turbo.json` for task orchestration |
| **Backend** | Hono (on `:8787`) | Lightweight, fast HTTP framework |
| **Frontend** | Next.js 16 (on `:3001`) | Client-only dashboard |
| **Database** | PostgreSQL + Drizzle ORM | Schema-first, type-safe |
| **Auth** | better-auth | Email/password (not required for eval task) |
| **LLM** | Amazon Bedrock (Claude) | Via `@anthropic-ai/bedrock-sdk` |
| **Styling** | Tailwind CSS v4 + shadcn/ui | Pre-configured |
| **Env** | @t3-oss/env + zod | Typed, validated environment variables |

---

## 3. Directory Structure

```
test-evals/
├── apps/
│   ├── server/                    # Hono backend (port 8787)
│   │   ├── src/
│   │   │   ├── index.ts           # ✅ Entry point (basic, needs extension)
│   │   │   └── services/          # ❌ TO BUILD: extract, evaluate, runner
│   │   ├── .env                   # ❌ Needs AWS creds, DATABASE_URL, etc.
│   │   └── package.json
│   └── web/                       # Next.js dashboard (port 3001)
│       ├── src/
│       │   ├── app/               # ✅ Layout + login pages exist
│       │   │   ├── dashboard/     # ❌ TO BUILD: runs list, run detail, compare
│       │   │   └── login/         # ✅ Exists
│       │   ├── components/        # ✅ Basic components (header, auth forms)
│       │   └── lib/               # ✅ Auth client
│       └── package.json
├── packages/
│   ├── auth/                      # ✅ better-auth setup (can ignore for eval)
│   ├── config/                    # ✅ Shared TS config
│   ├── db/                        # ✅ Drizzle ORM setup
│   │   └── src/schema/
│   │       ├── auth.ts            # ✅ Auth tables (user, session, account, verification)
│   │       └── index.ts           # ❌ Needs eval-specific tables (runs, cases, results)
│   ├── env/                       # ✅ Typed env loading
│   │   └── src/
│   │       ├── server.ts          # ⚠️ Needs AWS env vars added
│   │       └── web.ts             # ✅ Has NEXT_PUBLIC_SERVER_URL
│   ├── ui/                        # ✅ shadcn/ui components
│   ├── llm/                       # ❌ TO CREATE: Bedrock client, prompts, retry logic
│   └── shared/                    # ❌ TO CREATE: DTOs, schema types
├── data/
│   ├── transcripts/               # ✅ 50 synthetic transcripts (case_001.txt - case_050.txt)
│   ├── gold/                      # ✅ 50 gold-standard extractions (case_001.json - case_050.json)
│   └── schema.json                # ✅ JSON Schema for extraction output
├── scripts/                       # ❌ TO CREATE: CLI eval, test scripts
├── package.json                   # ✅ Root workspace config
├── turbo.json                     # ✅ Task pipeline
├── tsconfig.json                  # ✅ Root TS config
└── bts.jsonc                      # ✅ Better-T-Stack metadata (safe to ignore)
```

---

## 4. Data Schema

The extraction JSON schema (`data/schema.json`) defines what the LLM must produce:

```typescript
interface ClinicalExtraction {
  chief_complaint: string;                    // Patient's reason for visit
  vitals: {
    bp: string | null;                        // e.g. "128/82"
    hr: number | null;                        // beats per minute (20-250)
    temp_f: number | null;                    // Fahrenheit (90-110)
    spo2: number | null;                      // percent (50-100)
  };
  medications: Array<{
    name: string;
    dose: string | null;
    frequency: string | null;
    route: string | null;                     // PO, IV, IM, topical, etc.
  }>;
  diagnoses: Array<{
    description: string;
    icd10?: string;                           // e.g. "J06.9"
  }>;
  plan: string[];                             // Action items
  follow_up: {
    interval_days: number | null;             // 0-730
    reason: string | null;
  };
}
```

> ⚠️ **Do NOT modify** `data/gold/*.json` or `data/schema.json`. You may add more transcripts.

---

## 5. What Needs to Be Built

### 5.1 `packages/llm` — LLM Client Package (NEW)

A thin wrapper around `@anthropic-ai/bedrock-sdk` providing:

- **Client initialization** with AWS Bedrock credentials
- **3 prompt strategies** (swappable modules):
  - `zero_shot` — Direct extraction instruction
  - `few_shot` — Includes example transcript→JSON pairs
  - `cot` (chain-of-thought) — Step-by-step reasoning before extraction
- **Tool use / structured output** — Must use Anthropic tool_use to force schema-conformant output (no raw JSON.parse)
- **Retry loop** — If output fails JSON Schema validation, send errors back to model for self-correction (max 3 attempts, all logged)
- **Prompt caching** — System prompt + few-shot examples must be cache-controlled; verify via `cache_read_input_tokens`
- **Prompt hashing** — Content hash of prompt for reproducibility

```typescript
// Desired interface
import { AnthropicBedrock } from '@anthropic-ai/bedrock-sdk';

const client = new AnthropicBedrock({
  awsRegion: 'us-west-2',  // or configured region
  // AWS_BEARER_TOKEN_BEDROCK
});

// Same API as direct Anthropic SDK:
const response = await client.messages.create({
  model: ' us.anthropic.claude-haiku-4-5-20251001-v1:0',
  max_tokens: 4096,
  tools: [extractionTool],
  messages: [...],
});
```

### 5.2 `packages/shared` — Shared Types (NEW)

- Extraction schema TypeScript types
- Run/Result DTOs for server↔web communication
- Prompt strategy enum
- Run status enum

### 5.3 `apps/server/src/services/extract.service.ts` (NEW)

- Takes transcript + prompt strategy → returns extracted JSON
- Calls `packages/llm` with the selected strategy
- Implements retry-with-error-feedback loop

### 5.4 `apps/server/src/services/evaluate.service.ts` (NEW)

Per-field scoring with appropriate metrics:

| Field | Metric |
|---|---|
| `chief_complaint` | Fuzzy string match (token-set ratio). Score ∈ [0, 1] |
| `vitals.*` | Exact match per sub-field, ±0.2°F tolerance for temp_f. Averaged. |
| `medications` | Set-based P/R/F1. Two meds match if name fuzzy-matches AND dose+frequency agree after normalization |
| `diagnoses` | Set-based F1 by description fuzzy match. Bonus for ICD-10 match |
| `plan` | Set-based F1 on plan items, fuzzy-matched |
| `follow_up` | Exact match on interval_days, fuzzy on reason |

Also detects:
- Schema-invalid outputs that escaped retry loop
- **Hallucinated fields** — values not grounded in the transcript

### 5.5 `apps/server/src/services/runner.service.ts` (NEW)

- `POST /api/v1/runs` — starts a run with `{ strategy, model, dataset_filter? }`
- Concurrent execution (up to 5 cases in-flight) with rate-limit handling (token-bucket/semaphore)
- SSE progress streaming to dashboard
- **Resumable**: crash-tolerant, `POST /api/v1/runs/:id/resume`
- **Idempotent**: same `{ strategy, model, transcript_id }` returns cached result unless `force=true`

### 5.6 Dashboard (`apps/web/`) — Views to Build

1. **Runs List** — All runs with strategy, model, aggregate F1, cost, duration, status
2. **Run Detail** — Table of 50 cases with per-case scores; click into a case to see:
   - Transcript (highlighted where predictions are grounded)
   - Gold vs Predicted JSON side-by-side with field-level diff
   - Full LLM trace (all retry attempts, requests/responses, cache stats)
3. **Compare View** ⭐ — Pick 2 runs, see per-field score deltas with winner breakdown. **This is the most important screen.**

### 5.7 Database Schema — Eval Tables (NEW)

Need tables for: `runs`, `run_cases`, `case_results`, `llm_traces`

### 5.8 CLI Eval Command (NEW)

```bash
bun run eval -- --strategy=cot --model= us.anthropic.claude-haiku-4-5-20251001-v1:0
```

Runs a full 50-case eval without the dashboard, prints summary table to stdout.

### 5.9 Tests (8+ required)

1. Schema-validation retry path
2. Fuzzy medication matching
3. Set-F1 correctness on synthetic case
4. Hallucination detector (positive + negative)
5. Resumability
6. Idempotency
7. Rate-limit backoff (mock SDK)
8. Prompt-hash stability

---

## 6. LLM Integration — Amazon Bedrock

### Package: `@anthropic-ai/bedrock-sdk`

This is Anthropic's official Bedrock adapter — same API surface as the direct SDK but routes through AWS Bedrock.

### Environment Variables (in `apps/server/.env`)

```env
AWS_BEARER_TOKEN_BEDROCK=value
AWS_REGION=us-west-2
```

### Model ID

Original spec uses `claude-haiku-4-5-20251001`. On Bedrock, this becomes:
```
 us.anthropic.claude-haiku-4-5-20251001-v1:0
```

### Key Differences from Direct Anthropic API

| Feature | Direct Anthropic | Bedrock |
|---|---|---|
| Authentication | API key | AWS IAM credentials |
| Rate limiting | Anthropic rate limits | AWS account limits |
| Pricing | Anthropic pricing | AWS Bedrock pricing |
| Prompt caching | `cache_control` blocks | Same API, Bedrock-managed |
| Tool use | Identical | Identical |
| Model IDs | `claude-haiku-4-5-20251001` | ` us.anthropic.claude-haiku-4-5-20251001-v1:0` |

---

## 7. Commands Reference

```bash
# Install dependencies
bun install

# Development (runs both web + server)
bun run dev

# Individual services
bun run dev:web     # Next.js on :3001
bun run dev:server  # Hono on :8787

# Database
bun run db:push     # Push schema to Postgres
bun run db:studio   # Open Drizzle Studio
bun run db:generate # Generate migrations
bun run db:migrate  # Run migrations

# CLI Eval (TO BE BUILT)
bun run eval -- --strategy=zero_shot
```

---

## 8. Hard Requirements Checklist

- [ ] **Tool use / structured output** — No raw `JSON.parse` of model text
- [ ] **Retry-with-error-feedback** loop (max 3 attempts, all logged)
- [ ] **Prompt caching** — verified via `cache_read_input_tokens`
- [ ] **Concurrency control** — semaphore/token-bucket, not `Promise.all`
- [ ] **Resumable runs** — crash-tolerant with resume endpoint
- [ ] **Per-field metrics** — exact, fuzzy, numeric-tolerant, set-F1
- [ ] **Hallucination detection** — grounding check against transcript
- [ ] **Compare view** — per-field deltas with winner
- [ ] **8+ tests** covering critical paths
- [ ] **No API key leakage** to browser — web→Hono→Bedrock only

---

## 9. Budget Constraint

A full 50-case Haiku run on all three strategies should cost **under $1**. If not, caching or prompt design needs work.

---

## 10. Stretch Goals (optional, only if time permits)

- Prompt diff view (what changed between prompt versions, which cases regressed)
- Active-learning hint (5 cases with highest strategy disagreement)
- Cost guardrail (refuse runs exceeding configurable cost cap)
- Second model (e.g. Sonnet 4.6) for cross-model comparison
