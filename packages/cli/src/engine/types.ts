/* ─── AgentLinter Core Types ─── */

export type Severity = "critical" | "error" | "warning" | "info";

export type Category =
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

/**
 * Lint context — determines which rules apply
 * - claude-code: Project-scoped (CLAUDE.md, .claude/)
 * - openclaw-runtime: Workspace-scoped (AGENTS.md, USER.md, ~/.openclaw/)
 * - universal: Applies to both contexts
 */
export type LintContext = "claude-code" | "openclaw-runtime" | "universal" | "cursor" | "copilot";

export type RuleEvidence = "schema" | "invariant" | "security" | "empirical" | "advisory";

export type IgnoreReason =
  | "generated-worktree"
  | "duplicate-physical-file"
  | "outside-workspace-symlink";

export interface Diagnostic {
  severity: Severity;
  category: Category;
  rule: string;
  file: string;
  line?: number;
  message: string;
  fix?: string; // suggested fix description
}

export interface FileInfo {
  name: string;
  path: string;
  workspaceRoot: string;
  canonicalPath: string;
  content: string;
  lines: string[];
  sections: Section[];
  context: LintContext;
}

export interface Section {
  heading: string;
  level: number;
  startLine: number;
  endLine: number;
  content: string;
}

export interface CategoryScore {
  category: Category;
  score: number; // 0-100
  weight: number; // 0-1
  diagnostics: Diagnostic[];
}

export interface ScanAlias {
  logicalPath: string;
  canonicalPath: string;
}

export interface IgnoredPath {
  logicalPath: string;
  reason: IgnoreReason;
}

export interface ScanSummary {
  policyVersion: "2026-07-22";
  discovered: number;
  analyzed: number;
  aliases: ScanAlias[];
  ignored: IgnoredPath[];
}

export interface ScanResult {
  files: FileInfo[];
  summary: ScanSummary;
}

export interface RuleCatalogEntry {
  id: string;
  category: Category;
  defaultSeverity: Severity;
  description: string;
  evidence: RuleEvidence;
  source?: { label: string; url: string; asOf: string };
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
  categoryWeights: Record<Category, number>;
  gradeScale: Array<{ grade: string; min: number }>;
  disclaimer: string;
  bonusDescriptions: string[];
}

export interface LintResult {
  workspace: string;
  context: LintContext;
  files: FileInfo[];
  categories: CategoryScore[];
  totalScore: number;
  diagnostics: Diagnostic[];
  scan: ScanSummary;
  ruleSummary: { evaluated: number; flagged: number; passed: number };
  rules: RuleCatalogEntry[];
  scoringPolicy: ScoringPolicySnapshot;
  timestamp: string;
}

export interface Rule {
  id: string;
  category: Category;
  severity: Severity;
  description: string;
  applicableContexts?: LintContext[]; // If undefined, applies to all contexts
  check: (files: FileInfo[]) => Diagnostic[];
}

export const CATEGORY_WEIGHTS: Record<Category, number> = {
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
};

export const CATEGORY_LABELS: Record<Category, string> = {
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
