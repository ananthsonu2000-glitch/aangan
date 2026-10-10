import Link from "next/link";
import type { ReactNode } from "react";

const nav = [
  ["/", "Overview"],
  ["/leads", "All leads"],
  ["/queue/designers", "Designer queue"],
  ["/queue/frontdesk", "Front desk recheck"],
  ["/admin", "Admin"],
] as const;

export default function DashLayout({ children }: { children: ReactNode }) {
  return (
    <div className="min-h-screen">
      <header className="border-b border-stone-200 bg-white">
        <div className="mx-auto flex max-w-6xl items-center gap-6 px-4 py-3">
          <span className="font-semibold">Aangan Studio</span>
          <nav className="flex gap-4 text-sm text-stone-600">
            {nav.map(([href, label]) => (
              <Link key={href} href={href} className="hover:text-stone-900">{label}</Link>
            ))}
          </nav>
        </div>
      </header>
      <main className="mx-auto max-w-6xl px-4 py-6">{children}</main>
    </div>
  );
}
