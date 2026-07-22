/* ─── Scoring Engine ─── */

import {
  FileInfo,
  Category,
  CategoryScore,
  LintResult,
  Diagnostic,
  ScanSummary,
} from "./types";
import { allRules } from "./rules";
import { evidenceForRule } from "./rules/evidence";
import { SCORING_POLICY, calculateWeightedTotal, categoryWeight } from "./scoringPolicy";
import { logEngineDecision } from "./decisionLog";

/**
 * Run all rules and compute scores
 */
export function lint(workspacePath: string, files: FileInfo[], { scan }: { scan: ScanSummary }): LintResult {
  // Separate core agent files from skill files
  const coreFiles = files.filter((f) => !f.name.startsWith("skills/") && !f.name.includes("/skills/"));
  const skillFiles = files.filter((f) => f.name.startsWith("skills/"));

  // Detect workspace context
  const context = files[0]?.context || "universal";

  const applicableRules = allRules.filter((rule) =>
    !rule.applicableContexts
    || rule.applicableContexts.includes(context)
    || rule.applicableContexts.includes("universal"),
  );
  const rules = applicableRules.map((rule) => ({
    id: rule.id,
    category: rule.category,
    defaultSeverity: rule.severity,
    description: rule.description,
    ...evidenceForRule({ id: rule.id }),
  }));
  logEngineDecision({
    event: "applicable_rules_selected",
    loc: "engine.scorer.lint",
    ctx: { applicableRuleCount: applicableRules.length },
  });

  // Run applicable rules — skill files only go through skillSafety + runtime rules
  const allDiagnostics: Diagnostic[] = [];
  for (const rule of applicableRules) {
    try {
      const targetFiles =
        rule.category === "skillSafety" || rule.category === "runtime" || rule.category === "remoteReady"
          ? files       // these categories check everything
          : coreFiles;  // other categories only check core agent files
      const diagnostics = rule.check(targetFiles);
      allDiagnostics.push(...diagnostics);
    } catch (e) {
      // Rule failed — skip silently
      console.error(`Rule ${rule.id} failed:`, e);
    }
  }

  // Group by category
  const categories: Category[] = [
    "structure",
    "clarity",
    "completeness",
    "security",
    "consistency",
    "memory",
    "runtime",
    "skillSafety",
    "remoteReady",
    "blueprint",
    "freshness",
  ];

  const categoryScores: CategoryScore[] = categories.map((cat) => {
    const catDiagnostics = allDiagnostics.filter((d) => d.category === cat);
    const score = computeCategoryScore(cat, catDiagnostics, files);

    return {
      category: cat,
      score,
      weight: categoryWeight(cat),
      diagnostics: catDiagnostics,
    };
  });

  // Compute total weighted score
  const totalScore = calculateWeightedTotal({ categoryScores });
  const flaggedIds = new Set(allDiagnostics.map((diagnostic) => diagnostic.rule));
  const ruleSummary = {
    evaluated: applicableRules.length,
    flagged: flaggedIds.size,
    passed: applicableRules.length - flaggedIds.size,
  };
  logEngineDecision({
    event: "score_completed",
    loc: "engine.scorer.lint",
    ctx: { categoryCount: categoryScores.length, diagnosticCount: allDiagnostics.length, totalScore },
  });

  return {
    workspace: workspacePath,
    context,
    files,
    categories: categoryScores,
    totalScore,
    diagnostics: allDiagnostics,
    scan,
    ruleSummary,
    rules,
    scoringPolicy: SCORING_POLICY,
    timestamp: new Date().toISOString(),
  };
}

/**
 * Compute score for a category based on diagnostics
 */
