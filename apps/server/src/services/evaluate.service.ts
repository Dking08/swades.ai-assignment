/**
 * Evaluator service — per-field scoring and hallucination detection.
 * Uses fuzzball for fuzzy string matching.
 */
import * as fuzzball from "fuzzball";
import type {
  ClinicalExtraction,
  CaseScores,
  SetScore,
  HallucinationItem,
  RunAggregates,
} from "@test-evals/shared";
import {
  FUZZY_THRESHOLD_MED_NAME,
  FUZZY_THRESHOLD_DIAGNOSIS,
  FUZZY_THRESHOLD_PLAN,
  TEMP_TOLERANCE_F,
  FREQUENCY_ALIASES,
} from "@test-evals/shared";

// ─── Text Normalization ────────────────────────────────────────────────────

function normalize(text: string | null | undefined): string {
  if (!text) return "";
  return text.toLowerCase().replace(/[^\w\s]/g, "").replace(/\s+/g, " ").trim();
}

function normalizeFrequency(freq: string | null | undefined): string {
  if (!freq) return "";
  const lower = freq.toLowerCase().trim();
  return FREQUENCY_ALIASES[lower] ?? lower;
}

function normalizeDose(dose: string | null | undefined): string {
  if (!dose) return "";
  return dose.toLowerCase().replace(/\s+/g, "").trim();
}

function fuzzyScore(a: string, b: string): number {
  if (!a && !b) return 100;
  if (!a || !b) return 0;
  return fuzzball.token_set_ratio(normalize(a), normalize(b));
}

// ─── Chief Complaint ───────────────────────────────────────────────────────

export function scoreChiefComplaint(
  pred: string,
  gold: string
): number {
  return fuzzyScore(pred, gold) / 100;
}

// ─── Vitals ────────────────────────────────────────────────────────────────

export function scoreVitals(
  pred: ClinicalExtraction["vitals"],
  gold: ClinicalExtraction["vitals"]
): number {
  let total = 0;
  let count = 4;

  // BP: exact string match (after trim)
  if (pred.bp === null && gold.bp === null) total += 1;
  else if (pred.bp !== null && gold.bp !== null && pred.bp.trim() === gold.bp.trim()) total += 1;

  // HR: exact integer match
  if (pred.hr === null && gold.hr === null) total += 1;
  else if (pred.hr === gold.hr) total += 1;

  // Temp: ±0.2°F tolerance
  if (pred.temp_f === null && gold.temp_f === null) total += 1;
  else if (
    pred.temp_f !== null &&
    gold.temp_f !== null &&
    Math.abs(pred.temp_f - gold.temp_f) <= TEMP_TOLERANCE_F
  ) total += 1;

  // SpO2: exact integer match
  if (pred.spo2 === null && gold.spo2 === null) total += 1;
  else if (pred.spo2 === gold.spo2) total += 1;

  return total / count;
}

// ─── Set-based F1 (generic) ────────────────────────────────────────────────

function computeSetF1<T>(
  predicted: T[],
  gold: T[],
  matchFn: (a: T, b: T) => boolean
): SetScore {
  if (predicted.length === 0 && gold.length === 0) {
    return { precision: 1, recall: 1, f1: 1 };
  }
  if (predicted.length === 0) {
    return { precision: 0, recall: 0, f1: 0 };
  }
  if (gold.length === 0) {
    return { precision: 0, recall: 0, f1: 0 };
  }

  const goldMatched = new Set<number>();
  let matched = 0;

  for (const p of predicted) {
    for (let gi = 0; gi < gold.length; gi++) {
      if (!goldMatched.has(gi) && matchFn(p, gold[gi]!)) {
        goldMatched.add(gi);
        matched++;
        break;
      }
    }
  }

  const precision = matched / predicted.length;
  const recall = matched / gold.length;
  const f1 =
    precision + recall > 0
      ? (2 * precision * recall) / (precision + recall)
      : 0;

  return { precision, recall, f1 };
}

