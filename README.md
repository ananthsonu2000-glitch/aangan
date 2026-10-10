# Aangan Studio — inbound lead system

Vaani call → webhook → Neon → Gemini (rubric) → assignment → Resend + Telegram + HubSpot (+ Google Calendar) → dashboard.

## Setup
1. `cp .env.example .env.local` and fill in values (nothing is hardcoded).
2. `npm run db:push` then `npm run db:seed` (creates Alpha/Beta/Charlie/Delta + Front Desk 1/2 with **placeholder emails** — edit in /admin).
3. `npm run hubspot:setup` (creates the `aangan_*` deal properties).
4. `npm run dev`; sign in with `DASHBOARD_PASSWORD`.
5. Point Vaani's post-call webhook to `POST $APP_URL/api/webhooks/vaani`.
6. Schedule `GET /api/cron/retry` (header `Authorization: Bearer $CRON_SECRET`) every ~5 min to retry stuck calls and failed notifications.

## Flow & guarantees
- Webhook: signature-verified (fails closed), stores raw payload, dedupes on call id, acks fast, processes after response.
- Gemini returns per-criterion verdicts (zod-validated, one automatic retry). **Final status is decided in code** (`decideStatus`) from those verdicts per the rubric, so the model cannot send a failing lead to a designer.
- Assignment: qualified → designers, otherwise → front desk. Strategy `round_robin` (default) or `least_loaded` (admin page / `ASSIGNMENT_STRATEGY`).
- Notifications are deduped (`notifications.dedupe_key`) and logged; failures are retried by cron or the "Retry" button on the lead. HubSpot sync is idempotent (stores contact/deal ids) and logged in `hubspot_sync_logs`.
- Calendar: if a meeting time was agreed, Google event is created with a deterministic id; if Google isn't configured the intent is stored and shown (`calendar_status = pending_config`).

## Unconfirmed
- Vaani payload + signature scheme: all in `src/lib/vaani.ts`. Update when a real sample arrives.
- HubSpot stage ids (`HUBSPOT_STAGE_*`) — check yours.

## Tests
`npm test` (webhook intake, Gemini parsing, qualification branching, assignment, notification/HubSpot/calendar payloads).
`npm run simulate -- t01` sends a signed sample call to a running app.