function computeCategoryScore(
  category: Category,
  diagnostics: Diagnostic[],
  files: FileInfo[]
): number {
  // Start at 100, deduct for issues
  let score = SCORING_POLICY.basePerCategory;

  const criticals = diagnostics.filter((d) => d.severity === "critical");
  const errors = diagnostics.filter((d) => d.severity === "error");
  const warnings = diagnostics.filter((d) => d.severity === "warning");
  const infos = diagnostics.filter((d) => d.severity === "info");

  // Deductions (with caps to prevent info avalanche from tanking score)
  score -= criticals.length * SCORING_POLICY.criticalPenalty; // criticals are showstoppers

  // skillSafety scaling: cap error/warning deductions when many skills exist
  if (category === "skillSafety") {
    const skillCount = files.filter((f) => f.name.includes("skills/")).length;
    if (skillCount > SCORING_POLICY.skillSafetyScaling.skillCountThreshold) {
      score -= Math.min(errors.length * SCORING_POLICY.defaultErrorPenalty, SCORING_POLICY.skillSafetyScaling.errorCap);
      score -= Math.min(warnings.length * SCORING_POLICY.skillSafetyScaling.warningPenalty, SCORING_POLICY.skillSafetyScaling.warningCap);
    } else {
      score -= errors.length * SCORING_POLICY.defaultErrorPenalty;
      score -= warnings.length * SCORING_POLICY.defaultWarningPenalty;
    }
  } else {
    // Consistency: reduce per-error penalty (stale dates etc. pile up fast)
    const errorPenalty = category === "consistency" ? SCORING_POLICY.consistencyErrorPenalty : SCORING_POLICY.defaultErrorPenalty;
    score -= errors.length * errorPenalty;
    // Runtime: reduce warning penalty (3 instead of 5) to reward good patterns over warnings
    const warningPenalty = category === "runtime" ? SCORING_POLICY.runtimeWarningPenalty : SCORING_POLICY.defaultWarningPenalty;
    const rawWarningDeduction = warnings.length * warningPenalty;
    // Clarity cap: token/size warnings for large workspaces shouldn't tank to 0
    // Multi-agent setups legitimately have large memory/heartbeat/tools files
    const warningCap = category === "clarity" ? SCORING_POLICY.clarityWarningCap : Infinity;
    score -= Math.min(rawWarningDeduction, warningCap);
  }

  score -= Math.min(infos.length * SCORING_POLICY.infoPenalty, SCORING_POLICY.infoCap); // infos are minor, capped at -20

  // Bonus points for good practices (category-specific)
  score += computeBonus(category, files);

  // Clamp to 0-100 (consistency gets a minimum floor of 25)
  const floor = category === "consistency" ? SCORING_POLICY.consistencyFloor : 0;
  return Math.max(floor, Math.min(SCORING_POLICY.basePerCategory, Math.round(score)));
}

/**
 * Bonus points for positive signals
 */
