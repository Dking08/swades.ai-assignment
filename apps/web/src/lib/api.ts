/**
 * Typed API client for the Hono eval API.
 * All requests go to NEXT_PUBLIC_SERVER_URL.
 */
import type {
  RunSummaryDTO,
  CaseDetailDTO,
  CompareResultDTO,
  PromptStrategy,
  CaseScores,
} from "@test-evals/shared";

const BASE_URL = process.env.NEXT_PUBLIC_SERVER_URL || "http://localhost:8787";

async function apiFetch<T>(path: string, options?: RequestInit): Promise<T> {
  const res = await fetch(`${BASE_URL}${path}`, {
    ...options,
    headers: {
      "Content-Type": "application/json",
      ...options?.headers,
    },
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: res.statusText }));
    throw new Error((err as { error: string }).error || res.statusText);
  }
  return res.json() as Promise<T>;
}

// ─── Runs ──────────────────────────────────────────────────────────────────

export async function listRuns(): Promise<RunSummaryDTO[]> {
  return apiFetch<RunSummaryDTO[]>("/api/v1/runs");
}

export async function getRun(
  runId: string
): Promise<
  RunSummaryDTO & {
    cases: Array<{
      id: string;
      transcript_id: string;
      status: string;
      scores: CaseScores | null;
      schema_valid: boolean;
      attempts_count: number;
      hallucination_count: number;
    }>;
  }
> {
  return apiFetch(`/api/v1/runs/${runId}`);
}

export async function getCase(
  runId: string,
  caseId: string
): Promise<CaseDetailDTO> {
  return apiFetch(`/api/v1/runs/${runId}/cases/${caseId}`);
}

export async function startNewRun(params: {
  strategy: PromptStrategy;
  model?: string;
  dataset_filter?: string[];
  force?: boolean;
}): Promise<{ run_id: string }> {
  return apiFetch("/api/v1/runs", {
    method: "POST",
    body: JSON.stringify(params),
  });
}

export async function resumeRun(
  runId: string
): Promise<{ status: string }> {
  return apiFetch(`/api/v1/runs/${runId}/resume`, {
    method: "POST",
  });
}

export async function compareRuns(
  runAId: string,
  runBId: string
): Promise<CompareResultDTO> {
  return apiFetch(`/api/v1/compare?runA=${runAId}&runB=${runBId}`);
}

// ─── SSE Stream ────────────────────────────────────────────────────────────

export function subscribeToRunStream(
  runId: string,
  onEvent: (event: { type: string; data: unknown }) => void,
  onError?: (err: Error) => void
): () => void {
  const es = new EventSource(`${BASE_URL}/api/v1/runs/${runId}/stream`);

  const handleEvent = (e: MessageEvent) => {
    try {
      const data = JSON.parse(e.data);
      onEvent({ type: e.type, data });
    } catch {
      // ignore
    }
  };

  es.addEventListener("case_complete", handleEvent);
  es.addEventListener("run_complete", handleEvent);
  es.addEventListener("run_error", handleEvent);
  es.addEventListener("run_started", handleEvent);

  es.onerror = () => {
    onError?.(new Error("SSE connection lost"));
    es.close();
  };

  return () => es.close();
}
