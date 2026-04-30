"use client";

import { useEffect, useState, useCallback } from "react";
import { useRouter } from "next/navigation";
import { listRuns, compareRuns } from "@/lib/api";
import type { RunSummaryDTO, CompareResultDTO } from "@test-evals/shared";

export default function CompareView() {
  const router = useRouter();
  const [runs, setRuns] = useState<RunSummaryDTO[]>([]);
  const [runAId, setRunAId] = useState<string>("");
  const [runBId, setRunBId] = useState<string>("");
  const [comparison, setComparison] = useState<CompareResultDTO | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    listRuns()
      .then((data) => {
        const completed = data.filter((r) => r.status === "completed");
        setRuns(completed);
        if (completed.length >= 2) {
          setRunAId(completed[0]!.id);
          setRunBId(completed[1]!.id);
        }
      })
      .catch(() => setError("Failed to load runs"));
  }, []);

  const handleCompare = useCallback(async () => {
    if (!runAId || !runBId) return;
    if (runAId === runBId) { setError("Select two different runs"); return; }
    setLoading(true);
    setError(null);
    try {
      const data = await compareRuns(runAId, runBId);
      setComparison(data);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Compare failed");
    } finally {
      setLoading(false);
    }
  }, [runAId, runBId]);

  useEffect(() => {
    if (runAId && runBId && runAId !== runBId) {
      handleCompare();
    }
  }, [runAId, runBId, handleCompare]);

  return (
    <div className="container mx-auto max-w-7xl px-4 py-6">
      <button onClick={() => router.push("/evals")} className="text-sm text-zinc-500 hover:text-zinc-300 mb-4 transition-colors">
        ← All Runs
      </button>

      <h1 className="text-2xl font-bold tracking-tight mb-6">Compare Runs</h1>

      {/* Selectors */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-6">
        <div>
          <label className="block text-xs font-medium text-zinc-400 mb-1">Run A (baseline)</label>
          <select
            value={runAId}
            onChange={(e) => setRunAId(e.target.value)}
            className="w-full rounded-lg border border-zinc-700 bg-zinc-800 px-3 py-2 text-sm text-zinc-200 focus:border-blue-500 focus:outline-none"
          >
            <option value="">Select a run...</option>
            {runs.map((r) => (
              <option key={r.id} value={r.id}>
                {r.strategy} — #{r.prompt_hash.slice(0, 8)} — F1: {r.aggregates?.overall_f1 ? Math.round(r.aggregates.overall_f1 * 100) + "%" : "—"}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label className="block text-xs font-medium text-zinc-400 mb-1">Run B (challenger)</label>
          <select
            value={runBId}
            onChange={(e) => setRunBId(e.target.value)}
            className="w-full rounded-lg border border-zinc-700 bg-zinc-800 px-3 py-2 text-sm text-zinc-200 focus:border-emerald-500 focus:outline-none"
          >
            <option value="">Select a run...</option>
            {runs.map((r) => (
              <option key={r.id} value={r.id}>
                {r.strategy} — #{r.prompt_hash.slice(0, 8)} — F1: {r.aggregates?.overall_f1 ? Math.round(r.aggregates.overall_f1 * 100) + "%" : "—"}
              </option>
            ))}
          </select>
        </div>
      </div>

      {error && (
        <div className="mb-4 rounded-lg border border-red-500/30 bg-red-500/10 p-3 text-sm text-red-400">{error}</div>
      )}

      {loading && (
        <div className="space-y-3">
          <div className="h-12 bg-zinc-800/50 animate-pulse rounded-xl" />
          <div className="h-64 bg-zinc-800/50 animate-pulse rounded-xl" />
        </div>
      )}

      {comparison && !loading && (
        <>
          {/* Field Deltas Table */}
          <div className="rounded-xl border border-zinc-800 overflow-hidden mb-6">
            <div className="bg-zinc-900/50 px-4 py-3 border-b border-zinc-800">
              <h2 className="text-sm font-semibold text-zinc-300">Per-Field Score Comparison</h2>
            </div>
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-zinc-800">
                  <th className="px-4 py-3 text-left font-medium text-zinc-400">Field</th>
                  <th className="px-4 py-3 text-center font-medium text-blue-400">
                    Run A ({comparison.run_a.strategy})
                  </th>
                  <th className="px-4 py-3 text-center font-medium text-emerald-400">
                    Run B ({comparison.run_b.strategy})
                  </th>
                  <th className="px-4 py-3 text-center font-medium text-zinc-400">Delta</th>
                  <th className="px-4 py-3 text-center font-medium text-zinc-400">Winner</th>
                </tr>
              </thead>
              <tbody>
                {comparison.field_deltas.map((fd) => (
                  <tr key={fd.field} className="border-b border-zinc-800/50">
                    <td className="px-4 py-3 font-medium text-zinc-200">{fd.field}</td>
                    <td className="px-4 py-3 text-center font-mono text-zinc-300">
                      {Math.round(fd.run_a_score * 100)}%
                    </td>
                    <td className="px-4 py-3 text-center font-mono text-zinc-300">
                      {Math.round(fd.run_b_score * 100)}%
                    </td>
                    <td className="px-4 py-3 text-center font-mono font-semibold">
                      <span className={
                        fd.delta > 0 ? "text-emerald-400" :
                        fd.delta < 0 ? "text-red-400" :
                        "text-zinc-500"
                      }>
                        {fd.delta > 0 ? "+" : ""}{Math.round(fd.delta * 100)}%
                      </span>
                    </td>
                    <td className="px-4 py-3 text-center">
                      {fd.winner === "a" ? (
                        <span className="rounded-full bg-blue-500/15 text-blue-400 border border-blue-500/30 px-2 py-0.5 text-xs">A</span>
                      ) : fd.winner === "b" ? (
                        <span className="rounded-full bg-emerald-500/15 text-emerald-400 border border-emerald-500/30 px-2 py-0.5 text-xs">B</span>
                      ) : (
                        <span className="text-zinc-500 text-xs">tie</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* Per-case comparison */}
          <div className="rounded-xl border border-zinc-800 overflow-hidden">
            <div className="bg-zinc-900/50 px-4 py-3 border-b border-zinc-800 flex items-center justify-between">
              <h2 className="text-sm font-semibold text-zinc-300">Per-Case Breakdown</h2>
              <span className="text-xs text-zinc-500">
                {comparison.per_case.filter((c) => c.delta > 0).length} improved,{" "}
                {comparison.per_case.filter((c) => c.delta < 0).length} regressed,{" "}
                {comparison.per_case.filter((c) => c.delta === 0).length} unchanged
              </span>
            </div>
            <div className="max-h-96 overflow-y-auto">
              <table className="w-full text-xs">
                <thead className="sticky top-0 bg-zinc-900">
                  <tr className="border-b border-zinc-800">
                    <th className="px-3 py-2 text-left font-medium text-zinc-400">Case</th>
                    <th className="px-3 py-2 text-center font-medium text-blue-400">Run A</th>
                    <th className="px-3 py-2 text-center font-medium text-emerald-400">Run B</th>
                    <th className="px-3 py-2 text-center font-medium text-zinc-400">Delta</th>
                  </tr>
                </thead>
                <tbody>
                  {comparison.per_case.map((pc) => (
                    <tr key={pc.transcript_id} className="border-b border-zinc-800/30 hover:bg-zinc-800/20">
                      <td className="px-3 py-1.5 font-mono text-zinc-300">{pc.transcript_id.replace("case_", "")}</td>
                      <td className="px-3 py-1.5 text-center font-mono text-zinc-400">
                        {Math.round(pc.run_a_overall * 100)}%
                      </td>
                      <td className="px-3 py-1.5 text-center font-mono text-zinc-400">
                        {Math.round(pc.run_b_overall * 100)}%
                      </td>
                      <td className="px-3 py-1.5 text-center font-mono font-semibold">
                        <span className={
                          pc.delta > 0 ? "text-emerald-400" :
                          pc.delta < 0 ? "text-red-400" :
                          "text-zinc-600"
                        }>
                          {pc.delta > 0 ? "+" : ""}{Math.round(pc.delta * 100)}%
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
