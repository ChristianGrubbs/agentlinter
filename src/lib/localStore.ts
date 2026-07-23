// Local filesystem report store — replaces Supabase (ADR 0002).
// Data dir: $AGENTLINTER_DATA_DIR, else ../reports relative to the app cwd.
import fs from "node:fs";
import path from "node:path";

import { GRADE_SCALE, gradeFor } from "./grade";
import { logReportDecision } from "./reportDecisionLog";

function reportDataDir(): string {
  return process.env.AGENTLINTER_DATA_DIR
    ? path.resolve(process.env.AGENTLINTER_DATA_DIR)
    : path.resolve(process.cwd(), "..", "reports");
}

export const REPORT_SCHEMA_ERROR = "Unsupported AgentLinter report schema";

export type Severity = "critical" | "error" | "warning" | "info";
export type ReportCategory =
  | "structure"
  | "clarity"
  | "completeness"
  | "security"
  | "consistency"
  | "memory"
  | "runtime"
  | "skillSafety"
  | "remoteReady"
  | "blueprint"
  | "freshness";
export type ReportContext = "claude-code" | "openclaw-runtime" | "universal" | "cursor" | "copilot";
export type RuleEvidence = "schema" | "invariant" | "security" | "empirical" | "advisory";
export type IgnoreReason = "generated-worktree" | "duplicate-physical-file" | "outside-workspace-symlink";

export interface ReportDiagnostic {
  severity: Severity;
  category: ReportCategory;
  rule: string;
  file: string;
  line?: number;
  message: string;
  fix?: string;
}

export interface ReportCategoryScore {
  key: ReportCategory;
  name: string;
  score: number;
  grade: string;
  weight: number;
  diagnosticCount: number;
}

export interface RuleCatalogEntry {
  id: string;
  category: ReportCategory;
  defaultSeverity: Severity;
  description: string;
  evidence: RuleEvidence;
  source?: { label: string; url: string; asOf: string };
}

export interface ScanSummary {
  policyVersion: "2026-07-22";
  discovered: number;
  analyzed: number;
  aliases: { logicalPath: string; canonicalPath: string }[];
  ignored: { logicalPath: string; reason: IgnoreReason }[];
}

export interface ScoringPolicySnapshot {
  kind: "heuristic";
  basePerCategory: number;
  formula: string;
  criticalPenalty: number;
  defaultErrorPenalty: number;
  consistencyErrorPenalty: number;
  defaultWarningPenalty: number;
  runtimeWarningPenalty: number;
  infoPenalty: number;
  infoCap: number;
  clarityWarningCap: number;
  consistencyFloor: number;
  skillSafetyScaling: {
    skillCountThreshold: number;
    errorCap: number;
    warningPenalty: number;
    warningCap: number;
  };
  categoryWeights: Record<ReportCategory, number>;
  gradeScale: { grade: string; min: number }[];
  disclaimer: string;
  bonusDescriptions: string[];
}

export interface CliReportV2 {
  schemaVersion: 2;
  engineVersion: string;
  scoreKind: "heuristic";
  score: number;
  grade: string;
  context: ReportContext;
  categories: ReportCategoryScore[];
  severityCounts: Record<Severity, number>;
  ruleSummary: { evaluated: number; flagged: number; passed: number };
  rules: RuleCatalogEntry[];
  scan: ScanSummary;
  scoringPolicy: ScoringPolicySnapshot;
  diagnostics: ReportDiagnostic[];
  files: string[];
  timestamp: string;
}

