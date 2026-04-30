/**
 * Tool schema for Bedrock Converse API.
 * Defines the `extract_clinical_data` tool that forces the model
 * to return schema-conformant JSON via tool_use.
 */
import type { ToolConfiguration } from "@aws-sdk/client-bedrock-runtime";

/**
 * The extraction tool schema — matches data/schema.json exactly.
 * When used with toolChoice.tool, Claude is forced to call this tool,
 * guaranteeing structured JSON output.
 */
export const EXTRACTION_TOOL_NAME = "extract_clinical_data";

export function getToolConfig(): ToolConfiguration {
  return {
    tools: [
      {
        toolSpec: {
          name: EXTRACTION_TOOL_NAME,
          description:
            "Extract structured clinical data from a doctor-patient transcript. " +
            "All fields are required. Use null for missing values.",
          inputSchema: {
            json: {
              type: "object",
              required: [
                "chief_complaint",
                "vitals",
                "medications",
                "diagnoses",
                "plan",
                "follow_up",
              ],
              properties: {
                chief_complaint: {
                  type: "string",
                  minLength: 1,
                  description:
                    "The patient's primary reason for the visit, in their words or a brief clinical summary.",
                },
                vitals: {
                  type: "object",
                  required: ["bp", "hr", "temp_f", "spo2"],
                  properties: {
                    bp: {
                      type: ["string", "null"],
                      description:
                        'Blood pressure as systolic/diastolic mmHg, e.g. "128/82".',
                    },
                    hr: {
                      type: ["integer", "null"],
                      description: "Heart rate in beats per minute.",
                    },
                    temp_f: {
                      type: ["number", "null"],
                      description: "Temperature in degrees Fahrenheit.",
                    },
                    spo2: {
                      type: ["integer", "null"],
                      description: "Oxygen saturation, percent.",
                    },
                  },
                },
                medications: {
                  type: "array",
                  description:
                    "Medications discussed (existing, started, stopped, or changed).",
                  items: {
                    type: "object",
                    required: ["name", "dose", "frequency", "route"],
                    properties: {
                      name: { type: "string", minLength: 1 },
                      dose: { type: ["string", "null"] },
                      frequency: { type: ["string", "null"] },
                      route: {
                        type: ["string", "null"],
                        description:
                          "e.g. PO, IV, IM, topical, inhaled, SL, PR.",
                      },
                    },
                  },
                },
                diagnoses: {
                  type: "array",
                  description: "Working or confirmed diagnoses.",
                  items: {
                    type: "object",
                    required: ["description"],
                    properties: {
                      description: { type: "string", minLength: 1 },
                      icd10: {
                        type: "string",
                        description: 'ICD-10-CM code, e.g. "J06.9".',
                      },
                    },
                  },
                },
                plan: {
                  type: "array",
                  description: "Plan items as concise free-text statements.",
                  items: { type: "string", minLength: 1 },
                },
                follow_up: {
                  type: "object",
                  required: ["interval_days", "reason"],
                  properties: {
                    interval_days: {
                      type: ["integer", "null"],
                      description:
                        "Days until follow-up, or null if no scheduled follow-up.",
                    },
                    reason: {
                      type: ["string", "null"],
                      description:
                        "Reason for follow-up, or null if not applicable.",
                    },
                  },
                },
              },
            },
          },
        },
      },
    ],
    toolChoice: {
      tool: {
        name: EXTRACTION_TOOL_NAME,
      },
    },
  };
}
