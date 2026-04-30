/**
 * Test: Hallucination detector — positive case (should flag).
 */
import { describe, expect, test } from "bun:test";
import { detectHallucinations } from "../apps/server/src/services/evaluate.service";
import type { ClinicalExtraction } from "@test-evals/shared";

describe("Hallucination Detector — Positive", () => {
  test("flags medication not in transcript", () => {
    const pred: ClinicalExtraction = {
      chief_complaint: "headache",
      vitals: { bp: null, hr: null, temp_f: null, spo2: null },
      medications: [
        { name: "metformin", dose: "500 mg", frequency: "daily", route: "PO" },
      ],
      diagnoses: [{ description: "tension headache" }],
      plan: ["rest"],
      follow_up: { interval_days: null, reason: null },
    };

    const transcript =
      "Doctor: You have a tension headache. Take ibuprofen if needed.";

    const hallucinations = detectHallucinations(pred, transcript);
    const medHallucination = hallucinations.find(
      (h) => h.field === "medications" && h.value === "metformin"
    );
    expect(medHallucination).toBeDefined();
  });

  test("flags diagnosis not grounded in transcript", () => {
    const pred: ClinicalExtraction = {
      chief_complaint: "cough",
      vitals: { bp: null, hr: null, temp_f: null, spo2: null },
      medications: [],
      diagnoses: [{ description: "congestive heart failure" }],
      plan: ["rest"],
      follow_up: { interval_days: null, reason: null },
    };

    const transcript = "Doctor: You have a simple cold. Rest and drink fluids.";

    const hallucinations = detectHallucinations(pred, transcript);
    const dxHallucination = hallucinations.find(
      (h) => h.field === "diagnoses"
    );
    expect(dxHallucination).toBeDefined();
  });
});
