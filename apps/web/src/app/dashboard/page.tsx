import { headers } from "next/headers";
import { redirect } from "next/navigation";

import { authClient } from "@/lib/auth-client";

import Dashboard from "./dashboard";

export default async function DashboardPage() {
  const session = await authClient.getSession({
    fetchOptions: {
      headers: await headers(),
      throw: true,
    },
  });

  if (!session?.user) {
    redirect("/login");
  }

  return (
    <div className="mx-auto w-full max-w-6xl px-4 py-8">
      <div className="mb-8">
        <p className="text-sm text-muted-foreground">Welcome back, {session.user.name}</p>
        <h1 className="mt-1 text-3xl font-semibold tracking-tight">Dashboard</h1>
      </div>
      <Dashboard session={session} />
    </div>
  );
}
