// Runs the source-built Engine against a Workspace, stores the Report,
// appends a Score Log row to the vault (best-effort). Read-only: --local
// always, --fix never (ADR 0002, ADR 0003).
import { NextRequest, NextResponse } from "next/server";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import crypto from "node:crypto";
import { nanoid } from "nanoid";
import {
  buildStoredReportV2,
  parseCliReportV2,
  REPORT_SCHEMA_ERROR,
  writeReport,
  type StoredReportV2,
} from "@/lib/localStore";
import { isSameOrigin } from "@/lib/sameOrigin";

const pExecFile = promisify(execFile);
const CLI = process.env.AGENTLINTER_CLI
  ? path.resolve(process.env.AGENTLINTER_CLI)
  : path.resolve(process.cwd(), "packages/cli/dist/bin.js");
const OBSIDIAN_CLI = path.join(os.homedir(), "ai-stack", "bin", "obsidian-cli");
const SCORE_LOG = "30 Tools-Models/Doc Sets/AgentLinter/AgentLinter Score Log.md";

let running = false; // one Run at a time

function extractJSON(stdout: string): unknown {
  const start = stdout.indexOf("{");
  const end = stdout.lastIndexOf("}");
  if (start === -1 || end <= start) throw new Error(REPORT_SCHEMA_ERROR);
  try {
    return JSON.parse(stdout.slice(start, end + 1));
  } catch {
    throw new Error(REPORT_SCHEMA_ERROR);
  }
}

function appendScoreLog(r: StoredReportV2): void {
  const crit = r.severityCounts.critical;
  const warn = r.severityCounts.warning;
  const home = os.homedir();
  const shownWs = (r.workspace.startsWith(home) ? r.workspace.replace(home, "~") : r.workspace).replaceAll("|", "\\|");
  const row = `| ${r.created_at.slice(0, 10)} | \`${shownWs}\` | ${r.score} | ${r.grade} | ${crit} | ${warn} | \`reports/${r.id}.json\` |`;
  // execFile with an args array: no shell, so backticks in the row are inert.
  execFile(OBSIDIAN_CLI, ["append", SCORE_LOG, "-m", row], (err) => {
    if (err) console.error("score-log append failed (run still stored):", err.message);
  });
}

export async function POST(req: NextRequest) {
  if (!isSameOrigin(req)) {
    return NextResponse.json({ error: "Cross-origin requests are not allowed" }, { status: 403 });
  }
  if (running) return NextResponse.json({ error: "A run is already in progress" }, { status: 409 });
  let workspace: unknown;
  try {
    ({ workspace } = await req.json());
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }
  if (
    typeof workspace !== "string" ||
    !path.isAbsolute(workspace) ||
    !fs.existsSync(workspace) ||
    !fs.statSync(workspace).isDirectory()
  ) {
    return NextResponse.json({ error: "workspace must be an absolute path to an existing directory" }, { status: 400 });
  }
  running = true;
  try {
    const { stdout } = await pExecFile(
      process.execPath,
      [CLI, workspace, "--local", "--json", "--no-audit"],
      { timeout: 180_000, maxBuffer: 32 * 1024 * 1024 }
    );
    const cli = parseCliReportV2(extractJSON(stdout));
    const report: StoredReportV2 = buildStoredReportV2({
      cli,
      localMetadata: {
        id: nanoid(12),
        workspace,
        machine_id: crypto.createHash("sha256").update(`${os.hostname()}-${os.userInfo().username}`).digest("hex").slice(0, 32),
      },
    });
    writeReport(report);
    appendScoreLog(report);
    return NextResponse.json({ id: report.id, url: `/r/${report.id}`, score: report.score, grade: report.grade });
  } catch (e) {
    console.error("run failed:", e);
    return NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status: 500 });
  } finally {
    running = false;
  }
}
