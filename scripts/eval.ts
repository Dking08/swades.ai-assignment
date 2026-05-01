/**
 * CLI Eval command — runs a full evaluation without the server/dashboard.
 *
 * Usage:
 *   bun run eval -- --strategy=zero_shot
 *   bun run eval -- --strategy=cot --filter=case_001,case_002
 */
import * as dotenv from "dotenv";
import * as path from "path";
import { readdir, readFile } from "fs/promises";
import { extractWithRetry, detectProviderFromEnv, getModelId } from "@test-evals/llm";
import type {
  PromptStrategy,
  ClinicalExtraction,
  CaseScores,
} from "@test-evals/shared";
import { PROMPT_STRATEGIES } from "@test-evals/shared";

// Load env
dotenv.config({ path: path.resolve(__dirname, "../apps/server/.env") });

// --- Inline evaluator (avoid server dependency) ---
// We inline scoring here to avoid importing from the server app
import * as fuzzball from "fuzzball";

function normalize(text: string | null | undefined): string {
  if (!text) return "";
  return text.toLowerCase().replace(/[^\w\s]/g, "").replace(/\s+/g, " ").trim();
}

function fuzzyScore(a: string, b: string): number {
  if (!a && !b) return 100;
  if (!a || !b) return 0;
  return fuzzball.token_set_ratio(normalize(a), normalize(b));
}

function scoreCase(pred: ClinicalExtraction, gold: ClinicalExtraction): CaseScores {
  // Chief complaint
  const cc = fuzzyScore(pred.chief_complaint, gold.chief_complaint) / 100;

  // Vitals
  let vTotal = 0;
  if (pred.vitals.bp === gold.vitals.bp || (pred.vitals.bp?.trim() === gold.vitals.bp?.trim())) vTotal++;
  if (pred.vitals.hr === gold.vitals.hr) vTotal++;
  if (pred.vitals.temp_f === null && gold.vitals.temp_f === null) vTotal++;
  else if (pred.vitals.temp_f !== null && gold.vitals.temp_f !== null && Math.abs(pred.vitals.temp_f - gold.vitals.temp_f) <= 0.2) vTotal++;
  if (pred.vitals.spo2 === gold.vitals.spo2) vTotal++;
  const vitals = vTotal / 4;

  // Medications (simplified F1)
  let medMatched = 0;
  const goldUsed = new Set<number>();
  for (const p of pred.medications) {
    for (let gi = 0; gi < gold.medications.length; gi++) {
      if (!goldUsed.has(gi) && fuzzyScore(p.name, gold.medications[gi]!.name) >= 80) {
        goldUsed.add(gi); medMatched++; break;
      }
    }
  }
  const medP = pred.medications.length > 0 ? medMatched / pred.medications.length : 0;
  const medR = gold.medications.length > 0 ? medMatched / gold.medications.length : 0;
  const medF1 = medP + medR > 0 ? (2 * medP * medR) / (medP + medR) : 0;

  // Diagnoses (simplified F1)
  let dxMatched = 0;
  const dxUsed = new Set<number>();
  for (const p of pred.diagnoses) {
    for (let gi = 0; gi < gold.diagnoses.length; gi++) {
      if (!dxUsed.has(gi) && fuzzyScore(p.description, gold.diagnoses[gi]!.description) >= 80) {
        dxUsed.add(gi); dxMatched++; break;
      }
    }
  }
  const dxP = pred.diagnoses.length > 0 ? dxMatched / pred.diagnoses.length : 0;
  const dxR = gold.diagnoses.length > 0 ? dxMatched / gold.diagnoses.length : 0;
  const dxF1 = dxP + dxR > 0 ? (2 * dxP * dxR) / (dxP + dxR) : 0;

  // Plan (simplified F1)
  let planMatched = 0;
  const planUsed = new Set<number>();
  for (const p of pred.plan) {
    for (let gi = 0; gi < gold.plan.length; gi++) {
      if (!planUsed.has(gi) && fuzzyScore(p, gold.plan[gi]!) >= 70) {
        planUsed.add(gi); planMatched++; break;
      }
    }
  }
  const planP = pred.plan.length > 0 ? planMatched / pred.plan.length : 0;
  const planR = gold.plan.length > 0 ? planMatched / gold.plan.length : 0;
  const planF1 = planP + planR > 0 ? (2 * planP * planR) / (planP + planR) : 0;

  // Follow-up
  let fuScore = 0;
  if (pred.follow_up.interval_days === gold.follow_up.interval_days) fuScore += 0.5;
  if (pred.follow_up.reason === null && gold.follow_up.reason === null) fuScore += 0.5;
  else if (pred.follow_up.reason && gold.follow_up.reason) fuScore += fuzzyScore(pred.follow_up.reason, gold.follow_up.reason) / 200;

  return {
    chief_complaint: Math.round(cc * 1000) / 1000,
    vitals: Math.round(vitals * 1000) / 1000,
    medications: { precision: medP, recall: medR, f1: Math.round(medF1 * 1000) / 1000 },
    diagnoses: { precision: dxP, recall: dxR, f1: Math.round(dxF1 * 1000) / 1000, icd10_accuracy: 0 },
    plan: { precision: planP, recall: planR, f1: Math.round(planF1 * 1000) / 1000 },
    follow_up: Math.round(fuScore * 1000) / 1000,
  };
}

