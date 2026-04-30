/**
 * Test: Hallucination detector — negative case (should NOT flag).
 */
import { describe, expect, test } from "bun:test";
import { detectHallucinations } from "../apps/server/src/services/evaluate.service";
import type { ClinicalExtraction } from "@test-evals/shared";

describe("Hallucination Detector — Negative", () => {
  test("does not flag medication that is in transcript", () => {
    const pred: ClinicalExtraction = {
      chief_complaint: "sore throat for four days",
      vitals: { bp: "122/78", hr: 88, temp_f: 100.4, spo2: 98 },
      medications: [
        { name: "ibuprofen", dose: "400 mg", frequency: "every 6 hours", route: "PO" },
      ],
      diagnoses: [{ description: "viral upper respiratory infection" }],
      plan: ["take ibuprofen as needed"],
      follow_up: { interval_days: null, reason: null },
    };

    const transcript =
      "Doctor: This looks like a viral upper respiratory infection. Take ibuprofen 400 mg every 6 hours. BP is 122/78.";

    const hallucinations = detectHallucinations(pred, transcript);
    const medHallucination = hallucinations.find(
      (h) => h.field === "medications"
    );
    expect(medHallucination).toBeUndefined();
  });

  test("does not flag diagnosis grounded in transcript", () => {
    const pred: ClinicalExtraction = {
      chief_complaint: "ear pain",
      vitals: { bp: null, hr: null, temp_f: null, spo2: null },
      medications: [],
      diagnoses: [{ description: "acute otitis media" }],
      plan: ["antibiotics"],
      follow_up: { interval_days: null, reason: null },
    };

    const transcript = "Doctor: He's got acute otitis media on the right.";

    const hallucinations = detectHallucinations(pred, transcript);
    const dxHallucination = hallucinations.find(
      (h) => h.field === "diagnoses"
    );
    expect(dxHallucination).toBeUndefined();
  });
});