export interface StoredReportV1 {
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

export interface StoredReportV2 extends CliReportV2 {
  id: string;
  workspace: string;
  machine_id: string;
  created_at: string;
}

export type StoredReport = StoredReportV1 | StoredReportV2;

export interface LocalReportMetadata {
  id: string;
  workspace: string;
  machine_id: string;
}

const CATEGORY_VALUES: readonly ReportCategory[] = [
  "structure", "clarity", "completeness", "security", "consistency", "memory",
  "runtime", "skillSafety", "remoteReady", "blueprint", "freshness",
];
const CATEGORY_LABELS: Record<ReportCategory, string> = {
  structure: "Structure",
  clarity: "Clarity",
  completeness: "Completeness",
  security: "Security",
  consistency: "Consistency",
  memory: "Memory",
  runtime: "Runtime Config",
  skillSafety: "Skill Safety",
  remoteReady: "Remote-Ready",
  blueprint: "Blueprint",
  freshness: "Freshness",
};
const CONTEXT_VALUES: readonly ReportContext[] = ["claude-code", "openclaw-runtime", "universal", "cursor", "copilot"];
const SEVERITY_VALUES: readonly Severity[] = ["critical", "error", "warning", "info"];
const EVIDENCE_VALUES: readonly RuleEvidence[] = ["schema", "invariant", "security", "empirical", "advisory"];
const IGNORE_VALUES: readonly IgnoreReason[] = ["generated-worktree", "duplicate-physical-file", "outside-workspace-symlink"];

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isString(value: unknown): value is string {
  return typeof value === "string";
}

function isNonEmptyString(value: unknown): value is string {
  return isString(value) && value.length > 0;
}

function isNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function isNonNegativeNumber(value: unknown): value is number {
  return isNumber(value) && value >= 0;
}

function isCount(value: unknown): value is number {
  return Number.isInteger(value) && Number(value) >= 0;
}

function isScore(value: unknown): value is number {
  return isCount(value) && Number(value) <= 100;
}

function isWeight(value: unknown): value is number {
  return isNumber(value) && value >= 0 && value <= 1;
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every(isString);
}

function isNonEmptyStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every(isNonEmptyString);
}

function isIsoTimestamp(value: unknown): value is string {
  if (!isNonEmptyString(value)) return false;
  const parsed = new Date(value);
  return !Number.isNaN(parsed.valueOf()) && parsed.toISOString() === value;
}

function isEnum<T extends string>(value: unknown, values: readonly T[]): value is T {
  return typeof value === "string" && values.includes(value as T);
}

function hasOnlyKeys(value: Record<string, unknown>, keys: readonly string[]): boolean {
  return Object.keys(value).every((key) => keys.includes(key));
}

function isCategoryScore(value: unknown): value is ReportCategoryScore {
  return isRecord(value)
    && hasOnlyKeys(value, ["key", "name", "score", "grade", "weight", "diagnosticCount"])
    && isEnum(value.key, CATEGORY_VALUES)
    && isNonEmptyString(value.name)
    && isScore(value.score)
    && isNonEmptyString(value.grade)
    && isWeight(value.weight)
    && isCount(value.diagnosticCount);
}

function isSeverityCounts(value: unknown): value is Record<Severity, number> {
  return isRecord(value)
    && hasOnlyKeys(value, SEVERITY_VALUES)
    && SEVERITY_VALUES.every((severity) => isCount(value[severity]));
}

function isRuleSummary(value: unknown): value is CliReportV2["ruleSummary"] {
  return isRecord(value)
    && hasOnlyKeys(value, ["evaluated", "flagged", "passed"])
    && isCount(value.evaluated)
    && isCount(value.flagged)
    && isCount(value.passed);
}

function isRuleSource(value: unknown): value is NonNullable<RuleCatalogEntry["source"]> {
  return isRecord(value)
    && hasOnlyKeys(value, ["label", "url", "asOf"])
    && isNonEmptyString(value.label)
    && isNonEmptyString(value.url)
    && isNonEmptyString(value.asOf);
}

function isRule(value: unknown): value is RuleCatalogEntry {
  return isRecord(value)
    && hasOnlyKeys(value, ["id", "category", "defaultSeverity", "description", "evidence", "source"])
    && isNonEmptyString(value.id)
    && isEnum(value.category, CATEGORY_VALUES)
    && isEnum(value.defaultSeverity, SEVERITY_VALUES)
    && isNonEmptyString(value.description)
    && isEnum(value.evidence, EVIDENCE_VALUES)
    && (value.source === undefined || isRuleSource(value.source));
}

function isScan(value: unknown): value is ScanSummary {
  if (!isRecord(value)
    || !hasOnlyKeys(value, ["policyVersion", "discovered", "analyzed", "aliases", "ignored"])
    || value.policyVersion !== "2026-07-22"
    || !isCount(value.discovered)
    || !isCount(value.analyzed)
    || !Array.isArray(value.aliases)
    || !Array.isArray(value.ignored)) return false;
  return value.aliases.every((alias) => isRecord(alias)
      && hasOnlyKeys(alias, ["logicalPath", "canonicalPath"])
      && isNonEmptyString(alias.logicalPath)
      && isNonEmptyString(alias.canonicalPath))
    && value.ignored.every((ignored) => isRecord(ignored)
      && hasOnlyKeys(ignored, ["logicalPath", "reason"])
      && isNonEmptyString(ignored.logicalPath)
      && isEnum(ignored.reason, IGNORE_VALUES));
}

