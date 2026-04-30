/**
 * Test: Fuzzy medication matching.
 * Verifies that medication names match correctly with fuzzy logic.
 */
import { describe, expect, test } from "bun:test";
import {
  scoreMedications,
} from "../apps/server/src/services/evaluate.service";
import type { Medication } from "@test-evals/shared";

function med(name: string, dose?: string, freq?: string, route?: string): Medication {
  return { name, dose: dose ?? null, frequency: freq ?? null, route: route ?? null };
}

describe("Fuzzy Medication Matching", () => {
  test("exact match", () => {
    const pred = [med("ibuprofen", "400 mg", "every 6 hours", "PO")];
    const gold = [med("ibuprofen", "400 mg", "every 6 hours", "PO")];
    const result = scoreMedications(pred, gold);
    expect(result.f1).toBe(1);
  });

  test("case-insensitive name match", () => {
    const pred = [med("Ibuprofen", "400 mg", "every 6 hours", "PO")];
    const gold = [med("ibuprofen", "400 mg", "every 6 hours", "PO")];
    const result = scoreMedications(pred, gold);
    expect(result.f1).toBe(1);
  });

  test("missing medication in prediction → recall < 1", () => {
    const pred = [med("ibuprofen", "400 mg", "every 6 hours", "PO")];
    const gold = [
      med("ibuprofen", "400 mg", "every 6 hours", "PO"),
      med("amoxicillin", "500 mg", "twice daily", "PO"),
    ];
    const result = scoreMedications(pred, gold);
    expect(result.precision).toBe(1);
    expect(result.recall).toBe(0.5);
    expect(result.f1).toBeCloseTo(2 / 3, 2);
  });

  test("extra medication in prediction → precision < 1", () => {
    const pred = [
      med("ibuprofen", "400 mg", "every 6 hours", "PO"),
      med("metformin", "500 mg", "twice daily", "PO"),
    ];
    const gold = [med("ibuprofen", "400 mg", "every 6 hours", "PO")];
    const result = scoreMedications(pred, gold);
    expect(result.precision).toBe(0.5);
    expect(result.recall).toBe(1);
  });

  test("wrong dose → no match", () => {
    const pred = [med("ibuprofen", "800 mg", "every 6 hours", "PO")];
    const gold = [med("ibuprofen", "400 mg", "every 6 hours", "PO")];
    const result = scoreMedications(pred, gold);
    expect(result.f1).toBe(0);
  });

  test("both empty → perfect score", () => {
    const result = scoreMedications([], []);
    expect(result.f1).toBe(1);
  });

  test("pred empty, gold non-empty → zero", () => {
    const result = scoreMedications([], [med("ibuprofen", "400 mg", "daily", "PO")]);
    expect(result.f1).toBe(0);
  });
});
