"use client";
import * as React from "react";
import Link from "next/link";
import { Activity, ArrowRight, BarChart3 } from "lucide-react";
import { API_BASE_URL } from "@/lib/api";

const TITLE_TEXT = `
 ██████╗ ███████╗████████╗████████╗███████╗██████╗
 ██╔══██╗██╔════╝╚══██╔══╝╚══██╔══╝██╔════╝██╔══██╗
 ██████╔╝█████╗     ██║      ██║   █████╗  ██████╔╝
 ██╔══██╗██╔══╝     ██║      ██║   ██╔══╝  ██╔══██╗
 ██████╔╝███████╗   ██║      ██║   ███████╗██║  ██║
 ╚═════╝ ╚══════╝   ╚═╝      ╚═╝   ╚══════╝╚═╝  ╚═╝

 ████████╗    ███████╗████████╗ █████╗  ██████╗██╗  ██╗
 ╚══██╔══╝    ██╔════╝╚══██╔══╝██╔══██╗██╔════╝██║ ██╔╝
    ██║       ███████╗   ██║   ███████║██║     █████╔╝
    ██║       ╚════██║   ██║   ██╔══██║██║     ██╔═██╗
    ██║       ███████║   ██║   ██║  ██║╚██████╗██║  ██╗
    ╚═╝       ╚══════╝   ╚═╝   ╚═╝  ╚═╝ ╚═════╝╚═╝  ╚═╝
 `;

export default function Home() {
  const [apiStatus, setApiStatus] = React.useState<string>("Checking...");

  React.useEffect(() => {
    fetch(API_BASE_URL)
      .then((res) => res.json())
      .then((data) => setApiStatus(`Online - ${data.version}`))
      .catch(() => setApiStatus("Offline"));
  }, []);

  return (
    <div className="mx-auto w-full max-w-5xl px-4 py-8">
      <pre className="overflow-x-auto font-mono text-xs leading-tight text-muted-foreground md:text-sm">
        {TITLE_TEXT}
      </pre>
      <div className="mt-6 grid gap-4 md:grid-cols-[1fr_auto] md:items-end">
        <section>
          <h1 className="text-2xl font-semibold tracking-tight">Clinical extraction evals</h1>
          <p className="mt-2 max-w-2xl text-sm text-muted-foreground">
            Run prompt strategies, inspect per-case traces, and compare field-level extraction quality.
          </p>
        </section>
        <Link
          href="/evals"
          className="inline-flex h-10 items-center justify-center gap-2 rounded-md bg-primary px-4 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90"
        >
          Open evals <ArrowRight className="size-4" />
        </Link>
      </div>
      <div className="mt-6 grid gap-3 sm:grid-cols-2">
        <section className="rounded-md border bg-card p-4">
          <div className="flex items-center gap-2 text-sm font-medium">
            <Activity className="size-4 text-emerald-500" />
            API Status
          </div>
          <p className="mt-2 text-sm text-muted-foreground">{apiStatus}</p>
        </section>
        <section className="rounded-md border bg-card p-4">
          <div className="flex items-center gap-2 text-sm font-medium">
            <BarChart3 className="size-4 text-blue-500" />
            Compare Runs
          </div>
          <Link href="/evals/compare" className="mt-2 inline-flex text-sm text-muted-foreground hover:text-foreground">
            View strategy deltas
          </Link>
        </section>
      </div>
    </div>
  );
}
