import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { COOKIE, createSession } from "@/lib/auth";

async function login(formData: FormData) {
  "use server";
  const pw = String(formData.get("password") ?? "");
  const expected = process.env.DASHBOARD_PASSWORD;
  const secret = process.env.AUTH_SECRET;
  if (!expected || !secret || pw !== expected) redirect("/login?error=1");
  (await cookies()).set(COOKIE, await createSession(secret), { httpOnly: true, secure: process.env.NODE_ENV === "production", sameSite: "lax", path: "/", maxAge: 7 * 86400 });
  redirect("/");
}

export default async function LoginPage({ searchParams }: { searchParams: Promise<{ error?: string }> }) {
  const { error } = await searchParams;
  return (
    <main className="min-h-screen grid place-items-center bg-stone-50">
      <form action={login} className="w-80 rounded-xl border border-stone-200 bg-white p-6 shadow-sm space-y-4">
        <h1 className="text-lg font-semibold text-stone-900">Aangan Studio · Leads</h1>
        <input name="password" type="password" placeholder="Password" required className="w-full rounded-md border border-stone-300 px-3 py-2 text-sm" />
        {error && <p className="text-sm text-red-600">Incorrect password.</p>}
        <button className="w-full rounded-md bg-stone-900 py-2 text-sm font-medium text-white">Sign in</button>
      </form>
    </main>
  );
}
