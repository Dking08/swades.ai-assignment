"use client";

import { useEffect, useState, useCallback } from "react";
import { useParams, useRouter } from "next/navigation";
import { getRun, getCase, subscribeToRunStream } from "@/lib/api";
import type { CaseScores, CaseDetailDTO } from "@test-evals/shared";

function ScoreCell({ value, label }: { value: number | null | undefined; label?: string }) {
  if (value === null || value === undefined) return <td className="px-3 py-2 text-center text-zinc-500">—</td>;
  const pct = Math.round(value * 100);
  const bg =
    pct >= 80 ? "bg-emerald-500/15 text-emerald-400" :
    pct >= 60 ? "bg-yellow-500/15 text-yellow-400" :
    "bg-red-500/15 text-red-400";
  return (
    <td className={`px-3 py-2 text-center font-mono text-xs ${bg} rounded`}>
      {pct}%
    </td>
  );
}

const HAIKU_45_MODEL_RE = /haiku[-_.]?4[-_.]?5/i;

function formatCost(usd: number | null, model?: string): string {
  if (usd === null || usd === undefined) return "—";
  const base = `$${usd.toFixed(4)}`;
  if (!model || !HAIKU_45_MODEL_RE.test(model)) return base;
  return `${base} @ $5/M`;
}

type RunDetail = Awaited<ReturnType<typeof getRun>>;

