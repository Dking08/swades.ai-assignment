/**
 * Dataset service — load transcripts and gold standards from disk.
 */
import { readdir, readFile } from "fs/promises";
import { existsSync } from "fs";
import { join } from "path";
import type { ClinicalExtraction } from "@test-evals/shared";

// Resolve data directory relative to the monorepo root
const DATA_DIR = existsSync(join(process.cwd(), "data"))
  ? join(process.cwd(), "data")
  : join(import.meta.dir, "../../../../data");

export async function listTranscriptIds(): Promise<string[]> {
  const files = await readdir(join(DATA_DIR, "transcripts"));
  return files
    .filter((f) => f.endsWith(".txt"))
    .map((f) => f.replace(".txt", ""))
    .sort();
}

export async function loadTranscript(id: string): Promise<string> {
  const filePath = join(DATA_DIR, "transcripts", `${id}.txt`);
  return readFile(filePath, "utf-8");
}

export async function loadGold(id: string): Promise<ClinicalExtraction> {
  const filePath = join(DATA_DIR, "gold", `${id}.json`);
  const content = await readFile(filePath, "utf-8");
  return JSON.parse(content) as ClinicalExtraction;
}

export async function loadAllData(): Promise<
  Array<{
    transcriptId: string;
    transcript: string;
    gold: ClinicalExtraction;
  }>
> {
  const ids = await listTranscriptIds();
  const results = await Promise.all(
    ids.map(async (id) => ({
      transcriptId: id,
      transcript: await loadTranscript(id),
      gold: await loadGold(id),
    }))
  );
  return results;
}
