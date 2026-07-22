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

async function loadAdapter() {
  const adapterUrl = new URL("./reportAdapter.ts", import.meta.url);
  assert.equal(fs.existsSync(adapterUrl), true, "reportAdapter.ts should provide the legacy adapter");
  return import("./reportAdapter");
}

test("adapts schema-v1 Reports without inventing Engine provenance", async () => {
  const { adaptStoredReport } = await loadAdapter();
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

test("uses the exact CLI grade ladder for legacy fallback display", async () => {
  const { adaptStoredReport } = await loadAdapter();
  const gradeCases = [
    [100, "S"], [98, "S"], [97, "A+"], [96, "A+"], [95, "A"], [93, "A"],
    [92, "A-"], [90, "A-"], [89, "B+"], [85, "B+"], [84, "B"], [80, "B"],
    [79, "B-"], [75, "B-"], [74, "C+"], [68, "C+"], [67, "C"], [60, "C"],
    [59, "C-"], [55, "C-"], [54, "D"], [50, "D"], [49, "F"], [0, "F"],
  ] as const;

  for (const [score, grade] of gradeCases) {
    assert.equal(adaptStoredReport({ ...legacyReport, score }).grade, grade, `score ${score}`);
  }
});
