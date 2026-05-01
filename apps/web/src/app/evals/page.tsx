"use client";

import { useEffect, useState, useCallback } from "react";
import { useRouter } from "next/navigation";
import { listRuns, startNewRun, cancelRun, subscribeToRunStream } from "@/lib/api";
import type { RunSummaryDTO, PromptStrategy } from "@test-evals/shared";

function formatDuration(ms: number | null): string {
  if (!ms) return "—";
  if (ms < 1000) return `${ms}ms`;
  return `${(ms / 1000).toFixed(1)}s`;
}

const HAIKU_45_MODEL_RE = /haiku[-_.]?4[-_.]?5/i;

function formatCost(usd: number | null, model?: string): string {
  if (usd === null || usd === undefined) return "—";
  const base = `$${usd.toFixed(4)}`;
  if (!model || !HAIKU_45_MODEL_RE.test(model)) return base;
  return `${base} @ $5/M`;
}

function StatusBadge({ status }: { status: string }) {
  const colors: Record<string, string> = {
    pending: "bg-yellow-500/15 text-yellow-400 border-yellow-500/30",
    running: "bg-blue-500/15 text-blue-400 border-blue-500/30 animate-pulse",
    completed: "bg-emerald-500/15 text-emerald-400 border-emerald-500/30",
    failed: "bg-red-500/15 text-red-400 border-red-500/30",
    cancelled: "bg-zinc-500/15 text-zinc-400 border-zinc-500/30",
  };
  return (
    <span
      className={`inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs font-medium ${colors[status] ?? colors.pending}`}
    >
      {status}
    </span>
  );
}

function ScoreBadge({ value }: { value: number | null | undefined }) {
  if (value === null || value === undefined) return <span className="text-zinc-500">—</span>;
  const pct = Math.round(value * 100);
  const color =
    pct >= 80
      ? "text-emerald-400"
      : pct >= 60
        ? "text-yellow-400"
        : "text-red-400";
  return <span className={`font-mono font-semibold ${color}`}>{pct}%</span>;
}

