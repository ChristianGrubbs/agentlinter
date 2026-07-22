import assert from "node:assert/strict";
import test from "node:test";
import { formatJSON } from "../reporter";
import { lint } from "../scorer";
import type { FileInfo } from "../types";

function fixture(content: string): FileInfo {
  return {
    name: "AGENTS.md",
    path: "/workspace/AGENTS.md",
    workspaceRoot: "/workspace",
    canonicalPath: "/workspace/AGENTS.md",
    content,
    lines: content.split("\n"),
    sections: [],
    context: "universal",
  };
}

function reportFor(content: string) {
  const result = lint("/workspace", [fixture(content)]);
  const formatJSONV2 = formatJSON as (result: typeof result, options: { engineVersion: string }) => string;
  return JSON.parse(formatJSONV2(result, { engineVersion: "2.4.0" })) as Record<string, unknown>;
}

function requireV2(report: Record<string, unknown>) {
  assert.equal(report.schemaVersion, 2, "Report must declare schemaVersion: 2");
  assert.equal(report.engineVersion, "2.4.0");
  assert.equal(report.scoreKind, "heuristic");
  assert.equal(typeof report.grade, "string");
  assert.ok(report.scan);
  assert.ok(report.ruleSummary);
  assert.ok(Array.isArray(report.rules));
  assert.ok(report.scoringPolicy);
}

test("serializes the schema-v2 Report contract with complete severity and rule counts", () => {
  const report = reportFor("# Agent\nBe helpful.");
  requireV2(report);

  const severityCounts = report.severityCounts as Record<string, number>;
  assert.deepStrictEqual(Object.keys(severityCounts).sort(), ["critical", "error", "info", "warning"]);
  assert.equal(Object.values(severityCounts).reduce((sum, count) => sum + count, 0), (report.diagnostics as unknown[]).length);

  const ruleSummary = report.ruleSummary as { evaluated: number; flagged: number; passed: number };
  assert.equal(ruleSummary.evaluated, (report.rules as unknown[]).length);
  assert.equal(ruleSummary.flagged + ruleSummary.passed, ruleSummary.evaluated);

  const categories = report.categories as Array<{ key: string; weight: number; diagnosticCount: number }>;
  assert.ok(categories.every((category) => typeof category.key === "string"));
  assert.equal(categories.reduce((sum, category) => sum + category.weight, 0), 1);
  assert.equal(categories.reduce((sum, category) => sum + category.diagnosticCount, 0), (report.diagnostics as unknown[]).length);
});

test("normalizes deterministic Reports by excluding only their timestamp", () => {
  const first = reportFor("# Agent\nBe helpful.");
  const second = reportFor("# Agent\nBe helpful.");
  requireV2(first);
  requireV2(second);

  const { timestamp: firstTimestamp, ...firstNormalized } = first;
  const { timestamp: secondTimestamp, ...secondNormalized } = second;
  assert.equal(typeof firstTimestamp, "string");
  assert.equal(typeof secondTimestamp, "string");
  assert.deepStrictEqual(firstNormalized, secondNormalized);
});
