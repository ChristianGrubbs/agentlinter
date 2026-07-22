import crypto from "node:crypto";
import fs from "node:fs";

type SafeContext = Record<string, number | boolean | null>;

interface ReportDecision {
  event: string;
  loc: string;
  ctx: SafeContext;
  level?: "info" | "warn" | "error";
}

const RUN_ID = crypto.randomUUID();

export function logReportDecision({ event, loc, ctx, level = "info" }: ReportDecision): void {
  if (process.env.AGENTLINTER_REPORT_LOG !== "1") return;
  const destination = process.env.AGENTLINTER_REPORT_LOG_PATH || "/tmp/agentlinter-report-store.jsonl";
  const record = { ts: new Date().toISOString(), run_id: RUN_ID, level, event, loc, ctx };
  try {
    fs.appendFileSync(destination, `${JSON.stringify(record)}\n`, { encoding: "utf8", mode: 0o600 });
  } catch {
    // Decision logging is best effort and must not break report persistence.
  }
}
