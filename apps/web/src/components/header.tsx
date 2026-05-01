"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";

import { ModeToggle } from "./mode-toggle";
import UserMenu from "./user-menu";

export default function Header() {
  const pathname = usePathname();
  const links = [
    { to: "/", label: "Home" },
    { to: "/dashboard", label: "Dashboard" },
    { to: "/evals", label: "Evals" },
    { to: "/evals/compare", label: "Compare" },
  ] as const;

  return (
    <header className="border-b bg-background/95">
      <div className="mx-auto flex h-14 w-full max-w-7xl items-center justify-between gap-4 px-4">
        <nav className="flex min-w-0 items-center gap-1 text-sm">
          {links.map(({ to, label }) => {
            const active =
              to === "/"
                ? pathname === "/"
                : to === "/evals"
                  ? pathname === "/evals" || /^\/evals\/[^/]+$/.test(pathname)
                  : pathname.startsWith(to);
            return (
              <Link
                key={to}
                href={to}
                className={`rounded-md px-3 py-2 transition-colors hover:bg-accent hover:text-accent-foreground ${
                  active ? "bg-accent text-accent-foreground" : "text-muted-foreground"
                }`}
              >
                {label}
              </Link>
            );
          })}
        </nav>
        <div className="flex items-center gap-2">
          <ModeToggle />
          <UserMenu />
        </div>
      </div>
    </header>
  );
}
