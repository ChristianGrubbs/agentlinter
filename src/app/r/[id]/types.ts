import type {
  ReportCategory,
  ReportContext,
  ReportDiagnostic,
  RuleCatalogEntry,
  ScanSummary,
  ScoringPolicySnapshot,
  Severity,
} from "@/lib/localStore";

export interface ReportCategoryData {
  key: ReportCategory | null;
  name: string;
  score: number;
  grade: string | null;
  weight: number | null;
  diagnosticCount: number | null;
}

interface ReportDataBase {
  id: string;
  workspace: string;
  grade: string;
  totalScore: number;
  filesScanned: number;
  timestamp: string;
  categories: ReportCategoryData[];
  severityCounts: Record<Severity, number>;
  diagnostics: ReportDiagnostic[];
  files: string[];
  history?: { id: string; score: number; created_at: string }[];
}

export interface LegacyReportData extends ReportDataBase {
  legacy: true;
  schemaVersion: 1;
  engineVersion: null;
  scoreKind: null;
  context: null;
  ruleSummary: null;
  rules: null;
  scan: null;
  scoringPolicy: null;
  rawLegacyDiagnostics: unknown[];
}

export interface ReportDataV2 extends ReportDataBase {
  legacy: false;
  schemaVersion: 2;
  engineVersion: string;
  scoreKind: "heuristic";
  context: ReportContext;
  ruleSummary: { evaluated: number; flagged: number; passed: number };
  rules: RuleCatalogEntry[];
  scan: ScanSummary;
  scoringPolicy: ScoringPolicySnapshot;
  rawLegacyDiagnostics?: never;
}

export type ReportData = LegacyReportData | ReportDataV2;
