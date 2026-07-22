import { CATEGORY_WEIGHTS, type Category, type ScoringPolicySnapshot } from "./types";

export const SCORING_POLICY: ScoringPolicySnapshot = {
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

export function gradeForScore(score: number): string {
  return SCORING_POLICY.gradeScale.find((tier) => score >= tier.min)?.grade ?? "F";
}

export function categoryWeight(category: Category): number {
  return SCORING_POLICY.categoryWeights[category];
}

export function calculateWeightedTotal({
  categoryScores,
}: {
  categoryScores: ReadonlyArray<Pick<{ category: Category; score: number }, "category" | "score">>;
}): number {
  return Math.round(
    categoryScores.reduce((sum, categoryScore) =>
      sum + categoryScore.score * categoryWeight(categoryScore.category), 0),
  );
}