function isCategoryWeights(value: unknown): value is Record<ReportCategory, number> {
  return isRecord(value)
    && hasOnlyKeys(value, CATEGORY_VALUES)
    && CATEGORY_VALUES.every((category) => isWeight(value[category]));
}

function isScoringPolicy(value: unknown): value is ScoringPolicySnapshot {
  if (!isRecord(value)
    || !hasOnlyKeys(value, [
      "kind", "basePerCategory", "formula", "criticalPenalty", "defaultErrorPenalty",
      "consistencyErrorPenalty", "defaultWarningPenalty", "runtimeWarningPenalty", "infoPenalty",
      "infoCap", "clarityWarningCap", "consistencyFloor", "skillSafetyScaling", "categoryWeights",
      "gradeScale", "disclaimer", "bonusDescriptions",
    ])
    || value.kind !== "heuristic"
    || !isNonNegativeNumber(value.basePerCategory)
    || !isNonEmptyString(value.formula)
    || !["criticalPenalty", "defaultErrorPenalty", "consistencyErrorPenalty", "defaultWarningPenalty",
      "runtimeWarningPenalty", "infoPenalty", "infoCap", "clarityWarningCap", "consistencyFloor"]
      .every((key) => isNonNegativeNumber(value[key]))
    || !isRecord(value.skillSafetyScaling)
    || !hasOnlyKeys(value.skillSafetyScaling, ["skillCountThreshold", "errorCap", "warningPenalty", "warningCap"])
    || !["skillCountThreshold", "errorCap", "warningPenalty", "warningCap"]
      .every((key) => isNonNegativeNumber((value.skillSafetyScaling as Record<string, unknown>)[key]))
    || !isCategoryWeights(value.categoryWeights)
    || !Array.isArray(value.gradeScale)
    || !isNonEmptyString(value.disclaimer)
    || !isNonEmptyStringArray(value.bonusDescriptions)) return false;
  return value.gradeScale.every((tier) => isRecord(tier)
    && hasOnlyKeys(tier, ["grade", "min"])
    && isNonEmptyString(tier.grade)
    && isNumber(tier.min));
}

export function isReportDiagnostic(value: unknown): value is ReportDiagnostic {
  return isRecord(value)
    && hasOnlyKeys(value, ["severity", "category", "rule", "file", "line", "message", "fix"])
    && isEnum(value.severity, SEVERITY_VALUES)
    && isEnum(value.category, CATEGORY_VALUES)
    && isNonEmptyString(value.rule)
    && isNonEmptyString(value.file)
    && (value.line === undefined || (isCount(value.line) && value.line > 0))
    && isNonEmptyString(value.message)
    && (value.fix === undefined || isNonEmptyString(value.fix));
}

function hasCliReportV2Shape(value: unknown): value is CliReportV2 {
  return isRecord(value)
    && hasOnlyKeys(value, [
      "schemaVersion", "engineVersion", "scoreKind", "score", "grade", "context", "categories",
      "severityCounts", "ruleSummary", "rules", "scan", "scoringPolicy", "diagnostics", "files", "timestamp",
    ])
    && value.schemaVersion === 2
    && isNonEmptyString(value.engineVersion)
    && value.scoreKind === "heuristic"
    && isScore(value.score)
    && isNonEmptyString(value.grade)
    && isEnum(value.context, CONTEXT_VALUES)
    && Array.isArray(value.categories)
    && value.categories.every(isCategoryScore)
    && isSeverityCounts(value.severityCounts)
    && isRuleSummary(value.ruleSummary)
    && Array.isArray(value.rules)
    && value.rules.every(isRule)
    && isScan(value.scan)
    && isScoringPolicy(value.scoringPolicy)
    && Array.isArray(value.diagnostics)
    && value.diagnostics.every(isReportDiagnostic)
    && isNonEmptyStringArray(value.files)
    && isIsoTimestamp(value.timestamp);
}

