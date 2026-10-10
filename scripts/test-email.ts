// Sends a sample assignment email for a lead to a chosen address: `npm run test:email -- <lead-id> <to>`
import { eq } from "drizzle-orm";
import nodemailer from "nodemailer";
import { db, leads } from "../src/db";
import { buildEmail } from "../src/lib/payloads";
import { emailProvider } from "../src/lib/integrations";

async function main() {
  const [id, to] = process.argv.slice(2);
  if (!id || !to) throw new Error("usage: npm run test:email -- <lead-id> <to>");
  console.log("provider:", emailProvider());
  const [lead] = await db().select().from(leads).where(eq(leads.id, id));
  const e = buildEmail(lead, "Test", lead.status === "qualified" ? "designer" : "front_desk", process.env.APP_URL || "http://localhost:3000");
  const user = process.env.GMAIL_USER!;
  const t = nodemailer.createTransport({ host: "smtp.gmail.com", port: 465, secure: true, auth: { user, pass: process.env.GMAIL_APP_PASSWORD!.replace(/\s+/g, "") } });
  const info = await t.sendMail({ from: process.env.EMAIL_FROM || `Aangan Studio <${user}>`, to, subject: `[TEST] ${e.subject}`, html: e.html, text: e.text });
  console.log("sent:", info.accepted, info.response);
}
main().catch((err) => { console.error("FAILED:", err.message); process.exit(1); });
