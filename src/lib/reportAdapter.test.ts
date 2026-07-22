import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

const legacyReport = {
  id: "legacy-run",
  workspace: "/workspace",
  machine_id: "machine",
  score: 70,
  categories: [{ name: "Clarity", score: 70, weight: 0.15 }],
  diagnostics: [
    { severity: "critical", rule: "critical-rule" },
    { severity: "error", rule: "error-rule" },
    { severity: "warning", rule: "warning-rule" },
    { severity: "info", rule: "info-rule" },
  ],
  file_names: ["AGENTS.md"],
  files_scanned: 1,
  rules_checked: 4,
  created_at: "2026-07-22T00:00:00.000Z",
};

test("adapts schema-v1 Reports without inventing Engine provenance", async () => {
  const adapterUrl = new URL("./reportAdapter.ts", import.meta.url);
  assert.equal(fs.existsSync(adapterUrl), true, "reportAdapter.ts should provide the legacy adapter");

  const { adaptStoredReport } = await import("./reportAdapter");
  const adapted = adaptStoredReport(legacyReport);

  assert.equal(adapted.legacy, true);
  assert.deepStrictEqual(adapted.severityCounts, {
    critical: 1,
    error: 1,
    warning: 1,
    info: 1,
  });
  assert.equal(adapted.engineVersion, null);
  assert.equal(adapted.scan, null);
  assert.equal(adapted.rules, null);
  assert.equal(adapted.ruleSummary, null);
  assert.equal(adapted.scoringPolicy, null);
  assert.equal(adapted.grade, "C+");
});