function hasCompleteScoringPolicy(report: CliReportV2): boolean {
  if (report.scoringPolicy.gradeScale.length !== GRADE_SCALE.length) return false;
  if (!GRADE_SCALE.every((tier, index) => {
    const actual = report.scoringPolicy.gradeScale[index];
    return actual?.grade === tier.grade && actual.min === tier.min;
  })) return false;
  const weightTotal = CATEGORY_VALUES.reduce(
    (total, category) => total + report.scoringPolicy.categoryWeights[category],
    0,
  );
  return Math.abs(weightTotal - 1) <= Number.EPSILON * 16;
}

function hasCoherentCategories(report: CliReportV2): boolean {
  const categoryKeys = report.categories.map((category) => category.key);
  if (report.categories.length !== CATEGORY_VALUES.length
    || new Set(categoryKeys).size !== CATEGORY_VALUES.length
    || !CATEGORY_VALUES.every((category) => categoryKeys.includes(category))) return false;
  for (const category of report.categories) {
    if (category.name !== CATEGORY_LABELS[category.key]
      || category.weight !== report.scoringPolicy.categoryWeights[category.key]
      || category.grade !== gradeFor(category.score)) return false;
  }
  const weightedScore = Math.round(
    report.categories.reduce((total, category) => total + category.score * category.weight, 0),
  );
  return report.score === weightedScore && report.grade === gradeFor(report.score);
}

function hasCoherentDiagnosticCounts(report: CliReportV2): boolean {
  for (const category of report.categories) {
    const actual = report.diagnostics.filter((diagnostic) => diagnostic.category === category.key).length;
    if (category.diagnosticCount !== actual) return false;
  }
  const countedSeverities: Record<Severity, number> = { critical: 0, error: 0, warning: 0, info: 0 };
  for (const diagnostic of report.diagnostics) countedSeverities[diagnostic.severity] += 1;
  return SEVERITY_VALUES.every((severity) => report.severityCounts[severity] === countedSeverities[severity]);
}

function hasCoherentRuleCatalog(report: CliReportV2): boolean {
  const ruleIds = report.rules.map((rule) => rule.id);
  if (ruleIds.length === 0 || new Set(ruleIds).size !== ruleIds.length) return false;
  const rulesById = new Map(report.rules.map((rule) => [rule.id, rule]));
  for (const diagnostic of report.diagnostics) {
    const rule = rulesById.get(diagnostic.rule);
    if (!rule || rule.category !== diagnostic.category) return false;
  }

  const flaggedRuleCount = new Set(report.diagnostics.map((diagnostic) => diagnostic.rule)).size;
  return report.ruleSummary.evaluated === report.rules.length
    && report.ruleSummary.flagged === flaggedRuleCount
    && report.ruleSummary.passed === report.rules.length - flaggedRuleCount;
}

function hasCoherentScan(report: CliReportV2): boolean {
  const aliasPaths = report.scan.aliases.map((alias) => alias.logicalPath);
  const ignoredPaths = report.scan.ignored.map((ignored) => `${ignored.logicalPath}\u0000${ignored.reason}`);
  return report.scan.analyzed === report.files.length
    && report.scan.discovered >= report.scan.analyzed + report.scan.ignored.length
    && report.scan.aliases.length <= report.scan.discovered
    && report.scan.ignored.length <= report.scan.discovered
    && new Set(aliasPaths).size === aliasPaths.length
    && new Set(ignoredPaths).size === ignoredPaths.length
    && report.scan.aliases.every((alias) => report.files.includes(alias.canonicalPath))
    && new Set(report.files).size === report.files.length;
}

// A v2 Report is authoritative UI truth, so independently valid fields must also
// reconcile across categories, diagnostics, rules, scan provenance, and policy.
function hasCoherentReportInvariants(report: CliReportV2): boolean {
  return hasCompleteScoringPolicy(report)
    && hasCoherentCategories(report)
    && hasCoherentDiagnosticCounts(report)
    && hasCoherentRuleCatalog(report)
    && hasCoherentScan(report);
}

export function isCliReportV2(value: unknown): value is CliReportV2 {
  return hasCliReportV2Shape(value) && hasCoherentReportInvariants(value);
}

