// Local filesystem report store — replaces Supabase (ADR 0002).
// Data dir: $AGENTLINTER_DATA_DIR, else ../reports relative to the app cwd.
import fs from "node:fs";
import path from "node:path";

const DATA_DIR = process.env.AGENTLINTER_DATA_DIR
  ? path.resolve(process.env.AGENTLINTER_DATA_DIR)
  : path.resolve(process.cwd(), "..", "reports");

export interface StoredReport {
  id: string;
  workspace: string;
  machine_id: string;
  score: number;
  categories: { name: string; score: number; weight?: number }[];
  diagnostics: unknown[];
  file_names: string[];
  files_scanned: number;
  rules_checked: number;
  created_at: string;
}

const SAFE_ID = /^[A-Za-z0-9_-]{1,32}$/;

function ensureDir(): void {
  fs.mkdirSync(DATA_DIR, { recursive: true });
}

export function writeReport(report: StoredReport): void {
  ensureDir();
  const body = JSON.stringify(report, null, 2);
  fs.writeFileSync(path.join(DATA_DIR, `${report.id}.json`), body);
  fs.writeFileSync(path.join(DATA_DIR, "latest.json"), body);
}

export function readReport(id: string): StoredReport | null {
  if (!SAFE_ID.test(id)) return null;
  try {
    return JSON.parse(fs.readFileSync(path.join(DATA_DIR, `${id}.json`), "utf-8")) as StoredReport;
  } catch {
    return null;
  }
}

export function listReports(limit = 50): Pick<StoredReport, "id" | "workspace" | "score" | "created_at">[] {
  ensureDir();
  const rows: StoredReport[] = [];
  for (const f of fs.readdirSync(DATA_DIR)) {
    if (!f.endsWith(".json") || f === "latest.json") continue;
    try {
      rows.push(JSON.parse(fs.readFileSync(path.join(DATA_DIR, f), "utf-8")) as StoredReport);
    } catch {
      /* skip unreadable file */
    }
  }
  rows.sort((a, b) => (a.created_at < b.created_at ? 1 : -1));
  return rows.slice(0, limit).map((r) => ({ id: r.id, workspace: r.workspace, score: r.score, created_at: r.created_at }));
}
