/**
 * Quick Gemini connection + extraction test.
 * Tests a single case to verify the provider chain works end-to-end.
 */
import * as dotenv from "dotenv";
import * as path from "path";
import { readFile } from "fs/promises";

dotenv.config({ path: path.resolve(__dirname, "../apps/server/.env") });

import {
  createAutoProvider,
  detectProviderFromEnv,
  getModelId,
} from "@test-evals/llm";
import { extractWithRetry } from "@test-evals/llm/extract";

async function main() {
  console.log("╔══════════════════════════════════════════════╗");
  console.log("║     Quick LLM Provider Connection Test       ║");
  console.log("╚══════════════════════════════════════════════╝");
  console.log();

  // Step 1: Detect provider
  const providerName = detectProviderFromEnv();
  if (!providerName) {
    console.error("❌ No LLM provider configured!");
    console.error("   Set one of: ANTHROPIC_API_KEY, AWS_BEARER_TOKEN_BEDROCK, GEMINI_API_KEY");
    process.exit(1);
  }

  const modelId = getModelId(providerName);
  console.log(`  ✅ Provider detected: ${providerName}`);
  console.log(`  ✅ Model: ${modelId}`);
  console.log();

  // Step 2: Quick hello test
  console.log("  [1/2] Testing basic connection...");
  try {
    const provider = createAutoProvider();
    const response = await provider.callWithToolUse(
      "You are a clinical data extractor. Extract data from the transcript.",
      [
        {
          role: "user",
          content: "Doctor: Hello, what brings you in today?\nPatient: I have a terrible headache for 3 days.\nDoctor: Let me check your vitals. BP is 130/85, heart rate 78, temp 98.6, O2 sat 99%.\nDoctor: I'm prescribing ibuprofen 400mg every 6 hours.\nDoctor: Diagnosis: tension-type headache.\nDoctor: Come back in one week if it doesn't improve.",
        },
      ],
      {
        name: "extract_clinical_data",
        description: "Extract structured clinical data from a transcript.",
        inputSchema: {
          type: "object",
          required: ["chief_complaint", "vitals", "medications", "diagnoses", "plan", "follow_up"],
          properties: {
            chief_complaint: { type: "string" },
            vitals: {
              type: "object",
              required: ["bp", "hr", "temp_f", "spo2"],
              properties: {
                bp: { type: ["string", "null"] },
                hr: { type: ["integer", "null"] },
                temp_f: { type: ["number", "null"] },
                spo2: { type: ["integer", "null"] },
              },
            },
            medications: {
              type: "array",
              items: {
                type: "object",
                required: ["name", "dose", "frequency", "route"],
                properties: {
                  name: { type: "string" },
                  dose: { type: ["string", "null"] },
                  frequency: { type: ["string", "null"] },
                  route: { type: ["string", "null"] },
                },
              },
            },
            diagnoses: {
              type: "array",
              items: {
                type: "object",
                required: ["description"],
                properties: {
                  description: { type: "string" },
                  icd10: { type: "string" },
                },
              },
            },
            plan: { type: "array", items: { type: "string" } },
            follow_up: {
              type: "object",
              required: ["interval_days", "reason"],
              properties: {
                interval_days: { type: ["integer", "null"] },
                reason: { type: ["string", "null"] },
              },
            },
          },
        },
      }
    );

    if (response.toolCallResult) {
      console.log("  ✅ Connection successful! Got tool call result:");
      console.log(JSON.stringify(response.toolCallResult, null, 2));
      console.log();
      console.log(`  📊 Tokens — Input: ${response.inputTokens}, Output: ${response.outputTokens}`);
    } else {
      console.error("  ⚠️  Connection OK but no tool call result.");
      console.error("     Error:", response.error);
    }
  } catch (err: any) {
    console.error(`  ❌ Connection FAILED: ${err.message}`);
    process.exit(1);
  }

  console.log();

  // Step 3: Full extraction pipeline test with case_001
  console.log("  [2/2] Testing full extraction pipeline on case_001...");
  const dataDir = path.resolve(__dirname, "../data");

  try {
    const transcript = await readFile(path.join(dataDir, "transcripts", "case_001.txt"), "utf-8");
    const gold = JSON.parse(await readFile(path.join(dataDir, "gold", "case_001.json"), "utf-8"));

    const result = await extractWithRetry(transcript, {
      strategy: "zero_shot",
      maxAttempts: 2,
    });

    if (result.extraction) {
      console.log(`  ✅ Extraction successful!`);
      console.log(`     Provider: ${result.provider}`);
      console.log(`     Model: ${result.model}`);
      console.log(`     Attempts: ${result.attempts.length}`);
      console.log(`     Schema valid: ${result.schemaValid}`);
      console.log(`     Tokens: ${result.totalInputTokens + result.totalOutputTokens}`);
      console.log();
      console.log("  📋 Extracted chief complaint:", result.extraction.chief_complaint);
      console.log("  📋 Medications:", result.extraction.medications.map(m => m.name).join(", "));
      console.log("  📋 Diagnoses:", result.extraction.diagnoses.map(d => d.description).join(", "));
    } else {
      console.error("  ⚠️  Extraction returned null");
      for (const trace of result.attempts) {
        console.error(`     Attempt ${trace.attempt_number}: ${trace.error}`);
      }
    }
  } catch (err: any) {
    console.error(`  ❌ Extraction FAILED: ${err.message}`);
  }

  console.log();
  console.log("  Done!");
}

main().catch((err) => {
  console.error("Fatal:", err);
  process.exit(1);
});
