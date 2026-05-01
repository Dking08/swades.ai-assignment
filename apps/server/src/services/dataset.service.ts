/**
 * Dataset service — load transcripts and gold standards from disk.
 */
import { readdir, readFile } from "fs/promises";
import { existsSync } from "fs";
import { dirname, join } from "path";
import { fileURLToPath } from "url";
import type { ClinicalExtraction } from "@test-evals/shared";

// Resolve __dirname in a way that works in both ESM (Bun) and CJS (esbuild/Netlify).
// In CJS bundles, __dirname is injected by the bundler.
// In ESM, import.meta.url is defined; import.meta.dir is Bun-only.
function getThisDir(): string {
  // CJS path (esbuild output, Netlify functions)
  if (typeof __dirname !== "undefined") return __dirname;
  // ESM path (Bun, native Node ESM)
  if (typeof import.meta?.url === "string") {
    return dirname(fileURLToPath(import.meta.url));
  }
  return process.cwd();
}

// Resolve data directory — try CWD first (local dev), then relative to this file (deployed)
const DATA_DIR = (() => {
  const cwd = join(process.cwd(), "data");
  if (existsSync(cwd)) return cwd;
  const rel = join(getThisDir(), "../../../../data");
  if (existsSync(rel)) return rel;
  // Netlify: data files are included next to the bundled function
  return join(getThisDir(), "data");
})();

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
