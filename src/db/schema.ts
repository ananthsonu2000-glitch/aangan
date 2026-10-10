import { pgTable, uuid, text, timestamp, integer, boolean, jsonb, uniqueIndex, index } from "drizzle-orm/pg-core";

export const employees = pgTable("employees", {
  id: uuid("id").primaryKey().defaultRandom(),
  name: text("name").notNull(),
  email: text("email").notNull(),
  telegramChatId: text("telegram_chat_id"), // personal chat; falls back to the role group chat from env
  role: text("role", { enum: ["designer", "front_desk", "admin"] }).notNull(),
  active: boolean("active").notNull().default(true),
  sortOrder: integer("sort_order").notNull().default(0),
  lastAssignedAt: timestamp("last_assigned_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const leads = pgTable(
  "leads",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    status: text("status", { enum: ["new", "qualified", "needs_recheck", "failed"] }).notNull().default("new"),
    score: integer("score"),
    name: text("name"),
    phone: text("phone"),
    email: text("email"),
    location: text("location"),
    projectType: text("project_type"),
    budget: text("budget"),
    timeline: text("timeline"),
    designRequirement: text("design_requirement"),
    meetingTime: timestamp("meeting_time", { withTimezone: true }),
    calendarStatus: text("calendar_status", { enum: ["none", "pending_config", "created", "failed"] }).notNull().default("none"),
    calendarEventId: text("calendar_event_id"),
    calendarLink: text("calendar_link"),
    assignedToId: uuid("assigned_to_id").references(() => employees.id),
    assignmentState: text("assignment_state", { enum: ["open", "done"] }).notNull().default("open"),
    founderSummary: text("founder_summary"),
    employeeSummary: text("employee_summary"),
    hubspotContactId: text("hubspot_contact_id"),
    hubspotDealId: text("hubspot_deal_id"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("leads_phone_idx").on(t.phone), index("leads_status_idx").on(t.status)],
);

export const calls = pgTable(
  "calls",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    externalCallId: text("external_call_id").notNull(),
    leadId: uuid("lead_id").references(() => leads.id),
    rawPayload: jsonb("raw_payload").notNull(),
    transcript: text("transcript"),
    callerNumber: text("caller_number"),
    startedAt: timestamp("started_at", { withTimezone: true }),
    durationSec: integer("duration_sec"),
    agreedMeetingTimeHint: text("agreed_meeting_time_hint"),
    signatureValid: boolean("signature_valid").notNull(),
    processingStatus: text("processing_status", { enum: ["received", "processing", "done", "failed"] }).notNull().default("received"),
    processingError: text("processing_error"),
    attempts: integer("attempts").notNull().default(0),
    receivedAt: timestamp("received_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex("calls_external_id_uq").on(t.externalCallId)],
);

export const aiEvaluations = pgTable(
  "ai_evaluations",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    leadId: uuid("lead_id").notNull().references(() => leads.id),
    callId: uuid("call_id").notNull().references(() => calls.id),
    model: text("model").notNull(),
    status: text("status", { enum: ["qualified", "needs_recheck"] }).notNull(), // final, after rule enforcement
    modelStatus: text("model_status").notNull(), // what Gemini said
    score: integer("score").notNull(),
    reason: text("reason").notNull(),
    employeeSummary: text("employee_summary").notNull(),
    founderSummary: text("founder_summary").notNull(),
    criteria: jsonb("criteria").notNull(),
    extracted: jsonb("extracted").notNull(),
    raw: jsonb("raw").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex("ai_eval_call_uq").on(t.callId)],
);

export const assignments = pgTable("assignments", {
  id: uuid("id").primaryKey().defaultRandom(),
  leadId: uuid("lead_id").notNull().references(() => leads.id),
  employeeId: uuid("employee_id").notNull().references(() => employees.id),
  role: text("role").notNull(),
  strategy: text("strategy").notNull(),
  reason: text("reason"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const notifications = pgTable(
  "notifications",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    leadId: uuid("lead_id").notNull().references(() => leads.id),
    channel: text("channel", { enum: ["email", "telegram"] }).notNull(),
    recipient: text("recipient").notNull(),
    payload: jsonb("payload").notNull(),
    dedupeKey: text("dedupe_key").notNull(), // lead + channel + recipient + event => retry-safe
    status: text("status", { enum: ["pending", "sent", "failed"] }).notNull().default("pending"),
    attempts: integer("attempts").notNull().default(0),
    lastError: text("last_error"),
    sentAt: timestamp("sent_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex("notifications_dedupe_uq").on(t.dedupeKey)],
);

export const hubspotSyncLogs = pgTable("hubspot_sync_logs", {
  id: uuid("id").primaryKey().defaultRandom(),
  leadId: uuid("lead_id").notNull().references(() => leads.id),
  operation: text("operation").notNull(),
  status: text("status", { enum: ["success", "failed"] }).notNull(),
  request: jsonb("request"),
  response: jsonb("response"),
  error: text("error"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const appConfig = pgTable("app_config", {
  key: text("key").primaryKey(), // rubric | assignment_strategy | notification_recipients
  value: jsonb("value").notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export type Employee = typeof employees.$inferSelect;
export type Lead = typeof leads.$inferSelect;
export type Call = typeof calls.$inferSelect;
