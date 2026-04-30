/**
 * Test: Set-based F1 correctness on synthetic case.
 */
import { describe, expect, test } from "bun:test";
import {
  scoreCase,
  scorePlan,
  scoreDiagnoses,
} from "../apps/server/src/services/evaluate.service";
import type { ClinicalExtraction } from "@test-evals/shared";

describe("Set F1 Correctness", () => {
  test("perfect match returns 1.0 for all fields", () => {
    const data: ClinicalExtraction = {
      chief_complaint: "sore throat",
      vitals: { bp: "120/80", hr: 72, temp_f: 98.6, spo2: 99 },
      medications: [
        { name: "ibuprofen", dose: "400 mg", frequency: "every 6 hours", route: "PO" },
      ],
      diagnoses: [{ description: "pharyngitis", icd10: "J02.9" }],
      plan: ["take ibuprofen as needed", "rest and fluids"],
      follow_up: { interval_days: 7, reason: "recheck" },
    };

    const scores = scoreCase(data, data);
    expect(scores.chief_complaint).toBe(1);
    expect(scores.vitals).toBe(1);
    expect(scores.medications.f1).toBe(1);
    expect(scores.diagnoses.f1).toBe(1);
    expect(scores.plan.f1).toBe(1);
    expect(scores.follow_up).toBe(1);
  });

  test("plan F1: 2 out of 3 items match", () => {
    const pred = ["take ibuprofen", "rest and fluids"];
    const gold = ["take ibuprofen", "rest and fluids", "follow up in 1 week"];
    const result = scorePlan(pred, gold);
    expect(result.precision).toBe(1); // 2/2
    expect(result.recall).toBeCloseTo(2 / 3, 2); // 2/3
    expect(result.f1).toBeCloseTo(0.8, 1); // 2 * 1 * 0.667 / 1.667
  });

  test("diagnoses F1 with partial match", () => {
    const pred = [
      { description: "acute sinusitis" },
      { description: "headache" },
    ];
    const gold = [{ description: "acute bacterial sinusitis", icd10: "J01.90" }];
    const result = scoreDiagnoses(pred, gold);
    // "acute sinusitis" should fuzzy-match "acute bacterial sinusitis"
    expect(result.recall).toBe(1);
    expect(result.precision).toBe(0.5); // 1/2
  });
});
