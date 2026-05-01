// ─── Pricing (per 1M tokens, USD) ──────────────────────────────────────────
// Claude 3 Haiku via Bedrock
export const HAIKU_INPUT_PRICE_PER_1M = 0.25;
export const HAIKU_OUTPUT_PRICE_PER_1M = 1.25;
export const HAIKU_CACHE_WRITE_PRICE_PER_1M = 0.30;
export const HAIKU_CACHE_READ_PRICE_PER_1M = 0.03;
// Claude Haiku 4.5 (flat per 1M tokens)
export const HAIKU_45_TOTAL_PRICE_PER_1M = 5;

// ─── Concurrency ───────────────────────────────────────────────────────────
export const MAX_CONCURRENT_CASES = 5;
export const MAX_RETRY_ATTEMPTS = 3;
export const RATE_LIMIT_BASE_DELAY_MS = 500;
export const RATE_LIMIT_MAX_DELAY_MS = 16_000;

// ─── Evaluation Fields ─────────────────────────────────────────────────────
export const EVAL_FIELDS = [
  "chief_complaint",
  "vitals",
  "medications",
  "diagnoses",
  "plan",
  "follow_up",
] as const;

// ─── Fuzzy Match Thresholds ────────────────────────────────────────────────
export const FUZZY_THRESHOLD_MED_NAME = 80; // fuzzball score 0-100
export const FUZZY_THRESHOLD_DIAGNOSIS = 80;
export const FUZZY_THRESHOLD_PLAN = 70;
export const FUZZY_THRESHOLD_CHIEF = 60;

// ─── Vitals Tolerances ─────────────────────────────────────────────────────
export const TEMP_TOLERANCE_F = 0.2;

// ─── Frequency Aliases ─────────────────────────────────────────────────────
export const FREQUENCY_ALIASES: Record<string, string> = {
  bid: "twice daily",
  tid: "three times daily",
  qid: "four times daily",
  qd: "once daily",
  "q.d.": "once daily",
  "b.i.d.": "twice daily",
  "t.i.d.": "three times daily",
  "q.i.d.": "four times daily",
  prn: "as needed",
  "q4h": "every 4 hours",
  "q6h": "every 6 hours",
  "q8h": "every 8 hours",
  "q12h": "every 12 hours",
  qhs: "at bedtime",
  daily: "once daily",
};