export default function EvalsPage() {
  const router = useRouter();
  const [runs, setRuns] = useState<RunSummaryDTO[]>([]);
  const [loading, setLoading] = useState(true);
  const [showNewRun, setShowNewRun] = useState(false);
  const [newStrategy, setNewStrategy] = useState<PromptStrategy>("zero_shot");
  const [starting, setStarting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [cancelling, setCancelling] = useState<string | null>(null); // runId being cancelled

  const fetchRuns = useCallback(async () => {
    try {
      const data = await listRuns();
      setRuns(data);
      setError(null);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Failed to load runs");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchRuns();
    const interval = setInterval(fetchRuns, 5000);
    return () => clearInterval(interval);
  }, [fetchRuns]);

  const handleStartRun = async () => {
    setStarting(true);
    try {
      const result = await startNewRun({ strategy: newStrategy });
      setShowNewRun(false);
      await fetchRuns();
      router.push(`/evals/${result.run_id}`);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Failed to start run");
    } finally {
      setStarting(false);
    }
  };

  const handleCancel = async (e: React.MouseEvent, runId: string) => {
    // Stop the row click from navigating to the run detail page
    e.stopPropagation();
    setCancelling(runId);
    try {
      await cancelRun(runId);
      await fetchRuns();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Failed to cancel run");
    } finally {
      setCancelling(null);
    }
  };

  return (
    <div className="container mx-auto max-w-7xl px-4 py-6">
      {/* Header */}
      <div className="flex items-center justify-between mb-8">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Evaluation Runs</h1>
          <p className="text-sm text-zinc-400 mt-1">
            Clinical extraction evaluation harness — compare prompt strategies
          </p>
        </div>
        <div className="flex gap-3">
          <button
            onClick={() => router.push("/evals/compare")}
            className="rounded-lg border border-zinc-700 bg-zinc-800/50 px-4 py-2 text-sm font-medium text-zinc-300 hover:bg-zinc-700/50 transition-colors"
          >
            Compare Runs
          </button>
          <button
            onClick={() => setShowNewRun(true)}
            className="rounded-lg bg-emerald-600 px-4 py-2 text-sm font-medium text-white hover:bg-emerald-500 transition-colors"
          >
            + New Run
          </button>
        </div>
      </div>

      {/* Error */}
      {error && (
        <div className="mb-4 rounded-lg border border-red-500/30 bg-red-500/10 p-3 text-sm text-red-400">
          {error}
        </div>
      )}

      {/* New Run Modal */}
      {showNewRun && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm">
          <div className="w-full max-w-md rounded-xl border border-zinc-700 bg-zinc-900 p-6 shadow-2xl">
            <h2 className="text-lg font-semibold mb-4">Start New Evaluation Run</h2>
            <div className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-zinc-400 mb-1.5">
                  Prompt Strategy
                </label>
                <select
                  value={newStrategy}
                  onChange={(e) => setNewStrategy(e.target.value as PromptStrategy)}
                  className="w-full rounded-lg border border-zinc-700 bg-zinc-800 px-3 py-2 text-sm text-zinc-200 focus:border-emerald-500 focus:outline-none"
                >
                  <option value="zero_shot">Zero Shot — Direct instruction</option>
                  <option value="few_shot">Few Shot — With examples</option>
                  <option value="cot">Chain of Thought — Step-by-step</option>
                </select>
              </div>
              <p className="text-xs text-zinc-500">
                Runs 50 cases with Claude Haiku via Bedrock. Estimated cost: ~$0.15–0.30
              </p>
              <div className="flex gap-3 justify-end">
                <button
                  onClick={() => setShowNewRun(false)}
                  className="rounded-lg border border-zinc-700 px-4 py-2 text-sm text-zinc-400 hover:text-zinc-200 transition-colors"
                >
                  Cancel
                </button>
                <button
                  onClick={handleStartRun}
                  disabled={starting}
                  className="rounded-lg bg-emerald-600 px-4 py-2 text-sm font-medium text-white hover:bg-emerald-500 disabled:opacity-50 transition-colors"
                >
                  {starting ? "Starting..." : "Start Run"}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Runs Table */}
      {loading ? (
        <div className="space-y-3">
          {[...Array(3)].map((_, i) => (
            <div key={i} className="h-16 rounded-lg bg-zinc-800/50 animate-pulse" />
          ))}
        </div>
      ) : runs.length === 0 ? (
        <div className="text-center py-20">
          <p className="text-zinc-400 text-lg">No evaluation runs yet</p>
          <p className="text-zinc-500 text-sm mt-2">
            Click "New Run" to start your first evaluation
          </p>
        </div>
      ) : (
        <div className="overflow-x-auto rounded-xl border border-zinc-800">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-zinc-800 bg-zinc-900/50">
                <th className="px-4 py-3 text-left font-medium text-zinc-400">Strategy</th>
                <th className="px-4 py-3 text-left font-medium text-zinc-400">Status</th>
                <th className="px-4 py-3 text-center font-medium text-zinc-400">Progress</th>
                <th className="px-4 py-3 text-center font-medium text-zinc-400">Overall F1</th>
                <th className="px-4 py-3 text-center font-medium text-zinc-400">Meds F1</th>
                <th className="px-4 py-3 text-center font-medium text-zinc-400">Dx F1</th>
                <th className="px-4 py-3 text-right font-medium text-zinc-400">Cost</th>
                <th className="px-4 py-3 text-right font-medium text-zinc-400">Duration</th>
                <th className="px-4 py-3 text-right font-medium text-zinc-400">Created</th>
                <th className="px-4 py-3" />
              </tr>
            </thead>
            <tbody>
              {runs.map((run) => (
                <tr
                  key={run.id}
                  onClick={() => router.push(`/evals/${run.id}`)}
                  className="border-b border-zinc-800/50 hover:bg-zinc-800/30 cursor-pointer transition-colors"
                >
                  <td className="px-4 py-3">
                    <span className="font-mono font-medium text-zinc-200">
                      {run.strategy}
                    </span>
                    <span className="ml-2 text-xs text-zinc-500 font-mono">
                      #{run.prompt_hash.slice(0, 8)}
                    </span>
                  </td>
                  <td className="px-4 py-3">
                    <StatusBadge status={run.status} />
                  </td>
                  <td className="px-4 py-3 text-center text-zinc-300">
                    {run.completed_cases}/{run.total_cases}
                  </td>
                  <td className="px-4 py-3 text-center">
                    <ScoreBadge value={run.aggregates?.overall_f1} />
                  </td>
                  <td className="px-4 py-3 text-center">
                    <ScoreBadge value={run.aggregates?.medications_f1_avg} />
                  </td>
                  <td className="px-4 py-3 text-center">
                    <ScoreBadge value={run.aggregates?.diagnoses_f1_avg} />
                  </td>
                  <td className="px-4 py-3 text-right font-mono text-zinc-300">
                    {formatCost(run.total_cost_usd, run.model)}
                  </td>
                  <td className="px-4 py-3 text-right font-mono text-zinc-300">
                    {formatDuration(run.wall_time_ms)}
                  </td>
                  <td className="px-4 py-3 text-right text-zinc-500 text-xs">
                    {new Date(run.created_at).toLocaleDateString()}
                  </td>
                  <td className="px-4 py-3 text-right">
                    {run.status === "running" && (
                      <button
                        id={`cancel-run-${run.id}`}
                        onClick={(e) => handleCancel(e, run.id)}
                        disabled={cancelling === run.id}
                        className="rounded-md border border-red-700/50 bg-red-900/20 px-2.5 py-1 text-xs font-medium text-red-400 hover:bg-red-900/40 hover:border-red-600 disabled:opacity-50 transition-colors"
                      >
                        {cancelling === run.id ? "Cancelling…" : "Cancel"}
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
