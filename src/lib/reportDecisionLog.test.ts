import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { logReportDecision } from "./reportDecisionLog";

test("writes only the structured decision envelope when explicitly enabled", () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "agentlinter-report-log-"));
  const destination = path.join(directory, "decisions.jsonl");
  const previousEnabled = process.env.AGENTLINTER_REPORT_LOG;
  const previousPath = process.env.AGENTLINTER_REPORT_LOG_PATH;
  try {
    process.env.AGENTLINTER_REPORT_LOG = "1";
    process.env.AGENTLINTER_REPORT_LOG_PATH = destination;
    logReportDecision({
      event: "schema_accepted",
      loc: "test.reportDecisionLog",
      ctx: { schemaVersion: 2, diagnosticCount: 1 },
    });

    const record = JSON.parse(fs.readFileSync(destination, "utf8")) as Record<string, unknown>;
    assert.deepStrictEqual(Object.keys(record), ["ts", "run_id", "level", "event", "loc", "ctx"]);
    assert.equal(record.level, "info");
    assert.equal(record.event, "schema_accepted");
    assert.deepStrictEqual(record.ctx, { schemaVersion: 2, diagnosticCount: 1 });
  } finally {
    if (previousEnabled === undefined) delete process.env.AGENTLINTER_REPORT_LOG;
    else process.env.AGENTLINTER_REPORT_LOG = previousEnabled;
    if (previousPath === undefined) delete process.env.AGENTLINTER_REPORT_LOG_PATH;
    else process.env.AGENTLINTER_REPORT_LOG_PATH = previousPath;
    if (fs.existsSync(destination)) fs.unlinkSync(destination);
    fs.rmdirSync(directory);
  }
});