// --- CLI Logic ---

async function main() {
  const args = process.argv.slice(2);
  const strategyArg = args.find((a) => a.startsWith("--strategy="))?.split("=")[1] as PromptStrategy | undefined;
  const filterArg = args.find((a) => a.startsWith("--filter="))?.split("=")[1];
  const modelArg = args.find((a) => a.startsWith("--model="))?.split("=")[1];

  const strategy = strategyArg ?? "zero_shot";
  if (!PROMPT_STRATEGIES.includes(strategy)) {
    console.error(`Invalid strategy: ${strategy}. Must be: ${PROMPT_STRATEGIES.join(", ")}`);
    process.exit(1);
  }

  // Auto-detect provider
  const providerName = detectProviderFromEnv();
  if (!providerName) {
    console.error("No LLM provider configured. Set ANTHROPIC_API_KEY, AWS_BEARER_TOKEN_BEDROCK, or GEMINI_API_KEY");
    process.exit(1);
  }
  const modelId = modelArg ?? getModelId(providerName);
  const dataDir = path.resolve(__dirname, "../data");

  console.log("╔══════════════════════════════════════════════╗");
  console.log("║        HEALOSBENCH — CLI Evaluation          ║");
  console.log("╚══════════════════════════════════════════════╝");
  console.log();
  console.log(`  Strategy:  ${strategy}`);
  console.log(`  Provider:  ${providerName}`);
  console.log(`  Model:     ${modelId}`);
  console.log();

  // Load transcripts
  const transcriptFiles = (await readdir(path.join(dataDir, "transcripts")))
    .filter((f) => f.endsWith(".txt"))
    .map((f) => f.replace(".txt", ""))
    .sort();

  let caseIds = transcriptFiles;
  if (filterArg) {
    const filterSet = new Set(filterArg.split(","));
    caseIds = caseIds.filter((id) => filterSet.has(id));
  }

  console.log(`  Cases:     ${caseIds.length}`);
  console.log();

  const results: Array<{ id: string; scores: CaseScores; tokens: number }> = [];
  let totalInput = 0;
  let totalOutput = 0;
  let failures = 0;

  for (let i = 0; i < caseIds.length; i++) {
    const id = caseIds[i]!;
    process.stdout.write(`  [${i + 1}/${caseIds.length}] ${id}... `);

    try {
      const transcript = await readFile(path.join(dataDir, "transcripts", `${id}.txt`), "utf-8");
      const gold = JSON.parse(await readFile(path.join(dataDir, "gold", `${id}.json`), "utf-8")) as ClinicalExtraction;

      const result = await extractWithRetry(transcript, { strategy, modelId, provider: providerName });
      totalInput += result.totalInputTokens;
      totalOutput += result.totalOutputTokens;

      if (result.extraction) {
        const scores = scoreCase(result.extraction, gold);
        const overall = (scores.chief_complaint + scores.vitals + scores.medications.f1 + scores.diagnoses.f1 + scores.plan.f1 + scores.follow_up) / 6;
        results.push({ id, scores, tokens: result.totalInputTokens + result.totalOutputTokens });
        console.log(`F1=${Math.round(overall * 100)}% (${result.attempts.length} attempts, ${result.totalInputTokens + result.totalOutputTokens} tokens)`);
      } else {
        failures++;
        console.log("FAILED (no extraction)");
      }
    } catch (err: unknown) {
      failures++;
      const msg = err instanceof Error ? err.message : String(err);
      console.log(`ERROR: ${msg.slice(0, 80)}`);
    }
  }

  // Summary
  console.log();
  console.log("  ═══════════════════════════════════════════════");
  console.log("  RESULTS SUMMARY");
  console.log("  ═══════════════════════════════════════════════");
  console.log();

  if (results.length === 0) {
    console.log("  No successful extractions.");
    process.exit(1);
  }

  const n = results.length;
  const avg = (fn: (s: CaseScores) => number) => results.reduce((sum, r) => sum + fn(r.scores), 0) / n;

  const ccAvg = avg((s) => s.chief_complaint);
  const vAvg = avg((s) => s.vitals);
  const mAvg = avg((s) => s.medications.f1);
  const dAvg = avg((s) => s.diagnoses.f1);
  const pAvg = avg((s) => s.plan.f1);
  const fAvg = avg((s) => s.follow_up);
  const overall = (ccAvg + vAvg + mAvg + dAvg + pAvg + fAvg) / 6;

  console.log("  ┌─────────────────────┬────────┬──────┐");
  console.log("  │ Field               │ Score  │ N    │");
  console.log("  ├─────────────────────┼────────┼──────┤");
  console.log(`  │ Chief Complaint      │ ${(ccAvg * 100).toFixed(1).padStart(5)}% │ ${String(n).padStart(4)} │`);
  console.log(`  │ Vitals               │ ${(vAvg * 100).toFixed(1).padStart(5)}% │ ${String(n).padStart(4)} │`);
  console.log(`  │ Medications (F1)     │ ${(mAvg * 100).toFixed(1).padStart(5)}% │ ${String(n).padStart(4)} │`);
  console.log(`  │ Diagnoses (F1)       │ ${(dAvg * 100).toFixed(1).padStart(5)}% │ ${String(n).padStart(4)} │`);
  console.log(`  │ Plan (F1)            │ ${(pAvg * 100).toFixed(1).padStart(5)}% │ ${String(n).padStart(4)} │`);
  console.log(`  │ Follow-up            │ ${(fAvg * 100).toFixed(1).padStart(5)}% │ ${String(n).padStart(4)} │`);
  console.log("  ├─────────────────────┼────────┼──────┤");
  console.log(`  │ OVERALL F1           │ ${(overall * 100).toFixed(1).padStart(5)}% │ ${String(n).padStart(4)} │`);
  console.log("  └─────────────────────┴────────┴──────┘");
  console.log();
  console.log(`  Total tokens: ${totalInput + totalOutput} (input: ${totalInput}, output: ${totalOutput})`);
  console.log(`  Estimated cost: $${((totalInput / 1e6) * 0.25 + (totalOutput / 1e6) * 1.25).toFixed(4)}`);
  console.log(`  Failures: ${failures}/${caseIds.length}`);
  console.log();
}

main().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});