// ─── Medications ───────────────────────────────────────────────────────────

export function scoreMedications(
  pred: ClinicalExtraction["medications"],
  gold: ClinicalExtraction["medications"]
): SetScore {
  return computeSetF1(pred, gold, (p, g) => {
    const nameMatch =
      fuzzyScore(p.name, g.name) >= FUZZY_THRESHOLD_MED_NAME;
    const doseMatch = normalizeDose(p.dose) === normalizeDose(g.dose);
    const freqMatch =
      normalizeFrequency(p.frequency) === normalizeFrequency(g.frequency);
    return nameMatch && doseMatch && freqMatch;
  });
}

// ─── Diagnoses ─────────────────────────────────────────────────────────────

export function scoreDiagnoses(
  pred: ClinicalExtraction["diagnoses"],
  gold: ClinicalExtraction["diagnoses"]
): SetScore & { icd10_accuracy: number } {
  let icd10Matches = 0;
  let icd10Total = 0;

  const goldMatched = new Set<number>();
  let matched = 0;

  for (const p of pred) {
    for (let gi = 0; gi < gold.length; gi++) {
      if (!goldMatched.has(gi)) {
        const descMatch =
          fuzzyScore(p.description, gold[gi]!.description) >=
          FUZZY_THRESHOLD_DIAGNOSIS;
        if (descMatch) {
          goldMatched.add(gi);
          matched++;
          // Check ICD-10
          if (gold[gi]!.icd10) {
            icd10Total++;
            if (p.icd10 && p.icd10.toUpperCase() === gold[gi]!.icd10!.toUpperCase()) {
              icd10Matches++;
            }
          }
          break;
        }
      }
    }
  }

  const precision = pred.length > 0 ? matched / pred.length : 0;
  const recall = gold.length > 0 ? matched / gold.length : 0;
  const f1 =
    precision + recall > 0
      ? (2 * precision * recall) / (precision + recall)
      : 0;
  const icd10_accuracy = icd10Total > 0 ? icd10Matches / icd10Total : 1;

  return { precision, recall, f1, icd10_accuracy };
}

// ─── Plan ──────────────────────────────────────────────────────────────────

export function scorePlan(
  pred: string[],
  gold: string[]
): SetScore {
  return computeSetF1(pred, gold, (p, g) => {
    return fuzzyScore(p, g) >= FUZZY_THRESHOLD_PLAN;
  });
}

// ─── Follow-up ─────────────────────────────────────────────────────────────

export function scoreFollowUp(
  pred: ClinicalExtraction["follow_up"],
  gold: ClinicalExtraction["follow_up"]
): number {
  let total = 0;

  // interval_days: exact match
  if (pred.interval_days === gold.interval_days) total += 1;

  // reason: fuzzy match
  if (pred.reason === null && gold.reason === null) {
    total += 1;
  } else if (pred.reason && gold.reason) {
    total += fuzzyScore(pred.reason, gold.reason) / 100;
  }

  return total / 2;
}

// ─── Full Case Scoring ─────────────────────────────────────────────────────

export function scoreCase(
  predicted: ClinicalExtraction,
  gold: ClinicalExtraction
): CaseScores {
  return {
    chief_complaint: scoreChiefComplaint(
      predicted.chief_complaint,
      gold.chief_complaint
    ),
    vitals: scoreVitals(predicted.vitals, gold.vitals),
    medications: scoreMedications(predicted.medications, gold.medications),
    diagnoses: scoreDiagnoses(predicted.diagnoses, gold.diagnoses),
    plan: scorePlan(predicted.plan, gold.plan),
    follow_up: scoreFollowUp(predicted.follow_up, gold.follow_up),
  };
}

// ─── Hallucination Detection ───────────────────────────────────────────────

