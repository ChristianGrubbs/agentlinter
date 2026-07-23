import type { ReportData, ReportDataV2 } from "../app/r/[id]/types";
import type {
  ReportCategory,
  RuleCatalogEntry,
  RuleEvidence,
  ScoringPolicySnapshot,
  Severity,
} from "./localStore";

export interface SeverityStat {
  severity: Severity;
  label: string;
  count: number;
}

const SEVERITIES: readonly Severity[] = ["critical", "error", "warning", "info"];
const EVIDENCE_LABELS: Record<RuleEvidence, string> = {
  schema: "Schema",
  invariant: "Invariant",
  security: "Security",
  empirical: "Empirical",
  advisory: "Advisory",
};

export function severityStats(report: ReportData): SeverityStat[] {
  return SEVERITIES.map((severity) => ({
    severity,
    label: severity,
    count: report.severityCounts[severity],
  }));
}

export function diagnosticTotal(report: ReportData): number {
  if (report.legacy) return report.rawLegacyDiagnostics.length;
  return severityStats(report).reduce((total, stat) => total + stat.count, 0);
}

export function hiddenLegacyDiagnosticCount(report: ReportData): number {
  if (!report.legacy) return 0;
  return Math.max(0, report.rawLegacyDiagnostics.length - report.diagnostics.length);
}

function countedLabel(count: number, singular: string, plural = `${singular}s`): string {
  return `${count} ${count === 1 ? singular : plural}`;
}

export function countedSeverity(count: number, severity: Severity): string {
  if (severity === "info") return `${count} info`;
  return countedLabel(count, severity);
}

export function diagnosticMetadataCopy(report: ReportData): string {
  const counts = report.severityCounts;
  return `${diagnosticTotal(report)} diagnostics (${SEVERITIES.map(
    (severity) => countedSeverity(counts[severity], severity),
  ).join(", ")})`;
}

export function shareText(report: ReportData): string {
  const subject = report.legacy ? "AgentLinter legacy Report heuristic score" : "AgentLinter heuristic score";
  return `${subject}: ${report.totalScore}/100 (${report.grade}).`;
}

export interface RuleView extends RuleCatalogEntry {
  status: "flagged" | "passed";
  evidenceLabel: string;
}

export interface RuleCatalogGroup {
  key: ReportCategory;
  name: string;
  score: number;
  grade: string;
  weight: number;
  diagnosticCount: number;
  rules: RuleView[];
}

export function ruleCatalogGroups(report: ReportDataV2): RuleCatalogGroup[];
export function ruleCatalogGroups(report: ReportData): RuleCatalogGroup[] | null;
export function ruleCatalogGroups(report: ReportData): RuleCatalogGroup[] | null {
  if (report.legacy) return null;

  return report.categories.flatMap((category) => {
    if (category.key === null
      || category.grade === null
      || category.weight === null
      || category.diagnosticCount === null) return [];
    const rules = report.rules
      .filter((rule) => rule.category === category.key)
      .map((rule) => ({
        ...rule,
        status: report.diagnostics.some(
          (diagnostic) => diagnostic.category === rule.category && diagnostic.rule === rule.id,
        ) ? "flagged" as const : "passed" as const,
        evidenceLabel: EVIDENCE_LABELS[rule.evidence],
      }));

    return [{
      key: category.key,
      name: category.name,
      score: category.score,
      grade: category.grade,
      weight: category.weight,
      diagnosticCount: category.diagnosticCount,
      rules,
    }];
  });
}

export function engineLabel(report: ReportData): string {
  return report.legacy ? "legacy" : report.engineVersion;
}

export interface ReportProvenanceView {
  engineVersion: string;
  schemaVersion: 2;
  context: string;
  scanPolicyVersion: string;
  discovered: number;
  analyzed: number;
  generatedWorktreeIgnoreCount: number;
  ignored: { logicalPath: string; reason: string }[];
  aliasCount: number;
  aliases: { logicalPath: string; canonicalPath: string }[];
}

export function reportProvenance(report: ReportData): ReportProvenanceView | null {
  if (report.legacy) return null;
  return {
    engineVersion: report.engineVersion,
    schemaVersion: report.schemaVersion,
    context: report.context,
    scanPolicyVersion: report.scan.policyVersion,
    discovered: report.scan.discovered,
    analyzed: report.scan.analyzed,
    generatedWorktreeIgnoreCount: report.scan.ignored.filter(
      (entry) => entry.reason === "generated-worktree",
    ).length,
    ignored: report.scan.ignored,
    aliasCount: report.scan.aliases.length,
    aliases: report.scan.aliases,
  };
}

export function methodologyPolicy(report: ReportData): ScoringPolicySnapshot | null {
  return report.legacy ? null : report.scoringPolicy;
}

export function formatPercentage(weight: number): string {
  return `${Number((weight * 100).toFixed(6))}%`;
}
