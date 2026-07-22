import type { LegacyReportData, ReportData } from "@/app/r/[id]/types";
import { gradeFor } from "./grade";
import {
  REPORT_SCHEMA_ERROR,
  isReportDiagnostic,
  isStoredReportV2,
  type Severity,
  type StoredReport,
  type StoredReportV1,
} from "./localStore";
import { logReportDecision } from "./reportDecisionLog";

const EMPTY_SEVERITY_COUNTS: Record<Severity, number> = {
  critical: 0,
  error: 0,
  warning: 0,
  info: 0,
};

function legacySeverityCounts(diagnostics: unknown[]): Record<Severity, number> {
  const counts = { ...EMPTY_SEVERITY_COUNTS };
  for (const diagnostic of diagnostics) {
    if (typeof diagnostic !== "object" || diagnostic === null || !("severity" in diagnostic)) continue;
    const severity = diagnostic.severity;
    if (severity === "critical" || severity === "error" || severity === "warning" || severity === "info") {
      counts[severity] += 1;
    }
  }
  return counts;
}

function adaptLegacy(report: StoredReportV1): LegacyReportData {
  return {
    id: report.id,
    workspace: report.workspace,
    legacy: true,
    schemaVersion: 1,
    engineVersion: null,
    scoreKind: null,
    grade: gradeFor(report.score),
    context: null,
    totalScore: report.score,
    filesScanned: report.files_scanned,
    timestamp: report.created_at,
    categories: report.categories.map((category) => ({
      key: null,
      name: category.name,
      score: category.score,
      grade: null,
      weight: typeof category.weight === "number" ? category.weight : null,
      diagnosticCount: null,
    })),
    severityCounts: legacySeverityCounts(report.diagnostics),
    ruleSummary: null,
    rules: null,
    scan: null,
    scoringPolicy: null,
    diagnostics: report.diagnostics.filter(isReportDiagnostic),
    rawLegacyDiagnostics: report.diagnostics,
    files: report.file_names,
  };
}

export function adaptStoredReport(report: StoredReport): ReportData {
  if (isStoredReportV2(report)) {
    logReportDecision({ event: "report_adapted", loc: "app.reportAdapter.adaptStoredReport", ctx: { schemaVersion: 2 } });
    return {
      id: report.id,
      workspace: report.workspace,
      legacy: false,
      schemaVersion: report.schemaVersion,
      engineVersion: report.engineVersion,
      scoreKind: report.scoreKind,
      grade: report.grade,
      context: report.context,
      totalScore: report.score,
      filesScanned: report.scan.analyzed,
      timestamp: report.timestamp,
      categories: report.categories,
      severityCounts: report.severityCounts,
      ruleSummary: report.ruleSummary,
      rules: report.rules,
      scan: report.scan,
      scoringPolicy: report.scoringPolicy,
      diagnostics: report.diagnostics,
      files: report.files,
    };
  }
  const claimedSchemaVersion = (report as unknown as { schemaVersion?: unknown }).schemaVersion;
  if (claimedSchemaVersion !== undefined) {
    logReportDecision({ event: "stored_schema_rejected", loc: "app.reportAdapter.adaptStoredReport", ctx: { schemaVersion: typeof claimedSchemaVersion === "number" ? claimedSchemaVersion : null } });
    throw new Error(REPORT_SCHEMA_ERROR);
  }
  logReportDecision({ event: "report_adapted", loc: "app.reportAdapter.adaptStoredReport", ctx: { schemaVersion: 1 } });
  return adaptLegacy(report as StoredReportV1);
}

export function metadataDiagnosticCount(report: ReportData): number {
  return report.legacy ? report.rawLegacyDiagnostics.length : report.diagnostics.length;
}
