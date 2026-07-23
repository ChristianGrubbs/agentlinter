import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import type { CliReportV2 } from "./localStore";

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

const validRuleSource = {
  label: "OWASP Secrets Management Cheat Sheet",
  url: "https://cheatsheetseries.owasp.org/cheatsheets/Secrets_Management_Cheat_Sheet.html",
  asOf: "2026-07-22",
};

const cliReportV2 = {
  schemaVersion: 2,
  engineVersion: "2.4.1",
  scoreKind: "heuristic",
  score: 93,
  grade: "A",
  context: "claude-code",
  categories: [
    { key: "structure", name: "Structure", score: 93, grade: "A", weight: 0.10, diagnosticCount: 0 },
    { key: "clarity", name: "Clarity", score: 93, grade: "A", weight: 0.15, diagnosticCount: 0 },
    { key: "completeness", name: "Completeness", score: 93, grade: "A", weight: 0.10, diagnosticCount: 0 },
    { key: "security", name: "Security", score: 93, grade: "A", weight: 0.13, diagnosticCount: 1 },
    { key: "consistency", name: "Consistency", score: 93, grade: "A", weight: 0.06, diagnosticCount: 0 },
    { key: "memory", name: "Memory", score: 93, grade: "A", weight: 0.08, diagnosticCount: 0 },
    { key: "runtime", name: "Runtime Config", score: 93, grade: "A", weight: 0.08, diagnosticCount: 0 },
    { key: "skillSafety", name: "Skill Safety", score: 93, grade: "A", weight: 0.08, diagnosticCount: 0 },
    { key: "remoteReady", name: "Remote-Ready", score: 93, grade: "A", weight: 0.05, diagnosticCount: 0 },
    { key: "blueprint", name: "Blueprint", score: 93, grade: "A", weight: 0.07, diagnosticCount: 0 },
    { key: "freshness", name: "Freshness", score: 93, grade: "A", weight: 0.10, diagnosticCount: 0 },
  ],
  severityCounts: { critical: 0, error: 1, warning: 0, info: 0 },
  ruleSummary: { evaluated: 2, flagged: 1, passed: 1 },
  rules: [
    {
      id: "security/env-var-references",
      category: "security",
      defaultSeverity: "error",
      description: "Require environment-variable references for credentials.",
      evidence: "security",
      source: validRuleSource,
    },
    {
      id: "structure/required-file",
      category: "structure",
      defaultSeverity: "warning",
      description: "Require a primary agent instruction file.",
      evidence: "schema",
    },
  ],
  scan: {
    policyVersion: "2026-07-22",
    discovered: 3,
    analyzed: 1,
    aliases: [{ logicalPath: "CLAUDE.md", canonicalPath: "AGENTS.md" }],
    ignored: [{ logicalPath: ".claude/worktrees", reason: "generated-worktree" }],
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
  diagnostics: [{
    severity: "error",
    category: "security",
    rule: "security/env-var-references",
    file: "CLAUDE.md",
    line: 12,
    message: "Credential guidance should reference an environment variable.",
    fix: "Reference a named environment variable.",
  }],
  files: ["AGENTS.md"],
  timestamp: "2026-07-22T01:02:03.000Z",
} satisfies CliReportV2;

const storedReportV2 = {
  ...cliReportV2,
  id: "v2-run",
  workspace: "/workspace",
  machine_id: "machine",
  created_at: cliReportV2.timestamp,
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
  assert.deepStrictEqual(adapted.severityCounts, { critical: 1, error: 1, warning: 1, info: 1 });
  assert.equal(adapted.schemaVersion, 1);
  assert.equal(adapted.engineVersion, null);
  assert.equal(adapted.scoreKind, null);
  assert.equal(adapted.context, null);
  assert.equal(adapted.scan, null);
  assert.equal(adapted.rules, null);
  assert.equal(adapted.ruleSummary, null);
  assert.equal(adapted.scoringPolicy, null);
  assert.equal(adapted.grade, "C+");
  assert.deepStrictEqual(adapted.categories, [{
    key: null,
    name: "Clarity",
    score: 70,
    grade: null,
    weight: 0.15,
    diagnosticCount: null,
  }]);
  assert.deepStrictEqual(adapted.rawLegacyDiagnostics, legacyReport.diagnostics);
  assert.deepStrictEqual(adapted.diagnostics, []);
  assert.deepStrictEqual(adapted.files, legacyReport.file_names);
  assert.equal(adapted.timestamp, legacyReport.created_at);
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

test("passes every CLI-owned schema-v2 field through unchanged", async () => {
  const { adaptStoredReport } = await loadAdapter();
  const adapted = adaptStoredReport(storedReportV2);

  assert.equal(adapted.legacy, false);
  assert.equal(adapted.schemaVersion, 2);
  assert.equal(adapted.id, storedReportV2.id);
  assert.equal(adapted.workspace, storedReportV2.workspace);
  assert.equal(adapted.totalScore, cliReportV2.score);
  assert.equal(adapted.filesScanned, cliReportV2.scan.analyzed);
  assert.deepStrictEqual(adapted.categories, cliReportV2.categories);
  assert.deepStrictEqual(adapted.severityCounts, cliReportV2.severityCounts);
  assert.deepStrictEqual(adapted.ruleSummary, cliReportV2.ruleSummary);
  assert.deepStrictEqual(adapted.rules, cliReportV2.rules);
  assert.deepStrictEqual(adapted.scan, cliReportV2.scan);
  assert.deepStrictEqual(adapted.scoringPolicy, cliReportV2.scoringPolicy);
  assert.deepStrictEqual(adapted.diagnostics, cliReportV2.diagnostics);
  assert.deepStrictEqual(adapted.files, cliReportV2.files);
  assert.equal(adapted.timestamp, cliReportV2.timestamp);
  assert.equal(adapted.grade, cliReportV2.grade);
  assert.equal(adapted.engineVersion, cliReportV2.engineVersion);
  assert.equal(adapted.scoreKind, cliReportV2.scoreKind);
  assert.equal(adapted.context, cliReportV2.context);
  assert.equal("rawLegacyDiagnostics" in adapted, false);
});

test("counts raw legacy diagnostics for metadata while v2 uses validated diagnostics", async () => {
  const { adaptStoredReport, metadataDiagnosticCount } = await loadAdapter();
  const legacy = adaptStoredReport(legacyReport);
  const v2 = adaptStoredReport(storedReportV2);

  assert.equal(legacy.diagnostics.length, 0, "incomplete legacy diagnostics remain hidden from the UI");
  assert.equal(metadataDiagnosticCount(legacy), 4);
  assert.equal(metadataDiagnosticCount(v2), 1);
});

test("validates a representative complete schema-v2 CLI contract", async () => {
  const { parseCliReportV2 } = await import("./localStore");
  assert.deepStrictEqual(parseCliReportV2(cliReportV2), cliReportV2);
});

test("accepts omitted optional diagnostic line and fix fields", async () => {
  const { parseCliReportV2 } = await import("./localStore");
  const { line: _line, fix: _fix, ...diagnostic } = cliReportV2.diagnostics[0];
  const candidate = { ...cliReportV2, diagnostics: [diagnostic] };
  assert.deepStrictEqual(parseCliReportV2(candidate), candidate);
});

test("rejects malformed schema-v2 shapes and cross-field contradictions", async () => {
  const { parseCliReportV2 } = await import("./localStore");
  const duplicateRules = [cliReportV2.rules[0], { ...cliReportV2.rules[1], id: cliReportV2.rules[0].id }];
  const unknownRuleDiagnostics = [{ ...cliReportV2.diagnostics[0], rule: "security/not-cataloged" }];
  const malformed: Array<[string, unknown]> = [
    ["schemaVersion", { ...cliReportV2, schemaVersion: 1 }],
    ["engineVersion", { ...cliReportV2, engineVersion: "" }],
    ["scoreKind", { ...cliReportV2, scoreKind: "benchmark" }],
    ["score range", { ...cliReportV2, score: 101 }],
    ["report grade", { ...cliReportV2, grade: "A-" }],
    ["context", { ...cliReportV2, context: "other" }],
    ["category entry", { ...cliReportV2, categories: [{ ...cliReportV2.categories[0], diagnosticCount: undefined }, ...cliReportV2.categories.slice(1)] }],
    ["missing category", { ...cliReportV2, categories: cliReportV2.categories.slice(0, -1) }],
    ["duplicate category", { ...cliReportV2, categories: [...cliReportV2.categories.slice(0, -1), cliReportV2.categories[0]] }],
    ["category label", { ...cliReportV2, categories: [{ ...cliReportV2.categories[0], name: "Security" }, ...cliReportV2.categories.slice(1)] }],
    ["category score range", { ...cliReportV2, categories: [{ ...cliReportV2.categories[0], score: -1 }, ...cliReportV2.categories.slice(1)] }],
    ["category grade", { ...cliReportV2, categories: [{ ...cliReportV2.categories[0], grade: "F" }, ...cliReportV2.categories.slice(1)] }],
    ["category weight policy mismatch", { ...cliReportV2, categories: [{ ...cliReportV2.categories[0], weight: 0.11 }, ...cliReportV2.categories.slice(1)] }],
    ["weighted score mismatch", { ...cliReportV2, score: 92, grade: "A-" }],
    ["category diagnostic count", { ...cliReportV2, categories: cliReportV2.categories.map((category) => category.key === "security" ? { ...category, diagnosticCount: 0 } : category) }],
    ["severity shape", { ...cliReportV2, severityCounts: { critical: 0, error: 1, warning: 0 } }],
    ["severity reconciliation", { ...cliReportV2, severityCounts: { ...cliReportV2.severityCounts, error: 0 } }],
    ["rule summary", { ...cliReportV2, ruleSummary: { ...cliReportV2.ruleSummary, passed: 0 } }],
    ["empty rules", { ...cliReportV2, rules: [], ruleSummary: { evaluated: 0, flagged: 0, passed: 0 } }],
    ["duplicate rules", { ...cliReportV2, rules: duplicateRules }],
    ["unknown diagnostic rule", { ...cliReportV2, diagnostics: unknownRuleDiagnostics }],
    ["diagnostic rule category", { ...cliReportV2, rules: [{ ...cliReportV2.rules[0], category: "structure" }, cliReportV2.rules[1]] }],
    ["rule evidence", { ...cliReportV2, rules: [{ ...cliReportV2.rules[0], evidence: "guess" }, cliReportV2.rules[1]] }],
    ["rule source", { ...cliReportV2, rules: [{ ...cliReportV2.rules[0], source: { label: "OWASP", url: 42, asOf: "2026-07-22" } }, cliReportV2.rules[1]] }],
    ["scan shape", { ...cliReportV2, scan: { ...cliReportV2.scan, aliases: [{ logicalPath: "CLAUDE.md" }] } }],
    ["scan analyzed files", { ...cliReportV2, scan: { ...cliReportV2.scan, analyzed: 2 } }],
    ["scan discovered count", { ...cliReportV2, scan: { ...cliReportV2.scan, discovered: 0 } }],
    ["scan ignored coherence", { ...cliReportV2, scan: { ...cliReportV2.scan, discovered: 1, ignored: [{ logicalPath: "blocked.md", reason: "generated-worktree" }] } }],
    ["scan alias target", { ...cliReportV2, scan: { ...cliReportV2.scan, aliases: [{ logicalPath: "CLAUDE.md", canonicalPath: "missing.md" }] } }],
    ["scan duplicate aliases", { ...cliReportV2, scan: { ...cliReportV2.scan, aliases: [cliReportV2.scan.aliases[0], cliReportV2.scan.aliases[0]] } }],
    ["scan duplicate ignored entries", { ...cliReportV2, scan: { ...cliReportV2.scan, discovered: 3, ignored: [{ logicalPath: "blocked.md", reason: "generated-worktree" }, { logicalPath: "blocked.md", reason: "generated-worktree" }] } }],
    ["policy scaling", { ...cliReportV2, scoringPolicy: { ...cliReportV2.scoringPolicy, skillSafetyScaling: { errorCap: 60 } } }],
    ["policy category weight", { ...cliReportV2, scoringPolicy: { ...cliReportV2.scoringPolicy, categoryWeights: { ...cliReportV2.scoringPolicy.categoryWeights, structure: 0.11 } } }],
    ["incomplete grade scale", { ...cliReportV2, scoringPolicy: { ...cliReportV2.scoringPolicy, gradeScale: cliReportV2.scoringPolicy.gradeScale.slice(0, -1) } }],
    ["duplicate grade scale", { ...cliReportV2, scoringPolicy: { ...cliReportV2.scoringPolicy, gradeScale: [...cliReportV2.scoringPolicy.gradeScale.slice(0, -1), { grade: "D", min: 50 }] } }],
    ["diagnostics", { ...cliReportV2, diagnostics: [{ ...cliReportV2.diagnostics[0], severity: "notice" }] }],
    ["files", { ...cliReportV2, files: [42] }],
    ["duplicate files", { ...cliReportV2, files: ["AGENTS.md", "AGENTS.md"], scan: { ...cliReportV2.scan, discovered: 2, analyzed: 2 } }],
    ["timestamp empty", { ...cliReportV2, timestamp: "" }],
    ["timestamp invalid", { ...cliReportV2, timestamp: "not-a-timestamp" }],
  ];

  const invalidRuleMembers: Array<[string, string, unknown]> = [
    ["rule id", "id", ""],
    ["rule category", "category", "other"],
    ["rule default severity", "defaultSeverity", "notice"],
    ["rule description", "description", ""],
  ];
  for (const [label, member, invalid] of invalidRuleMembers) {
    malformed.push([label, {
      ...cliReportV2,
      rules: [{ ...cliReportV2.rules[0], [member]: invalid }, cliReportV2.rules[1]],
    }]);
  }

  const invalidRuleSourceMembers: Array<[string, string, unknown]> = [
    ["rule source label type", "label", 42],
    ["rule source label empty", "label", ""],
    ["rule source asOf type", "asOf", 42],
    ["rule source asOf empty", "asOf", ""],
  ];
  for (const [label, member, invalid] of invalidRuleSourceMembers) {
    malformed.push([label, {
      ...cliReportV2,
      rules: [{
        ...cliReportV2.rules[0],
        source: { ...validRuleSource, [member]: invalid },
      }, cliReportV2.rules[1]],
    }]);
  }

  const invalidScanMembers: Array<[string, unknown]> = [
    ["scan policy version", { ...cliReportV2.scan, policyVersion: "old" }],
    ["ignored logical path type", { ...cliReportV2.scan, ignored: [{ ...cliReportV2.scan.ignored[0], logicalPath: 42 }] }],
    ["ignored logical path empty", { ...cliReportV2.scan, ignored: [{ ...cliReportV2.scan.ignored[0], logicalPath: "" }] }],
    ["ignored reason", { ...cliReportV2.scan, ignored: [{ ...cliReportV2.scan.ignored[0], reason: "other" }] }],
  ];
  for (const [label, scan] of invalidScanMembers) malformed.push([label, { ...cliReportV2, scan }]);

  const invalidAliasMembers: Array<[string, string, unknown]> = [
    ["alias logical path type", "logicalPath", 42],
    ["alias logical path empty", "logicalPath", ""],
    ["alias canonical path type", "canonicalPath", 42],
    ["alias canonical path empty", "canonicalPath", ""],
  ];
  for (const [label, member, invalid] of invalidAliasMembers) {
    malformed.push([label, {
      ...cliReportV2,
      scan: {
        ...cliReportV2.scan,
        aliases: [{ ...cliReportV2.scan.aliases[0], [member]: invalid }],
      },
    }]);
  }

  const policyScalarMembers = [
    "basePerCategory", "criticalPenalty", "defaultErrorPenalty", "consistencyErrorPenalty",
    "defaultWarningPenalty", "runtimeWarningPenalty", "infoPenalty", "infoCap",
    "clarityWarningCap", "consistencyFloor",
  ] as const;
  for (const member of policyScalarMembers) {
    malformed.push([`policy scalar ${member}`, {
      ...cliReportV2,
      scoringPolicy: { ...cliReportV2.scoringPolicy, [member]: -1 },
    }]);
  }
  malformed.push(
    ["policy kind", { ...cliReportV2, scoringPolicy: { ...cliReportV2.scoringPolicy, kind: "benchmark" } }],
    ["policy formula", { ...cliReportV2, scoringPolicy: { ...cliReportV2.scoringPolicy, formula: "" } }],
    ["policy disclaimer", { ...cliReportV2, scoringPolicy: { ...cliReportV2.scoringPolicy, disclaimer: "" } }],
    ["policy bonus descriptions", { ...cliReportV2, scoringPolicy: { ...cliReportV2.scoringPolicy, bonusDescriptions: [42] } }],
  );

  const scalingMembers = ["skillCountThreshold", "errorCap", "warningPenalty", "warningCap"] as const;
  for (const member of scalingMembers) {
    malformed.push([`policy scaling ${member}`, {
      ...cliReportV2,
      scoringPolicy: {
        ...cliReportV2.scoringPolicy,
        skillSafetyScaling: { ...cliReportV2.scoringPolicy.skillSafetyScaling, [member]: -1 },
      },
    }]);
  }

  const invalidGradeTierMembers: Array<[string, string, unknown]> = [
    ["grade tier grade type", "grade", 42],
    ["grade tier grade empty", "grade", ""],
    ["grade tier min type", "min", "98"],
    ["grade tier min invalid", "min", -1],
  ];
  for (const [label, member, invalid] of invalidGradeTierMembers) {
    malformed.push([label, {
      ...cliReportV2,
      scoringPolicy: {
        ...cliReportV2.scoringPolicy,
        gradeScale: [
          { ...cliReportV2.scoringPolicy.gradeScale[0], [member]: invalid },
          ...cliReportV2.scoringPolicy.gradeScale.slice(1),
        ],
      },
    }]);
  }

  const invalidDiagnosticMembers: Array<[string, string, unknown]> = [
    ["diagnostic category", "category", "other"],
    ["diagnostic rule", "rule", ""],
    ["diagnostic file", "file", ""],
    ["diagnostic line", "line", 0],
    ["diagnostic line type", "line", "12"],
    ["diagnostic message", "message", ""],
    ["diagnostic fix", "fix", 42],
    ["diagnostic fix empty", "fix", ""],
  ];
  for (const [label, member, invalid] of invalidDiagnosticMembers) {
    malformed.push([label, {
      ...cliReportV2,
      diagnostics: [{ ...cliReportV2.diagnostics[0], [member]: invalid }],
    }]);
  }

  for (const [label, candidate] of malformed) {
    assert.throws(
      () => parseCliReportV2(candidate),
      (error: unknown) => error instanceof Error && error.message === "Unsupported AgentLinter report schema",
      label,
    );
  }
});

test("constructs persisted v2 Reports by adding only four local fields", async () => {
  const { buildStoredReportV2 } = await import("./localStore");
  const localMetadata = { id: "v2-run", workspace: "/workspace", machine_id: "machine" };
  const stored = buildStoredReportV2({ cli: cliReportV2, localMetadata });

  for (const [key, value] of Object.entries(cliReportV2)) {
    assert.deepStrictEqual(stored[key as keyof typeof cliReportV2], value, key);
  }
  assert.deepStrictEqual(
    Object.keys(stored).sort(),
    [...Object.keys(cliReportV2), "id", "workspace", "machine_id", "created_at"].sort(),
  );
  assert.equal(stored.created_at, cliReportV2.timestamp);
  assert.equal(stored.id, localMetadata.id);
  assert.equal(stored.workspace, localMetadata.workspace);
  assert.equal(stored.machine_id, localMetadata.machine_id);
});

test("validates schema-v1 disk Reports and skips malformed files", async () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "agentlinter-v1-store-"));
  const validPath = path.join(directory, `${legacyReport.id}.json`);
  const malformedPath = path.join(directory, "malformed.json");
  const previousDataDir = process.env.AGENTLINTER_DATA_DIR;
  try {
    process.env.AGENTLINTER_DATA_DIR = directory;
    fs.writeFileSync(validPath, JSON.stringify(legacyReport));
    fs.writeFileSync(malformedPath, JSON.stringify({ id: "malformed", score: 70 }));
    const { isStoredReportV1, listReports, readReport } = await import("./localStore");

    assert.equal(isStoredReportV1(legacyReport), true);
    assert.equal(isStoredReportV1({ id: "not-a-report", score: 70 }), false);
    assert.deepStrictEqual(readReport(legacyReport.id), legacyReport);
    assert.equal(readReport("malformed"), null);
    assert.deepStrictEqual(listReports(), [{
      id: legacyReport.id,
      workspace: legacyReport.workspace,
      score: legacyReport.score,
      created_at: legacyReport.created_at,
    }]);
  } finally {
    if (previousDataDir === undefined) delete process.env.AGENTLINTER_DATA_DIR;
    else process.env.AGENTLINTER_DATA_DIR = previousDataDir;
    if (fs.existsSync(validPath)) fs.unlinkSync(validPath);
    if (fs.existsSync(malformedPath)) fs.unlinkSync(malformedPath);
    fs.rmdirSync(directory);
  }
});

test("does not downgrade a malformed schema-v2 claim to legacy", async () => {
  const { adaptStoredReport } = await loadAdapter();
  assert.throws(
    () => adaptStoredReport({ ...legacyReport, schemaVersion: 2 } as never),
    (error: unknown) => error instanceof Error && error.message === "Unsupported AgentLinter report schema",
  );
  assert.throws(
    () => adaptStoredReport({ ...storedReportV2, created_at: "2026-07-22T09:09:09.000Z" } as never),
    (error: unknown) => error instanceof Error && error.message === "Unsupported AgentLinter report schema",
  );
});

test("report pages contain no demo report or demo diagnostic fingerprints", () => {
  const page = fs.readFileSync(new URL("../app/r/[id]/page.tsx", import.meta.url), "utf8");
  assert.equal(page.includes("DEMO_DATA"), false);
  assert.equal(page.includes('id === "demo"'), false);
  assert.equal(page.includes("demo-workspace"), false);
  assert.equal(page.includes("MUST"), false, "MUST demo diagnostics must be gone");
  assert.equal(page.includes("Undefined acronym"), false, "Undefined acronym demo diagnostics must be gone");
});
