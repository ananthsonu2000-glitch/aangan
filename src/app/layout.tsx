import "./globals.css";
import type { ReactNode } from "react";

export const metadata = { title: "Aangan Studio · Leads" };

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body className="bg-stone-50 text-stone-900 antialiased">{children}</body>
    </html>
  );
}
