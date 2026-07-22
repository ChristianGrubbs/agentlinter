import assert from "node:assert/strict";
import test from "node:test";
import { formatJSON } from "../reporter";
import { allRules } from "../rules";
import { lint } from "../scorer";
import {
  CATEGORY_LABELS,
  CATEGORY_WEIGHTS,
  type FileInfo,
  type RuleEvidence,
  type ScanSummary,
  type Severity,
} from "../types";

const scan: ScanSummary = {
  policyVersion: "2026-07-22",
  discovered: 1,
  analyzed: 1,
  aliases: [],
  ignored: [],
};

const scoringPolicy = {
  kind: "heuristic",
  basePerCategory: 100,
  formula: "round(sum(categoryScore * categoryWeight))",
  criticalPenalty: 20,
  defaultErrorPenalty: 15,
  consistencyErrorPenalty: 8,
  defaultWarningPenalty: 5,
  runtimeWarningPenalty: 3,
  infoPenalty: 1,
  infoCap: 20,
  clarityWarningCap: 40,
  consistencyFloor: 25,
  categoryWeights: CATEGORY_WEIGHTS,
  gradeScale: [
    { grade: "S", min: 98 }, { grade: "A+", min: 96 },
    { grade: "A", min: 93 }, { grade: "A-", min: 90 },
    { grade: "B+", min: 85 }, { grade: "B", min: 80 },
    { grade: "B-", min: 75 }, { grade: "C+", min: 68 },
    { grade: "C", min: 60 }, { grade: "C-", min: 55 },
    { grade: "D", min: 50 }, { grade: "F", min: 0 },
  ],
  disclaimer: "Heuristic configuration score; not a task-performance benchmark or release gate.",
  bonusDescriptions: [
    "Structure: +5 for 3 Markdown files and another +5 for 5",
    "Clarity: +5 for an example or code block",
    "Completeness: +2 for each of SOUL.md, IDENTITY.md, USER.md, TOOLS.md, SECURITY.md",
    "Security: +5 for SECURITY.md and +5 for injection/jailbreak guidance",
    "Consistency: +5 for consistent uppercase root Markdown names",
    "Memory: +5 MEMORY.md, +3 HEARTBEAT.md, +3 progress file, +5 memory directory",
    "Runtime: +5 config, +10 environment-variable pattern, +5 strong auth, +5 allowlist groups, +5 restrictive direct messages",
    "Skill Safety: +10 no skills; otherwise up to +10 frontmatter coverage and +5 description coverage",
    "Remote Ready: +5 each for workspace path, environment-variable docs, model setting, and Runtime section",
  ],
};

const RULE_EVIDENCE = new Set<RuleEvidence>([
  "schema",
  "invariant",
  "security",
  "empirical",
  "advisory",
]);

const REQUIRED_EVIDENCE: Record<string, RuleEvidence> = {
  "claude-code/hooks-structure": "schema",
  "structure/dead-import": "schema",
  "consistency/referenced-files-exist": "invariant",
  "runtime/config-secrets": "security",
  "security/no-secrets": "security",
  "security/has-injection-defense": "security",
  "security/prompt-injection-vulnerability": "security",
  "security/no-injection-defense": "security",
  "skill-safety/dangerous-commands": "security",
  "skill-safety/data-exfiltration": "security",
  "skill-safety/injection-vectors": "security",
};

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
  const lintWithScan = lint as unknown as (
    workspacePath: string,
    files: FileInfo[],
    options: { scan: ScanSummary },
  ) => ReturnType<typeof lint>;
  const result = lintWithScan("/workspace", [fixture(content)], { scan });
  const formatJSONV2 = formatJSON as unknown as (
    lintResult: ReturnType<typeof lint>,
    options: { engineVersion: string },
  ) => string;
  return { result, report: JSON.parse(formatJSONV2(result, { engineVersion: "2.4.0" })) as Record<string, unknown> };
}

function applicableRules() {
  return allRules.filter((rule) =>
    !rule.applicableContexts
    || rule.applicableContexts.includes("universal"),
  );
}

function gradeFor(score: number): string {
  return scoringPolicy.gradeScale.find((tier) => score >= tier.min)?.grade ?? "F";
}

function requireV2(report: Record<string, unknown>) {
  assert.equal(report.schemaVersion, 2, "Report must declare schemaVersion: 2");
  assert.equal(report.engineVersion, "2.4.0");
  assert.equal(report.scoreKind, "heuristic");
  assert.equal(typeof report.grade, "string");
  assert.ok(Array.isArray(report.diagnostics));
  assert.ok(Array.isArray(report.files));
  assert.ok(Array.isArray(report.categories));
  assert.ok(Array.isArray(report.rules), "Report must serialize its applicable rule catalog");
}