export default function RunDetailPage() {
  const params = useParams();
  const router = useRouter();
  const runId = params.runId as string;

  const [run, setRun] = useState<RunDetail | null>(null);
  const [selectedCase, setSelectedCase] = useState<CaseDetailDTO | null>(null);
  const [loading, setLoading] = useState(true);
  const [caseLoading, setCaseLoading] = useState(false);

  const fetchRun = useCallback(async () => {
    try {
      const data = await getRun(runId);
      setRun(data);
    } catch (err) {
      console.error("Failed to load run:", err);
    } finally {
      setLoading(false);
    }
  }, [runId]);

  useEffect(() => {
    fetchRun();
  }, [fetchRun]);

  // SSE for live updates
  useEffect(() => {
    if (!run || run.status !== "running") return;
    const unsub = subscribeToRunStream(
      runId,
      () => { fetchRun(); },
      () => { /* reconnect handled by interval */ }
    );
    const interval = setInterval(fetchRun, 5000);
    return () => { unsub(); clearInterval(interval); };
  }, [runId, run?.status, fetchRun]);

  const handleCaseClick = async (caseId: string) => {
    setCaseLoading(true);
    try {
      const data = await getCase(runId, caseId);
      setSelectedCase(data);
    } catch (err) {
      console.error("Failed to load case:", err);
    } finally {
      setCaseLoading(false);
    }
  };

  if (loading) {
    return (
      <div className="container mx-auto max-w-7xl px-4 py-6">
        <div className="space-y-4">
          <div className="h-8 w-48 bg-zinc-800 animate-pulse rounded" />
          <div className="h-32 bg-zinc-800/50 animate-pulse rounded-xl" />
          <div className="h-96 bg-zinc-800/50 animate-pulse rounded-xl" />
        </div>
      </div>
    );
  }

  if (!run) {
    return <div className="container mx-auto max-w-7xl px-4 py-6 text-red-400">Run not found</div>;
  }

  const agg = run.aggregates;

  return (
    <div className="container mx-auto max-w-7xl px-4 py-6">
      {/* Back + Title */}
      <button onClick={() => router.push("/evals")} className="text-sm text-zinc-500 hover:text-zinc-300 mb-4 transition-colors">
        ← All Runs
      </button>

      <div className="flex items-center gap-4 mb-6">
        <h1 className="text-2xl font-bold tracking-tight">
          <span className="font-mono text-emerald-400">{run.strategy}</span>
          <span className="text-zinc-500 text-lg ml-2">#{run.prompt_hash.slice(0, 8)}</span>
        </h1>
        <span className={`inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs font-medium ${
          run.status === "completed" ? "bg-emerald-500/15 text-emerald-400 border-emerald-500/30" :
          run.status === "running" ? "bg-blue-500/15 text-blue-400 border-blue-500/30 animate-pulse" :
          run.status === "failed" ? "bg-red-500/15 text-red-400 border-red-500/30" :
          "bg-zinc-500/15 text-zinc-400 border-zinc-500/30"
        }`}>{run.status}</span>
      </div>

      {/* Summary Cards */}
      {agg && (
        <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-8 gap-3 mb-6">
          {[
            { label: "Overall F1", value: agg.overall_f1 },
            { label: "Chief Complaint", value: agg.chief_complaint_avg },
            { label: "Vitals", value: agg.vitals_avg },
            { label: "Medications", value: agg.medications_f1_avg },
            { label: "Diagnoses", value: agg.diagnoses_f1_avg },
            { label: "Plan", value: agg.plan_f1_avg },
            { label: "Follow-up", value: agg.follow_up_avg },
            { label: "Hallucination", value: agg.hallucination_rate, invert: true },
          ].map((card) => {
            const pct = Math.round(card.value * 100);
            const color = (card as { invert?: boolean }).invert
              ? pct <= 10 ? "text-emerald-400" : pct <= 30 ? "text-yellow-400" : "text-red-400"
              : pct >= 80 ? "text-emerald-400" : pct >= 60 ? "text-yellow-400" : "text-red-400";
            return (
              <div key={card.label} className="rounded-lg border border-zinc-800 bg-zinc-900/50 p-3">
                <div className="text-xs text-zinc-500 mb-1">{card.label}</div>
                <div className={`text-xl font-mono font-bold ${color}`}>{pct}%</div>
              </div>
            );
          })}
        </div>
      )}

      {/* Meta info */}
      <div className="flex gap-6 text-sm text-zinc-400 mb-6">
        <span>Model: <span className="text-zinc-200 font-mono text-xs">{run.model}</span></span>
        <span>Cases: <span className="text-zinc-200">{run.completed_cases}/{run.total_cases}</span></span>
        {run.total_cost_usd !== null && (
          <span>Cost: <span className="text-zinc-200 font-mono">{formatCost(run.total_cost_usd, run.model)}</span></span>
        )}
        {run.wall_time_ms && (
          <span>Duration: <span className="text-zinc-200 font-mono">{(run.wall_time_ms / 1000).toFixed(1)}s</span></span>
        )}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Cases Table */}
        <div className="overflow-x-auto rounded-xl border border-zinc-800">
          <table className="w-full text-xs">
            <thead>
              <tr className="border-b border-zinc-800 bg-zinc-900/50">
                <th className="px-3 py-2 text-left font-medium text-zinc-400">Case</th>
                <th className="px-3 py-2 text-center font-medium text-zinc-400">CC</th>
                <th className="px-3 py-2 text-center font-medium text-zinc-400">Vitals</th>
                <th className="px-3 py-2 text-center font-medium text-zinc-400">Meds</th>
                <th className="px-3 py-2 text-center font-medium text-zinc-400">Dx</th>
                <th className="px-3 py-2 text-center font-medium text-zinc-400">Plan</th>
                <th className="px-3 py-2 text-center font-medium text-zinc-400">FU</th>
                <th className="px-3 py-2 text-center font-medium text-zinc-400">⚠</th>
              </tr>
            </thead>
            <tbody>
              {run.cases.map((c) => (
                <tr
                  key={c.id}
                  onClick={() => handleCaseClick(c.id)}
                  className={`border-b border-zinc-800/50 cursor-pointer transition-colors ${
                    selectedCase?.id === c.id ? "bg-zinc-800/60" : "hover:bg-zinc-800/30"
                  }`}
                >
                  <td className="px-3 py-2 font-mono text-zinc-300">{c.transcript_id.replace("case_", "")}</td>
                  <ScoreCell value={c.scores?.chief_complaint} />
                  <ScoreCell value={c.scores?.vitals} />
                  <ScoreCell value={c.scores?.medications?.f1} />
                  <ScoreCell value={c.scores?.diagnoses?.f1} />
                  <ScoreCell value={c.scores?.plan?.f1} />
                  <ScoreCell value={c.scores?.follow_up} />
                  <td className="px-3 py-2 text-center">
                    {c.hallucination_count > 0 ? (
                      <span className="text-red-400 font-medium">{c.hallucination_count}</span>
                    ) : (
                      <span className="text-zinc-600">0</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {/* Case Detail Panel */}
        <div className="rounded-xl border border-zinc-800 bg-zinc-900/30 overflow-hidden">
          {caseLoading ? (
            <div className="p-6 space-y-3">
              <div className="h-4 w-32 bg-zinc-800 animate-pulse rounded" />
              <div className="h-48 bg-zinc-800/50 animate-pulse rounded" />
            </div>
          ) : selectedCase ? (
            <div className="p-4 space-y-4 max-h-[75vh] overflow-y-auto">
              <h3 className="font-semibold text-zinc-200">
                {selectedCase.transcript_id}
              </h3>

              {/* Transcript */}
              <details className="group">
                <summary className="text-xs font-medium text-zinc-400 cursor-pointer hover:text-zinc-200">
                  Transcript
                </summary>
                <pre className="mt-2 p-3 rounded-lg bg-zinc-950 text-xs text-zinc-400 whitespace-pre-wrap max-h-48 overflow-y-auto">
                  {selectedCase.transcript_text}
                </pre>
              </details>

              {/* Gold vs Predicted */}
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <div className="text-xs font-medium text-emerald-400 mb-1">Gold Standard</div>
                  <pre className="p-2 rounded-lg bg-zinc-950 text-xs text-zinc-300 whitespace-pre-wrap max-h-64 overflow-y-auto">
                    {JSON.stringify(selectedCase.gold, null, 2)}
                  </pre>
                </div>
                <div>
                  <div className="text-xs font-medium text-blue-400 mb-1">Predicted</div>
                  <pre className="p-2 rounded-lg bg-zinc-950 text-xs text-zinc-300 whitespace-pre-wrap max-h-64 overflow-y-auto">
                    {selectedCase.predicted
                      ? JSON.stringify(selectedCase.predicted, null, 2)
                      : "(extraction failed)"}
                  </pre>
                </div>
              </div>

              {/* Hallucinations */}
              {selectedCase.hallucinations.length > 0 && (
                <div>
                  <div className="text-xs font-medium text-red-400 mb-1">
                    Hallucinations ({selectedCase.hallucinations.length})
                  </div>
                  <div className="space-y-1">
                    {selectedCase.hallucinations.map((h, i) => (
                      <div key={i} className="rounded bg-red-500/10 border border-red-500/20 px-2 py-1 text-xs text-red-300">
                        <span className="font-mono">{h.field}</span>: {h.value} — {h.reason}
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Traces */}
              <details>
                <summary className="text-xs font-medium text-zinc-400 cursor-pointer hover:text-zinc-200">
                  LLM Traces ({selectedCase.traces.length} attempts)
                </summary>
                <div className="mt-2 space-y-2">
                  {selectedCase.traces.map((t, i) => (
                    <div key={i} className="rounded-lg bg-zinc-950 p-2 text-xs">
                      <div className="flex gap-4 text-zinc-500 mb-1">
                        <span>Attempt {t.attempt_number}</span>
                        <span>{t.duration_ms}ms</span>
                        <span>In: {t.input_tokens} Out: {t.output_tokens}</span>
                        {t.error && <span className="text-red-400">Error</span>}
                      </div>
                      {t.error && (
                        <div className="text-red-300 text-xs mt-1">{t.error}</div>
                      )}
                    </div>
                  ))}
                </div>
              </details>
            </div>
          ) : (
            <div className="flex items-center justify-center h-64 text-zinc-500 text-sm">
              Click a case to view details
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
