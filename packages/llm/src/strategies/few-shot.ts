/**
 * Few-shot prompt strategy.
 * Includes 3 diverse example transcript→extraction pairs.
 * Uses cache_control markers for Bedrock prompt caching on the system prompt.
 */
import type { SystemContentBlock, Message } from "@aws-sdk/client-bedrock-runtime";

const EXAMPLES = `
=== EXAMPLE 1 ===
Transcript:
[Visit type: in-person sick visit]
[Vitals taken at intake: BP 122/78, HR 88, Temp 100.4, SpO2 98%]

Doctor: Hi Jenna, what brings you in today?
Patient: I've had a sore throat for about four days, and now my nose is completely stuffed up. I feel awful.
Doctor: Any cough?
Patient: A little dry one at night.
Doctor: Fever?
Patient: I felt warm yesterday. The thermometer here said 100.4.
Doctor: Let me take a look. Throat is red but no exudate, ears are clear, lungs sound fine. Rapid strep is negative. This looks like a viral upper respiratory infection.
Patient: Can I get an antibiotic just in case?
Doctor: Antibiotics won't help a virus, and they'd just give you side effects. Let's do supportive care. Take ibuprofen 400 mg every 6 hours as needed for the throat pain and fever, plenty of fluids, and saline nasal spray. If you're not improving in 7 days, or you spike a fever above 102, give us a call.
Patient: Okay, that makes sense.
Doctor: No need for a follow-up unless symptoms worsen.

Extraction:
{
  "chief_complaint": "sore throat and nasal congestion for four days",
  "vitals": { "bp": "122/78", "hr": 88, "temp_f": 100.4, "spo2": 98 },
  "medications": [
    { "name": "ibuprofen", "dose": "400 mg", "frequency": "every 6 hours as needed", "route": "PO" }
  ],
  "diagnoses": [
    { "description": "viral upper respiratory infection", "icd10": "J06.9" }
  ],
  "plan": [
    "supportive care with fluids and saline nasal spray",
    "ibuprofen 400 mg every 6 hours as needed for pain and fever",
    "call if not improving in 7 days or fever above 102"
  ],
  "follow_up": { "interval_days": null, "reason": "return only if symptoms worsen" }
}

=== EXAMPLE 2 ===
Transcript:
[Visit type: in-person, pediatric mom-and-child]
[Vitals: HR 118, Temp 102.6, SpO2 99%]

Doctor: Hi, what's been going on with Mateo?
Patient (mom): He's been pulling at his right ear since yesterday and was up most of the night crying. He had a runny nose last week.
Doctor: Any drainage from the ear?
Patient: No.
Doctor: Let me look. Right tympanic membrane is bulging and red, no perforation. Left ear is fine. He's got a clear acute otitis media on the right.
Patient: Does he need antibiotics?
Doctor: At his age and with that fever of 102.6, yes. Amoxicillin 400 mg by mouth twice a day for 10 days. Also give him children's ibuprofen, weight-based dosing — 5 mL every 6 hours as needed for pain and fever.
Patient: Okay.
Doctor: If he's not better in 48 to 72 hours or it gets worse, bring him back. Otherwise no follow-up needed.

Extraction:
{
  "chief_complaint": "right ear pain and fever in toddler",
  "vitals": { "bp": null, "hr": 118, "temp_f": 102.6, "spo2": 99 },
  "medications": [
    { "name": "amoxicillin", "dose": "400 mg", "frequency": "twice a day", "route": "PO" },
    { "name": "children's ibuprofen", "dose": "5 mL", "frequency": "every 6 hours as needed", "route": "PO" }
  ],
  "diagnoses": [
    { "description": "acute otitis media, right ear", "icd10": "H66.91" }
  ],
  "plan": [
    "amoxicillin 400 mg by mouth twice a day for 10 days",
    "children's ibuprofen 5 mL every 6 hours as needed for pain and fever",
    "return in 48 to 72 hours if not improving or worsening"
  ],
  "follow_up": { "interval_days": null, "reason": "return if not improving in 48 to 72 hours" }
}

=== EXAMPLE 3 ===
Transcript:
[Visit type: in-person]
[Vitals at intake: BP 118/76, HR 82, Temp 101.2, SpO2 97%]

Doctor: Good morning, Daniel. What's going on?
Patient: I've had this pressure behind my eyes and cheeks for like ten days. It started as a cold but now it's just bad pressure and yellow-green stuff coming out my nose.
Doctor: Any fever?
Patient: On and off. Today it was 101.
Doctor: Tooth pain when you lean forward?
Patient: Yeah, especially in my upper teeth.
Doctor: Tenderness over your maxillary sinuses, that's where I'm pressing. Yes, those are tender. Given the duration past 10 days with worsening symptoms, this looks like acute bacterial sinusitis. I'm going to start you on amoxicillin-clavulanate 875 mg twice daily for 7 days. Use a saline rinse twice a day, and you can take pseudoephedrine 30 mg every 6 hours for the congestion if it doesn't keep you awake.
Patient: Got it.
Doctor: If you're not significantly better in 5 days, call us. Otherwise no follow-up needed.

Extraction:
{
  "chief_complaint": "facial pressure and purulent nasal discharge for ten days",
  "vitals": { "bp": "118/76", "hr": 82, "temp_f": 101.2, "spo2": 97 },
  "medications": [
    { "name": "amoxicillin-clavulanate", "dose": "875 mg", "frequency": "twice daily", "route": "PO" },
    { "name": "pseudoephedrine", "dose": "30 mg", "frequency": "every 6 hours", "route": "PO" }
  ],
  "diagnoses": [
    { "description": "acute bacterial sinusitis", "icd10": "J01.90" }
  ],
  "plan": [
    "start amoxicillin-clavulanate 875 mg twice daily for 7 days",
    "saline nasal rinse twice a day",
    "pseudoephedrine 30 mg every 6 hours as needed for congestion",
    "call if not significantly better in 5 days"
  ],
  "follow_up": { "interval_days": null, "reason": "call if not improving in 5 days" }
}`;

export const FEW_SHOT_SYSTEM: SystemContentBlock[] = [
  {
    text: `You are a medical data extraction specialist. Your task is to extract structured clinical information from doctor-patient encounter transcripts by calling the extract_clinical_data tool.

Here are examples of correct extractions:

${EXAMPLES}

Rules:
- Extract ONLY information explicitly stated in or directly implied by the transcript.
- Do NOT fabricate or hallucinate information not present in the text.
- If a vital sign is not mentioned, set it to null.
- If no follow-up is scheduled, set interval_days to null.
- For medications, if the route is not specified but it's an oral medication, use "PO".
- Include ICD-10 codes when you can confidently determine them.`,
  },
];

export function buildFewShotMessages(transcript: string): Message[] {
  return [
    {
      role: "user",
      content: [
        {
          text: `Now extract all clinical data from this new transcript:\n\n${transcript}`,
        },
      ],
    },
  ];
}
