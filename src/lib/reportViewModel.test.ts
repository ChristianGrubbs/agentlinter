import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import React, { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

import type { ReportData, ReportDataV2 } from "../app/r/[id]/types";
import { isCliReportV2, type CliReportV2 } from "./localStore";
import ReportClient from "../app/r/[id]/ReportClient";
import CategoriesTab from "../app/r/[id]/components/CategoriesTab";
import DiagnosticsTab from "../app/r/[id]/components/DiagnosticsTab";
import MethodologyTab from "../app/r/[id]/components/MethodologyTab";
import OverviewTab from "../app/r/[id]/components/OverviewTab";
import {
  countedSeverity,
  engineLabel,
  formatPercentage,
  diagnosticMetadataCopy,
  diagnosticTotal,
  hiddenLegacyDiagnosticCount,
  methodologyPolicy,
  reportProvenance,
  ruleCatalogGroups,
  severityStats,
  shareText,
} from "./reportViewModel";

(globalThis as { React?: typeof React }).React = React;

const severityCounts = { critical: 1, error: 2, warning: 3, info: 4 } as const;

const cliFixture: CliReportV2 = {
  schemaVersion: 2,
  engineVersion: "2.4.1",
  scoreKind: "heuristic",
  score: 93,
  grade: "A",
  context: "claude-code",
  timestamp: "2026-07-22T01:02:03.000Z",
  categories: [
    { key: "structure", name: "Structure", score: 95, grade: "A", weight: 0.1, diagnosticCount: 1 },
    { key: "clarity", name: "Clarity", score: 93, grade: "A", weight: 0.15, diagnosticCount: 0 },
    { key: "completeness", name: "Completeness", score: 93, grade: "A", weight: 0.1, diagnosticCount: 0 },
    { key: "security", name: "Security", score: 93, grade: "A", weight: 0.13, diagnosticCount: 0 },
    { key: "consistency", name: "Consistency", score: 93, grade: "A", weight: 0.06, diagnosticCount: 0 },
    { key: "memory", name: "Memory", score: 93, grade: "A", weight: 0.08, diagnosticCount: 0 },
    { key: "runtime", name: "Runtime Config", score: 88, grade: "B+", weight: 0.08, diagnosticCount: 9 },
    { key: "skillSafety", name: "Skill Safety", score: 93, grade: "A", weight: 0.08, diagnosticCount: 0 },
    { key: "remoteReady", name: "Remote-Ready", score: 93, grade: "A", weight: 0.05, diagnosticCount: 0 },
    { key: "blueprint", name: "Blueprint", score: 93, grade: "A", weight: 0.07, diagnosticCount: 0 },
    { key: "freshness", name: "Freshness", score: 93, grade: "A", weight: 0.1, diagnosticCount: 0 },
  ],
  severityCounts,
  ruleSummary: { evaluated: 3, flagged: 2, passed: 1 },
  rules: [
    {
      id: "structure/required-file",
      category: "structure",
      defaultSeverity: "warning",
      description: "Require a primary instruction file.",
      evidence: "schema",
    },
    {
      id: "runtime/env-var-references",
      category: "runtime",
      defaultSeverity: "error",
      description: "Require environment-variable references.",
      evidence: "security",
      source: {
        label: "OWASP Secrets Management Cheat Sheet",
        url: "https://cheatsheetseries.owasp.org/cheatsheets/Secrets_Management_Cheat_Sheet.html",
        asOf: "2026-07-22",
      },
    },
    {
      id: "runtime/timeout",
      category: "runtime",
      defaultSeverity: "info",
      description: "Record timeout guidance.",
      evidence: "advisory",
    },
  ],
  scan: {
    policyVersion: "2026-07-22",
    discovered: 3,
    analyzed: 1,
    aliases: [{ logicalPath: "CLAUDE.md", canonicalPath: "AGENTS.md" }],
    ignored: [{ logicalPath: ".claude/worktrees/task", reason: "generated-worktree" }],
  },
  scoringPolicy: {
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
    skillSafetyScaling: {
      skillCountThreshold: 5,
      errorCap: 60,
      warningPenalty: 2,
      warningCap: 25,
    },
    categoryWeights: {
      structure: 0.10,
      clarity: 0.15,
      completeness: 0.10,
      security: 0.13,
      consistency: 0.06,
      memory: 0.08,
      runtime: 0.08,
      skillSafety: 0.08,
      remoteReady: 0.05,
      blueprint: 0.07,
      freshness: 0.10,
    },
    gradeScale: [
      { grade: "S", min: 98 },
      { grade: "A+", min: 96 },
      { grade: "A", min: 93 },
      { grade: "A-", min: 90 },
      { grade: "B+", min: 85 },
      { grade: "B", min: 80 },
      { grade: "B-", min: 75 },
      { grade: "C+", min: 68 },
      { grade: "C", min: 60 },
      { grade: "C-", min: 55 },
      { grade: "D", min: 50 },
      { grade: "F", min: 0 },
    ],
    disclaimer: "Heuristic configuration score; not a task-performance benchmark or release gate.",
    bonusDescriptions: ["Security: +5 for SECURITY.md"],
  },
  diagnostics: [
    {
      severity: "critical",
      category: "structure",
      rule: "structure/required-file",
      file: "AGENTS.md",
      message: "Primary instruction file is missing.",
    },
    {
      severity: "error",
      category: "runtime",
      rule: "runtime/env-var-references",
      file: "CLAUDE.md",
      message: "Credential guidance should reference an environment variable.",
    },
    ...([
      "error",
      "warning", "warning", "warning",
      "info", "info", "info", "info",
    ] as const).map((severity, index) => ({
      severity,
      category: "runtime" as const,
      rule: "runtime/env-var-references",
      file: `runtime-${index}.json`,
      message: `Recorded runtime diagnostic ${index + 2}.`,
    })),
  ],
  files: ["AGENTS.md"],
};

const reportV2 = {
  id: "v2-run",
  workspace: "/workspace",
  legacy: false,
  schemaVersion: cliFixture.schemaVersion,
  engineVersion: cliFixture.engineVersion,
  scoreKind: cliFixture.scoreKind,
  grade: cliFixture.grade,
  context: cliFixture.context,
  totalScore: cliFixture.score,
  filesScanned: cliFixture.files.length,
  timestamp: cliFixture.timestamp,
  categories: cliFixture.categories,
  severityCounts: cliFixture.severityCounts,
  ruleSummary: cliFixture.ruleSummary,
  rules: cliFixture.rules,
  scan: cliFixture.scan,
  scoringPolicy: cliFixture.scoringPolicy,
  diagnostics: cliFixture.diagnostics,
  files: cliFixture.files,
} satisfies ReportDataV2;

const legacyReport = {
  id: "legacy-run",
  workspace: "/workspace",
  legacy: true,
  schemaVersion: 1,
  engineVersion: null,
  scoreKind: null,
  grade: "C+",
  context: null,
  totalScore: 70,
  filesScanned: 1,
  timestamp: "2026-07-21T01:02:03.000Z",
  categories: [{ key: null, name: "Clarity", score: 70, grade: null, weight: 0.15, diagnosticCount: null }],
  severityCounts: { critical: 1, error: 1, warning: 0, info: 0 },
  ruleSummary: null,
  rules: null,
  scan: null,
  scoringPolicy: null,
  diagnostics: [],
  rawLegacyDiagnostics: [{ severity: "critical" }, { severity: "error" }],
  files: ["AGENTS.md"],
} satisfies ReportData;

test("keeps all four severity counts distinct and uses Report-owned totals", () => {
  assert.equal(isCliReportV2(cliFixture), true, "UI v2 fixture must satisfy the production Report contract");
  assert.deepStrictEqual(severityStats(reportV2), [
    { severity: "critical", label: "critical", count: 1 },
    { severity: "error", label: "error", count: 2 },
    { severity: "warning", label: "warning", count: 3 },
    { severity: "info", label: "info", count: 4 },
  ]);
  assert.equal(diagnosticTotal(reportV2), 10);
  assert.equal(diagnosticTotal(legacyReport), 2);
  assert.equal(hiddenLegacyDiagnosticCount(reportV2), 0);
  assert.equal(hiddenLegacyDiagnosticCount(legacyReport), 2);
  assert.equal(
    diagnosticMetadataCopy(reportV2),
    "10 diagnostics (1 critical, 2 errors, 3 warnings, 4 info)",
  );
  assert.equal(countedSeverity(1, "critical"), "1 critical");
  assert.equal(countedSeverity(2, "critical"), "2 criticals");
  assert.equal(countedSeverity(1, "info"), "1 info");
});

test("share copy names the score honestly and labels legacy Reports", () => {
  assert.equal(shareText(reportV2), "AgentLinter heuristic score: 93/100 (A).");
  assert.equal(shareText(legacyReport), "AgentLinter legacy Report heuristic score: 70/100 (C+).");
});

test("groups schema-v2 rules by catalog category key with stored evidence and weights", () => {
  const groups = ruleCatalogGroups(reportV2);
  assert.ok(groups);
  assert.deepStrictEqual(
    groups.map((group) => [group.key, group.weight]),
    cliFixture.categories.map((category) => [category.key, category.weight]),
    "every stored category appears as a group with its stored weight",
  );
  const structureGroup = groups.find((group) => group.key === "structure");
  const runtimeGroup = groups.find((group) => group.key === "runtime");
  const clarityGroup = groups.find((group) => group.key === "clarity");
  assert.ok(structureGroup && runtimeGroup && clarityGroup);
  assert.deepStrictEqual(structureGroup.rules.map((rule) => ({
    id: rule.id,
    status: rule.status,
    defaultSeverity: rule.defaultSeverity,
    evidenceLabel: rule.evidenceLabel,
  })), [{
    id: "structure/required-file",
    status: "flagged",
    defaultSeverity: "warning",
    evidenceLabel: "Schema",
  }]);
  assert.deepStrictEqual(clarityGroup.rules, [], "a category with no catalog rules stays truthfully empty");
  const withUnrecordedCategory = {
    ...reportV2,
    categories: [
      ...reportV2.categories,
      { key: null, name: "Unrecorded", score: 50, grade: null, weight: null, diagnosticCount: null },
    ],
  } satisfies ReportData;
  assert.equal(
    ruleCatalogGroups(withUnrecordedCategory)?.length,
    reportV2.categories.length,
    "category rows missing key/grade/weight/count are skipped, never fabricated",
  );
  assert.deepStrictEqual(runtimeGroup.rules.map((rule) => ({
    id: rule.id,
    status: rule.status,
    evidenceLabel: rule.evidenceLabel,
    source: rule.source,
  })), [
    {
      id: "runtime/env-var-references",
      status: "flagged",
      evidenceLabel: "Security",
      source: reportV2.rules[1].source,
    },
    {
      id: "runtime/timeout",
      status: "passed",
      evidenceLabel: "Advisory",
      source: undefined,
    },
  ]);
  assert.equal(ruleCatalogGroups(legacyReport), null);
});

test("exposes exact v2 provenance and explicit legacy unavailability", () => {
  assert.equal(engineLabel(reportV2), "2.4.1");
  assert.equal(engineLabel(legacyReport), "legacy");
  assert.deepStrictEqual(reportProvenance(reportV2), {
    engineVersion: "2.4.1",
    schemaVersion: 2,
    context: "claude-code",
    scanPolicyVersion: "2026-07-22",
    discovered: 3,
    analyzed: 1,
    generatedWorktreeIgnoreCount: 1,
    ignored: [{ logicalPath: ".claude/worktrees/task", reason: "generated-worktree" }],
    aliasCount: 1,
    aliases: [{ logicalPath: "CLAUDE.md", canonicalPath: "AGENTS.md" }],
  });
  assert.equal(reportProvenance(legacyReport), null);
});

test("uses every stored scoring-policy field and no legacy substitute", () => {
  const policy = methodologyPolicy(reportV2);
  assert.deepStrictEqual(policy, reportV2.scoringPolicy);
  assert.deepStrictEqual(Object.keys(policy ?? {}).sort(), [
    "basePerCategory",
    "bonusDescriptions",
    "categoryWeights",
    "clarityWarningCap",
    "consistencyErrorPenalty",
    "consistencyFloor",
    "criticalPenalty",
    "defaultErrorPenalty",
    "defaultWarningPenalty",
    "disclaimer",
    "formula",
    "gradeScale",
    "infoCap",
    "infoPenalty",
    "kind",
    "runtimeWarningPenalty",
    "skillSafetyScaling",
  ]);
  assert.equal(methodologyPolicy(legacyReport), null);
  assert.equal(formatPercentage(0.07), "7%");
});

test("renders truthful schema-v2 overview facts and all four severities", () => {
  const html = renderToStaticMarkup(createElement(OverviewTab, {
    data: reportV2,
    onTabChange: () => undefined,
  }));
  for (const copy of [
    "Heuristic score",
    "1 critical",
    "2 errors",
    "3 warnings",
    "4 info",
    reportV2.scoringPolicy.disclaimer,
    "Engine 2.4.1",
    "Schema 2",
    "claude-code",
    "2026-07-22",
    "3 discovered",
    "1 analyzed",
    "1 generated worktree ignored",
    ".claude/worktrees/task",
    "1 alias",
    "CLAUDE.md -&gt; AGENTS.md",
    "Copy Report link",
  ]) assert.match(html, new RegExp(copy));
  assert.doesNotMatch(html, /Token Efficiency|potential savings|files never uploaded|Top \d+%/i);
});

test("renders explicit legacy limitations without fabricated catalog or provenance", () => {
  const overview = renderToStaticMarkup(createElement(OverviewTab, {
    data: legacyReport,
    onTabChange: () => undefined,
  }));
  const categories = renderToStaticMarkup(createElement(CategoriesTab, { data: legacyReport }));
  const methodology = renderToStaticMarkup(createElement(MethodologyTab, { data: legacyReport }));
  const diagnostics = renderToStaticMarkup(createElement(DiagnosticsTab, { data: legacyReport }));
  assert.match(overview, /Legacy Report metadata unavailable/);
  assert.match(overview, /malformed historic diagnostic payloads may not be renderable/);
  assert.match(categories, /Rule catalog not recorded for this Report/);
  assert.match(methodology, /Scoring policy not recorded for this Report/);
  assert.match(diagnostics, /No renderable diagnostics/);
  assert.match(diagnostics, /2 of 2 historic diagnostic payloads could not be rendered/);
  assert.doesNotMatch(`${overview}${categories}${methodology}${diagnostics}`, /rules passed|pass claim/i);
});

test("discloses mixed legacy payloads when raw totals exceed rendered cards", () => {
  const validDiagnostic = {
    severity: "error" as const,
    category: "clarity" as const,
    rule: "clarity/no-vague-instructions",
    file: "AGENTS.md",
    message: "A qualifier is not measurable.",
  };
  const mixedLegacy = {
    ...legacyReport,
    diagnostics: [validDiagnostic],
    rawLegacyDiagnostics: [validDiagnostic, { severity: "critical" }],
  } satisfies ReportData;
  const html = renderToStaticMarkup(createElement(DiagnosticsTab, { data: mixedLegacy }));
  assert.equal(hiddenLegacyDiagnosticCount(mixedLegacy), 1);
  assert.match(html, /1 of 2 historic diagnostic payloads could not be rendered/);
  assert.match(html, /legacy totals can exceed the cards below/);
  assert.match(html, /A qualifier is not measurable/);
});

test("renders v2 catalog statuses, evidence, source, and stored category weights", () => {
  const html = renderToStaticMarkup(createElement(CategoriesTab, { data: reportV2 }));
  for (const copy of [
    "10% weight",
    "8% weight",
    "Require a primary instruction file.",
    "Require environment-variable references.",
    "Schema",
    "Security",
    "Advisory",
    "default warning",
    "default error",
    "flagged",
    "passed",
    "OWASP Secrets Management Cheat Sheet",
    "2026-07-22",
  ]) assert.match(html, new RegExp(copy, "i"));
});

test("renders every stored v2 methodology field and only an unavailable legacy notice", () => {
  const html = renderToStaticMarkup(createElement(MethodologyTab, { data: reportV2 }));
  for (const copy of [
    "Base per category",
    "100",
    reportV2.scoringPolicy.formula,
    "Critical",
    "20",
    "Default error",
    "15",
    "Consistency error",
    "8",
    "Default warning",
    "5",
    "Runtime warning",
    "3",
    "Info",
    "1",
    "Info cap",
    "20",
    "Clarity warning cap",
    "40",
    "Consistency floor",
    "25",
    "Skill count threshold",
    "5",
    "Skill Safety error cap",
    "60",
    "Skill Safety warning",
    "2",
    "Skill Safety warning cap",
    "25",
    "Security: +5 for SECURITY.md",
    reportV2.scoringPolicy.disclaimer,
  ]) assert.match(html, new RegExp(copy.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i"));
  for (const [category, weight] of Object.entries(reportV2.scoringPolicy.categoryWeights)) {
    assert.match(html, new RegExp(`${category}.*${formatPercentage(weight)}`, "i"));
  }
  for (const entry of reportV2.scoringPolicy.gradeScale) {
    assert.match(html, new RegExp(`${entry.grade}.*${entry.min}`, "i"));
  }
});

test("renders four independent diagnostic filters and Report-owned Engine labels", () => {
  const diagnostics = renderToStaticMarkup(createElement(DiagnosticsTab, { data: reportV2 }));
  for (const copy of ["1 critical", "2 errors", "3 warnings", "4 info"]) {
    assert.match(diagnostics, new RegExp(copy));
  }
  const v2Page = renderToStaticMarkup(createElement(ReportClient, { data: reportV2 }));
  const legacyPage = renderToStaticMarkup(createElement(ReportClient, { data: legacyReport }));
  assert.match(v2Page, /Engine 2.4.1/);
  assert.match(legacyPage, /Engine legacy/);
});

test("keeps banned invented claims out of live Report sources", () => {
  const reportRoot = path.resolve(process.cwd(), "src/app/r");
  const sources = [
    "[id]/ReportClient.tsx",
    "[id]/page.tsx",
    "[id]/components/OverviewTab.tsx",
    "[id]/components/DiagnosticsTab.tsx",
    "[id]/components/CategoriesTab.tsx",
    "[id]/components/MethodologyTab.tsx",
    "[id]/components/TabBar.tsx",
    "[id]/components/useCopyReportLink.ts",
    "[id]/constants/category-meta.ts",
    "[id]/constants/rule-education.ts",
    "[id]/utils/getTier.ts",
  ].map((file) => fs.readFileSync(path.join(reportRoot, file), "utf8")).join("\n");
  assert.doesNotMatch(sources, /Fix all|issues found|Top [0-9]|Median|v0\.1\.0|v2\.3\.0|SCORING_METHODOLOGY/);
  assert.doesNotMatch(sources, /files never uploaded|100% locally|contains only scores and diagnostic messages|Token Efficiency|potential savings/i);
});
