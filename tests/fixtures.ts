import type { Evaluation } from "../src/lib/qualification";

// Condensed from the September 2026 enquiry transcripts (T01, T03, T04, T10). Payload shape is a GUESS until Vaani sample arrives.
export const SAMPLE_CALLS = {
  t01: {
    payload: {
      call_id: "t01", from: "9822012345", duration: 252, started_at: "2026-09-02T10:23:00+05:30",
      transcript: "Caller: Hi, I'm Priya. We have a 3BHK in Kothrud, Dahanukar Colony. We want to redo the whole thing - kitchen, living room, both bedrooms. About 1,400 sq ft carpet. We'd like to be done by March. Yes, myself and my husband own it; he is happy to go ahead.",
    },
    expected: "qualified" as const,
  },
  t03: {
    payload: { call_id: "t03", from: "9822099999", duration: 160, started_at: "2026-09-03T16:15:00+05:30", transcript: "Caller: I'm Suresh Patil in Nashik. I want to redo my home office and study. Front Desk: We only work in Pune and PCMC." },
    expected: "needs_recheck" as const,
  },
  t04: {
    payload: { call_id: "t04", from: "9822011111", duration: 200, started_at: "2026-09-04T11:07:00+05:30", transcript: "Caller: Can someone come and give us some ideas for our living room? Just suggestions on colours and furniture arrangement." },
    expected: "needs_recheck" as const,
  },
  t10: {
    payload: { call_id: "t10", from: "9822022222", duration: 220, started_at: "2026-09-11T14:04:00+05:30", transcript: "Caller: 1BHK in Kharadi, 550 sq ft. Kitchen and one bedroom. Budget 1 to 1.5 lakh maximum for everything." },
    expected: "needs_recheck" as const,
  },
};

const ok = { result: "pass" as const, note: "" };
export const evalJson = (over: Partial<Evaluation> = {}): Evaluation => ({
  status: "qualified", score: 88, reason: "Full home redesign in Kothrud, March timeline.",
  employeeSummary: "Priya, 3BHK Kothrud, full redesign by March.", founderSummary: "Strong lead: 3BHK Kothrud.",
  leadType: "new_enquiry",
  criteria: { realProject: ok, serviceArea: ok, timeline: ok, budget: ok, decisionMaker: ok },
  extracted: { name: "Priya", phone: "9822012345", email: null, location: "Kothrud, Pune", projectType: "3BHK full home", budget: null, timeline: "by March", designRequirement: "Kitchen, living room, 2 bedrooms", agreedMeetingTime: null },
  ...over,
});
