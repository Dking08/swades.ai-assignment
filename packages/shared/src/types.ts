// ─── Prompt Strategy ───────────────────────────────────────────────────────
export type PromptStrategy = "zero_shot" | "few_shot" | "cot";

export const PROMPT_STRATEGIES: PromptStrategy[] = [
  "zero_shot",
  "few_shot",
  "cot",
];

// ─── Run Status ────────────────────────────────────────────────────────────
export type RunStatus =
  | "pending"
  | "running"
  | "completed"
  | "failed"
  | "cancelled";

// ─── Clinical Extraction Schema ────────────────────────────────────────────
export interface Vitals {
  bp: string | null;
  hr: number | null;
  temp_f: number | null;
  spo2: number | null;
}

export interface Medication {
  name: string;
  dose: string | null;
  frequency: string | null;
  route: string | null;
}

export interface Diagnosis {
  description: string;
  icd10?: string;
}

export interface FollowUp {
  interval_days: number | null;
  reason: string | null;
}

export interface ClinicalExtraction {
  chief_complaint: string;
  vitals: Vitals;
  medications: Medication[];
  diagnoses: Diagnosis[];
  plan: string[];
  follow_up: FollowUp;
}

// ─── Per-Field Scores ──────────────────────────────────────────────────────
export interface SetScore {
  precision: number;
  recall: number;
  f1: number;
}

export interface CaseScores {
  chief_complaint: number;
  vitals: number;
  medications: SetScore;
  diagnoses: SetScore & { icd10_accuracy: number };
  plan: SetScore;
  follow_up: number;
}

export interface HallucinationItem {
  field: string;
  value: string;
  reason: string;
}

export interface CaseResult {
  transcript_id: string;
  scores: CaseScores;
  hallucinations: HallucinationItem[];
  schema_valid: boolean;
  attempts_count: number;
}

// ─── Token Usage ───────────────────────────────────────────────────────────
export interface TokenUsage {
  input_tokens: number;
  output_tokens: number;
  total_tokens: number;
}

// ─── Trace (one LLM attempt) ──────────────────────────────────────────────
export interface TraceRecord {
  attempt_number: number;
  request: unknown;
  response: unknown;
  input_tokens: number;
  output_tokens: number;
  cache_read_tokens: number;
  cache_write_tokens: number;
  duration_ms: number;
  error: string | null;
}

// ─── Run Aggregates ────────────────────────────────────────────────────────
export interface RunAggregates {
  chief_complaint_avg: number;
  vitals_avg: number;
  medications_f1_avg: number;
  diagnoses_f1_avg: number;
  plan_f1_avg: number;
  follow_up_avg: number;
  overall_f1: number;
  schema_failure_rate: number;
  hallucination_rate: number;
}

// ─── DTOs ──────────────────────────────────────────────────────────────────
export interface RunSummaryDTO {
  id: string;
  strategy: PromptStrategy;
  model: string;
  prompt_hash: string;
  status: RunStatus;
  total_cases: number;
  completed_cases: number;
  aggregates: RunAggregates | null;
  total_tokens: TokenUsage | null;
  total_cost_usd: number | null;
  wall_time_ms: number | null;
  created_at: string;
}

export interface CaseDetailDTO {
  id: string;
  run_id: string;
  transcript_id: string;
  status: string;
  predicted: ClinicalExtraction | null;
  gold: ClinicalExtraction;
  scores: CaseScores | null;
  hallucinations: HallucinationItem[];
  schema_valid: boolean;
  attempts_count: number;
  traces: TraceRecord[];
  transcript_text: string;
}

export interface CompareFieldDelta {
  field: string;
  run_a_score: number;
  run_b_score: number;
  delta: number;
  winner: "a" | "b" | "tie";
}

export interface CompareResultDTO {
  run_a: RunSummaryDTO;
  run_b: RunSummaryDTO;
  field_deltas: CompareFieldDelta[];
  per_case: Array<{
    transcript_id: string;
    run_a_overall: number;
    run_b_overall: number;
    delta: number;
  }>;
}

// ─── SSE Event Types ───────────────────────────────────────────────────────
export type SSEEvent =
  | { type: "run_started"; run_id: string; total_cases: number }
  | {
      type: "case_complete";
      transcript_id: string;
      scores: CaseScores;
      completed: number;
      total: number;
    }
  | { type: "run_complete"; run_id: string; aggregates: RunAggregates }
  | { type: "run_error"; run_id: string; error: string };