test("serializes the schema-v2 Report contract with complete severity, scan, rule, and policy truth", () => {
  const { result, report } = reportFor("# Agent\nBe helpful.");
  requireV2(report);

  const diagnostics = report.diagnostics as Array<{ severity: Severity; rule: string }>;
  assert.ok(diagnostics.length > 0, "fixture must exercise a real diagnostic");
  const severityCounts = report.severityCounts as Record<Severity, number>;
  const expectedSeverityCounts = diagnostics.reduce<Record<Severity, number>>(
    (counts, diagnostic) => ({ ...counts, [diagnostic.severity]: counts[diagnostic.severity] + 1 }),
    { critical: 0, error: 0, warning: 0, info: 0 },
  );
  assert.deepStrictEqual(severityCounts, expectedSeverityCounts);
  assert.equal(Object.values(severityCounts).reduce((sum, count) => sum + count, 0), diagnostics.length);

  assert.deepStrictEqual(report.scan, scan);

  const rules = report.rules as Array<{
    id: string;
    category: string;
    defaultSeverity: Severity;
    description: string;
    evidence: RuleEvidence;
    source?: { label: string; url: string; asOf: string };
  }>;
  const expectedRules = applicableRules();
  assert.ok(rules.length > 0, "Applicable rule catalog must not be empty");
  const catalogProjection = rules.map(({ id, category, defaultSeverity, description, evidence }) => ({
    id,
    category,
    defaultSeverity,
    description,
    evidence,
  }));
  assert.deepStrictEqual(
    catalogProjection.map(({ evidence: _, ...rule }) => rule),
    expectedRules.map(({ id, category, severity, description }) => ({ id, category, defaultSeverity: severity, description })),
  );
  for (const rule of catalogProjection) {
    assert.ok(RULE_EVIDENCE.has(rule.evidence), `${rule.id} must declare a valid evidence class`);
  }
  for (const [id, evidence] of Object.entries(REQUIRED_EVIDENCE)) {
    assert.equal(rules.find((rule) => rule.id === id)?.evidence, evidence, `${id} evidence`);
  }
  const hooksRule = expectedRules.find((rule) => rule.id === "claude-code/hooks-structure");
  assert.ok(hooksRule, "Expected hooks rule to be applicable to the universal fixture");
  const hooksCatalogEntry = rules.find((rule) => rule.id === "claude-code/hooks-structure");
  assert.deepStrictEqual(
    {
      id: hooksCatalogEntry?.id,
      category: hooksCatalogEntry?.category,
      defaultSeverity: hooksCatalogEntry?.defaultSeverity,
      description: hooksCatalogEntry?.description,
      evidence: hooksCatalogEntry?.evidence,
      sourceUrl: hooksCatalogEntry?.source?.url,
      sourceAsOf: hooksCatalogEntry?.source?.asOf,
    },
    {
      id: hooksRule.id,
      category: hooksRule.category,
      defaultSeverity: hooksRule.severity,
      description: hooksRule.description,
      evidence: "schema",
      sourceUrl: "https://code.claude.com/docs/en/hooks",
      sourceAsOf: "2026-07-22",
    },
  );
  assert.ok(hooksCatalogEntry?.source?.label.trim(), "Hook provenance requires a non-empty source label");

  const flagged = new Set(diagnostics.map((diagnostic) => diagnostic.rule));
  const ruleSummary = report.ruleSummary as { evaluated: number; flagged: number; passed: number };
  assert.deepStrictEqual(ruleSummary, {
    evaluated: rules.length,
    flagged: flagged.size,
    passed: rules.length - flagged.size,
  });
  assert.ok(ruleSummary.evaluated > 0);
  assert.ok(ruleSummary.flagged > 0);
  assert.ok(diagnostics.every((diagnostic) => rules.some((rule) => rule.id === diagnostic.rule)));

  assert.deepStrictEqual(report.scoringPolicy, scoringPolicy);

  const categories = report.categories as Array<{
    key: keyof typeof CATEGORY_WEIGHTS;
    name: string;
    score: number;
    grade: string;
    weight: number;
    diagnosticCount: number;
  }>;
  assert.deepStrictEqual(
    categories,
    result.categories.map((category) => ({
      key: category.category,
      name: CATEGORY_LABELS[category.category],
      score: category.score,
      grade: gradeFor(category.score),
      weight: category.weight,
      diagnosticCount: category.diagnostics.length,
    })),
  );
  assert.equal(categories.reduce((sum, category) => sum + category.weight, 0), 1);
  assert.equal(categories.reduce((sum, category) => sum + category.diagnosticCount, 0), diagnostics.length);
  assert.equal(report.score, result.totalScore);
  assert.equal(report.grade, gradeFor(result.totalScore));
});

test("normalizes deterministic Reports by excluding only their timestamp", () => {
  const first = reportFor("# Agent\nBe helpful.").report;
  const second = reportFor("# Agent\nBe helpful.").report;
  requireV2(first);
  requireV2(second);

  const { timestamp: firstTimestamp, ...firstNormalized } = first;
  const { timestamp: secondTimestamp, ...secondNormalized } = second;
  assert.equal(typeof firstTimestamp, "string");
  assert.equal(typeof secondTimestamp, "string");
  assert.deepStrictEqual(firstNormalized, secondNormalized);
});
