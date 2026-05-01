"use client";
import { authClient } from "@/lib/auth-client";
import Link from "next/link";
import { Activity, ArrowRight, BarChart3, ClipboardList } from "lucide-react";

export default function Dashboard({ session }: { session: typeof authClient.$Infer.Session }) {
  const actions = [
    {
      href: "/evals",
      title: "Evaluation Runs",
      description: "Start a run, watch progress, and inspect case-level scores.",
      icon: ClipboardList,
    },
    {
      href: "/evals/compare",
      title: "Compare View",
      description: "Pick two completed runs and see which strategy wins by field.",
      icon: BarChart3,
    },
  ] as const;

  return (
    <div className="grid gap-6">
      <section className="grid gap-4 rounded-md border bg-card p-5 shadow-sm md:grid-cols-[1.2fr_0.8fr] md:items-center">
        <div>
          <div className="flex items-center gap-2 text-sm font-medium text-muted-foreground">
            <Activity className="size-4 text-emerald-500" />
            HEALOSBENCH
          </div>
          <h2 className="mt-3 text-xl font-semibold tracking-tight">Prompt eval command center</h2>
          <p className="mt-2 text-sm text-muted-foreground">
            Auth is active. The eval tools below go straight to the Hono API, so API keys stay server-side.
          </p>
        </div>
        <div className="rounded-md border bg-muted/30 p-4 text-sm">
          <div className="text-muted-foreground">Signed in as</div>
          <div className="mt-1 truncate font-medium">{session.user.email}</div>
        </div>
      </section>

      <section className="grid gap-3 md:grid-cols-2">
        {actions.map((action) => {
          const Icon = action.icon;
          return (
            <Link
              key={action.href}
              href={action.href}
              className="group rounded-md border bg-card p-5 shadow-sm transition-colors hover:bg-accent"
            >
              <div className="flex items-start justify-between gap-4">
                <div className="flex gap-3">
                  <div className="flex size-9 items-center justify-center rounded-md border bg-background">
                    <Icon className="size-4" />
                  </div>
                  <div>
                    <h3 className="font-semibold">{action.title}</h3>
                    <p className="mt-1 text-sm text-muted-foreground">{action.description}</p>
                  </div>
                </div>
                <ArrowRight className="mt-1 size-4 text-muted-foreground transition-transform group-hover:translate-x-1" />
              </div>
            </Link>
          );
        })}
      </section>
    </div>
  );
}