export function parseCliReportV2(value: unknown): CliReportV2 {
  if (!isCliReportV2(value)) {
    logReportDecision({ event: "schema_rejected", loc: "app.localStore.parseCliReportV2", ctx: { schemaVersion: isRecord(value) && isNumber(value.schemaVersion) ? value.schemaVersion : null } });
    throw new Error(REPORT_SCHEMA_ERROR);
  }
  logReportDecision({ event: "schema_accepted", loc: "app.localStore.parseCliReportV2", ctx: { schemaVersion: value.schemaVersion, diagnosticCount: value.diagnostics.length } });
  return value;
}

export function buildStoredReportV2({
  cli,
  localMetadata,
}: {
  cli: CliReportV2;
  localMetadata: LocalReportMetadata;
}): StoredReportV2 {
  const validated = parseCliReportV2(cli);
  return {
    ...validated,
    id: localMetadata.id,
    workspace: localMetadata.workspace,
    machine_id: localMetadata.machine_id,
    created_at: validated.timestamp,
  };
}

export function isStoredReportV2(value: unknown): value is StoredReportV2 {
  if (!isRecord(value)) return false;
  const { id, workspace, machine_id: machineId, created_at: createdAt, ...cli } = value;
  return isNonEmptyString(id)
    && isString(workspace)
    && isNonEmptyString(machineId)
    && isNonEmptyString(createdAt)
    && isCliReportV2(cli)
    && createdAt === cli.timestamp;
}

const SAFE_ID = /^[A-Za-z0-9_-]{1,32}$/;

function isStoredReportV1Category(value: unknown): value is StoredReportV1["categories"][number] {
  return isRecord(value)
    && hasOnlyKeys(value, ["name", "score", "weight"])
    && isNonEmptyString(value.name)
    && isNumber(value.score)
    && (value.weight === undefined || isNumber(value.weight));
}

export function isStoredReportV1(value: unknown): value is StoredReportV1 {
  return isRecord(value)
    && hasOnlyKeys(value, [
      "id", "workspace", "machine_id", "score", "categories", "diagnostics",
      "file_names", "files_scanned", "rules_checked", "created_at",
    ])
    && isNonEmptyString(value.id)
    && SAFE_ID.test(value.id)
    && isNonEmptyString(value.workspace)
    && isNonEmptyString(value.machine_id)
    && isNumber(value.score)
    && value.score >= 0
    && value.score <= 100
    && Array.isArray(value.categories)
    && value.categories.every(isStoredReportV1Category)
    && Array.isArray(value.diagnostics)
    && isStringArray(value.file_names)
    && isCount(value.files_scanned)
    && isCount(value.rules_checked)
    && isNonEmptyString(value.created_at);
}

function ensureDir(): string {
  const directory = reportDataDir();
  fs.mkdirSync(directory, { recursive: true });
  return directory;
}

export function writeReport(report: StoredReport): void {
  const directory = ensureDir();
  const body = JSON.stringify(report, null, 2);
  fs.writeFileSync(path.join(directory, `${report.id}.json`), body);
  fs.writeFileSync(path.join(directory, "latest.json"), body);
  logReportDecision({ event: "report_stored", loc: "app.localStore.writeReport", ctx: { schemaVersion: isStoredReportV2(report) ? 2 : 1 } });
}

export function readReport(id: string): StoredReport | null {
  if (!SAFE_ID.test(id)) return null;
  try {
    const candidate: unknown = JSON.parse(fs.readFileSync(path.join(reportDataDir(), `${id}.json`), "utf-8"));
    return isStoredReportV2(candidate) || isStoredReportV1(candidate) ? candidate : null;
  } catch {
    return null;
  }
}

export function listReports(limit = 50): Pick<StoredReportV1, "id" | "workspace" | "score" | "created_at">[] {
  const directory = ensureDir();
  const rows: StoredReport[] = [];
  for (const file of fs.readdirSync(directory)) {
    if (!file.endsWith(".json") || file === "latest.json") continue;
    try {
      const candidate: unknown = JSON.parse(fs.readFileSync(path.join(directory, file), "utf-8"));
      if (isStoredReportV2(candidate) || isStoredReportV1(candidate)) rows.push(candidate);
    } catch {
      /* skip unreadable file */
    }
  }
  rows.sort((a, b) => (a.created_at < b.created_at ? 1 : -1));
  return rows.slice(0, limit).map((report) => ({
    id: report.id,
    workspace: report.workspace,
    score: report.score,
    created_at: report.created_at,
  }));
}