export function detectHallucinations(
  predicted: ClinicalExtraction,
  transcript: string
): HallucinationItem[] {
  const hallucinations: HallucinationItem[] = [];
  const normTranscript = normalize(transcript);

  // Check chief complaint grounding
  const ccWords = normalize(predicted.chief_complaint).split(" ").filter((w) => w.length > 3);
  const ccGrounded = ccWords.some((w) => normTranscript.includes(w));
  if (!ccGrounded && predicted.chief_complaint) {
    hallucinations.push({
      field: "chief_complaint",
      value: predicted.chief_complaint,
      reason: "No key terms found in transcript",
    });
  }

  // Check medication names
  for (const med of predicted.medications) {
    const medNorm = normalize(med.name);
    const found = normTranscript.includes(medNorm) ||
      fuzzball.partial_ratio(medNorm, normTranscript) >= 85;
    if (!found) {
      hallucinations.push({
        field: "medications",
        value: med.name,
        reason: `Medication "${med.name}" not found in transcript`,
      });
    }
  }

  // Check diagnosis descriptions
  for (const dx of predicted.diagnoses) {
    const dxNorm = normalize(dx.description);
    const dxWords = dxNorm.split(" ").filter((w) => w.length > 3);
    const found = dxWords.some((w) => normTranscript.includes(w)) ||
      fuzzball.partial_ratio(dxNorm, normTranscript) >= 75;
    if (!found) {
      hallucinations.push({
        field: "diagnoses",
        value: dx.description,
        reason: `Diagnosis "${dx.description}" not grounded in transcript`,
      });
    }
  }

  // Check vitals — if predicted non-null, should appear in transcript
  if (predicted.vitals.bp && !normTranscript.includes(predicted.vitals.bp.replace("/", ""))) {
    // Check with slash too
    if (!transcript.includes(predicted.vitals.bp)) {
      hallucinations.push({
        field: "vitals.bp",
        value: predicted.vitals.bp,
        reason: "BP value not found in transcript",
      });
    }
  }

  return hallucinations;
}

// ─── Run Aggregates ────────────────────────────────────────────────────────

export function computeAggregates(
  cases: Array<{
    scores: CaseScores | null;
    schemaValid: boolean;
    hallucinations: HallucinationItem[];
  }>
): RunAggregates {
  const scored = cases.filter((c) => c.scores !== null);
  const n = scored.length || 1;

  const avg = (fn: (c: CaseScores) => number) =>
    scored.reduce((sum, c) => sum + fn(c.scores!), 0) / n;

  const chiefAvg = avg((s) => s.chief_complaint);
  const vitalsAvg = avg((s) => s.vitals);
  const medsF1Avg = avg((s) => s.medications.f1);
  const dxF1Avg = avg((s) => s.diagnoses.f1);
  const planF1Avg = avg((s) => s.plan.f1);
  const fuAvg = avg((s) => s.follow_up);

  const overallF1 =
    (chiefAvg + vitalsAvg + medsF1Avg + dxF1Avg + planF1Avg + fuAvg) / 6;

  const schemaFailures = cases.filter((c) => !c.schemaValid).length;
  const hallucinatedCases = cases.filter(
    (c) => c.hallucinations.length > 0
  ).length;

  return {
    chief_complaint_avg: Math.round(chiefAvg * 1000) / 1000,
    vitals_avg: Math.round(vitalsAvg * 1000) / 1000,
    medications_f1_avg: Math.round(medsF1Avg * 1000) / 1000,
    diagnoses_f1_avg: Math.round(dxF1Avg * 1000) / 1000,
    plan_f1_avg: Math.round(planF1Avg * 1000) / 1000,
    follow_up_avg: Math.round(fuAvg * 1000) / 1000,
    overall_f1: Math.round(overallF1 * 1000) / 1000,
    schema_failure_rate: Math.round((schemaFailures / cases.length) * 1000) / 1000,
    hallucination_rate: Math.round((hallucinatedCases / cases.length) * 1000) / 1000,
  };
}