function computeBonus(category: Category, files: FileInfo[]): number {
  let bonus = 0;

  switch (category) {
    case "structure":
      // Bonus for modular files
      const mdFiles = files.filter((f) => f.name.endsWith(".md"));
      if (mdFiles.length >= 3) bonus += 5;
      if (mdFiles.length >= 5) bonus += 5;
      break;

    case "clarity":
      // Bonus for having examples
      const hasExamples = files.some(
        (f) => f.content.includes("```") || /example/i.test(f.content)
      );
      if (hasExamples) bonus += 5;
      break;

    case "completeness":
      // Bonus for having all key files
      const keyFiles = ["SOUL.md", "IDENTITY.md", "USER.md", "TOOLS.md", "SECURITY.md"];
      const foundKeys = keyFiles.filter((k) =>
        files.some((f) => f.name === k)
      ).length;
      bonus += foundKeys * 2;
      break;

    case "security":
      // Bonus for having security file
      if (files.some((f) => f.name === "SECURITY.md")) bonus += 5;
      // Bonus for injection defense
      const allContent = files.map((f) => f.content).join("\n");
      if (/inject|jailbreak/i.test(allContent)) bonus += 5;
      break;

    case "consistency":
      // Bonus for consistent naming
      const rootMd = files.filter(
        (f) => f.name.endsWith(".md") && !f.name.includes("/")
      );
      const allUpper = rootMd.every(
        (f) => f.name === f.name.toUpperCase().replace(/\.MD$/, ".md")
      );
      if (allUpper && rootMd.length > 1) bonus += 5;
      break;

    case "memory":
      // Bonus for having memory-related files
      if (files.some((f) => f.name === "MEMORY.md")) bonus += 5;
      if (files.some((f) => f.name === "HEARTBEAT.md")) bonus += 3;
      if (files.some((f) => f.name.includes("progress"))) bonus += 3;
      // Bonus for memory directory
      if (files.some((f) => f.name.includes("memory/"))) bonus += 5;
      break;

    case "runtime":
      // Bonus for having a runtime config
      const configFile = files.find((f) => 
        f.name === "clawdbot.json" || 
        f.name === "openclaw.json" || 
        f.name === ".clawdbot/clawdbot.json"
      );
      
      if (configFile) {
        bonus += 5; // Basic config exists
        
        try {
          const config = JSON.parse(configFile.content);
          
          // +10 for using env var pattern (best practice for secrets)
          const hasEnvVarPattern = /\$\{[A-Z_]+\}/.test(configFile.content);
          if (hasEnvVarPattern) bonus += 10;
          
          // +5 for strong auth token (32+ chars or env var reference)
          const authToken = config.gateway?.auth?.token;
          if (authToken && (authToken.startsWith("${") || authToken.length >= 32)) {
            bonus += 5;
          }
          
          // +5 for using allowlist group policy (secure by default)
          const channels = config.channels;
          if (channels && typeof channels === "object") {
            const hasAllowlistGroup = Object.values(channels).some((ch: any) => 
              ch?.groupPolicy === "allowlist"
            );
            if (hasAllowlistGroup) bonus += 5;
            
            // +5 for restrictive DM policy (pairing or has allowFrom)
            const hasRestrictiveDM = Object.values(channels).some((ch: any) => 
              ch?.dmPolicy === "pairing" || 
              (ch?.dmPolicy === "open" && Array.isArray(ch?.allowFrom) && ch.allowFrom.length > 0)
            );
            if (hasRestrictiveDM) bonus += 5;
          }
        } catch {
          // JSON parse failed — skip bonus (config-exists rule will warn)
        }
      }
      break;

    case "skillSafety": {
      const skillFiles = files.filter((f) => f.name.includes("skills/") && f.name.endsWith("SKILL.md"));
      if (skillFiles.length === 0) {
        bonus += 10; // No skills — nothing to check
      } else {
        const withFrontmatter = skillFiles.filter((f) => f.content.startsWith("---"));
        if (withFrontmatter.length >= skillFiles.length * 0.8) bonus += 10;
        else if (withFrontmatter.length > 0) bonus += 5;

        const withDescription = skillFiles.filter(f => {
          const fm = f.content.split("---")[1] || "";
          return fm.includes("description");
        });
        if (withDescription.length >= skillFiles.length * 0.8) bonus += 5;
      }
      break;
    }

    case "remoteReady": {
      // Bonus for having explicit workspace path
      const allRemoteContent = files
        .filter((f) => !f.name.startsWith("memory/"))
        .map((f) => f.content)
        .join("\n");

      if (/(?:repo|workspace|workdir|cwd)\s*=\s*\/[^\s]+/i.test(allRemoteContent)) bonus += 5;
      if (/env(?:ironment)?\s+var(?:iable)?s?/i.test(allRemoteContent)) bonus += 5;
      if (/model\s*[:=]\s*["']?(?:anthropic|openai|google|xai|gpt|claude|gemini|grok)/i.test(allRemoteContent)) bonus += 5;
      // Bonus for Runtime section in agent files
      if (/##\s*Runtime/i.test(allRemoteContent)) bonus += 5;
      break;
    }
  }

  return bonus;
}
