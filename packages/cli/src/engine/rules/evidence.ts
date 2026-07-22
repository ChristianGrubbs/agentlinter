import type { RuleCatalogEntry, RuleEvidence } from "../types";

const HOOKS_SOURCE = {
  label: "Claude Code hooks documentation",
  url: "https://code.claude.com/docs/en/hooks",
  asOf: "2026-07-22",
} as const;

const CONFIGURATION_SMELLS_SOURCE = {
  label: "Configuration-smells study",
  url: "https://arxiv.org/abs/2606.15828",
  asOf: "2026-06-18",
} as const;

const schemaRules = new Set(["claude-code/hooks-structure", "structure/dead-import"]);
const invariantRules = new Set(["consistency/referenced-files-exist"]);
const securityRules = new Set([
  "runtime/config-secrets",
  "security/no-secrets",
  "security/has-injection-defense",
  "security/prompt-injection-vulnerability",
  "security/no-injection-defense",
  "security/api-key-exposure",
  "security/env-var-references",
  "skill-safety/dangerous-commands",
  "skill-safety/sensitive-paths",
  "skill-safety/data-exfiltration",
  "skill-safety/excessive-permissions",
  "skill-safety/injection-vectors",
]);
const empiricalRules = new Set([
  "clarity/duplicate-content",
  "clarity/no-contradictions",
  "consistency/no-duplicate-instructions",
  "consistency/stale-file-reference",
  "consistency/stale-date",
  "consistency/stale-package-reference",
  "consistency/permission-conflict",
  "consistency/priority-conflict",
  "consistency/outdated-cross-references",
]);

export function evidenceForRule({ id }: { id: string }): Pick<RuleCatalogEntry, "evidence" | "source"> {
  if (schemaRules.has(id)) {
    return { evidence: "schema" satisfies RuleEvidence, ...(id === "claude-code/hooks-structure" ? { source: HOOKS_SOURCE } : {}) };
  }
  if (invariantRules.has(id)) return { evidence: "invariant" };
  if (securityRules.has(id)) return { evidence: "security" };
  if (empiricalRules.has(id)) return { evidence: "empirical", source: CONFIGURATION_SMELLS_SOURCE };
  return { evidence: "advisory" };
}
