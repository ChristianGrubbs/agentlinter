/* ─── Skill Safety Rules (10%) ─── */
/* Pre-install security checks for agent skills */

import { Rule, Diagnostic } from "../types";

/** Patterns that indicate potentially dangerous skill behavior */
const DANGEROUS_EXEC_PATTERNS = [
  { pattern: /rm\s+-rf\s+[\/~]/, name: "Recursive delete on root/home", severity: "error" as const },
  { pattern: /curl\s+.*\|\s*(?:bash|sh|zsh)/, name: "Pipe curl to shell", severity: "error" as const },
  { pattern: /eval\s*\(/, name: "Dynamic eval execution", severity: "warning" as const },
  { pattern: /wget\s+.*-O\s*-\s*\|\s*(?:bash|sh)/, name: "Pipe wget to shell", severity: "error" as const },
  { pattern: /chmod\s+777/, name: "World-writable permissions", severity: "warning" as const },
  { pattern: /sudo\s+/, name: "Sudo usage", severity: "warning" as const },
];

const SENSITIVE_PATH_PATTERNS = [
  { pattern: /~\/\.ssh/, name: "SSH keys directory" },
  { pattern: /~\/\.gnupg/, name: "GPG keys directory" },
  { pattern: /~\/\.aws\/credentials/, name: "AWS credentials" },
  { pattern: /~\/\.env/, name: "Environment file" },
  { pattern: /\/etc\/passwd/, name: "System password file" },
  { pattern: /\/etc\/shadow/, name: "System shadow file" },
  { pattern: /~\/\.clawdbot\/clawdbot\.json/, name: "Agent config with tokens" },
];

const DATA_EXFIL_PATTERNS = [
  { pattern: /curl\s+.*-d\s+.*\$/, name: "curl POST with variable data" },
  { pattern: /curl\s+.*--data.*\$/, name: "curl data with variable" },
  { pattern: /fetch\s*\(.*\+/, name: "Dynamic fetch URL construction" },
  { pattern: /webhook\.site|requestbin|pipedream/, name: "Known data collection service" },
  { pattern: /ngrok|localhost\.run|serveo/, name: "Tunnel service (potential exfil)" },
];

/** Security/defense skills document attacks as examples — demote severity for these */
const SECURITY_SKILL_PATTERNS = [
  /prompt[- ]?guard/i, /security/i, /injection/i, /defense/i, /detect/i,
  /shield/i, /protect/i, /hive[- ]?fence/i, /guard/i, /firewall/i,
  /threat/i, /attack/i, /vulnerability/i, /red[- ]?team/i, /pentest/i,
];

/** Check if a file is a security-related skill (documents attack patterns for defensive purposes) */
function isSecuritySkill(file: { name: string; content: string }): boolean {
  return SECURITY_SKILL_PATTERNS.some(
    (p) => p.test(file.name) || p.test(file.content.substring(0, 500))
  );
}

type YamlStringField = "name" | "description";

/**
 * Parse the YAML string subset needed by skill metadata: plain, quoted, and
 * block scalars. Collections and explicit tags/anchors/aliases fail closed.
 */
function extractYamlString({
  frontmatter,
  field,
}: {
  frontmatter: string;
  field: YamlStringField;
}): string | null {
  const lines = frontmatter.split("\n");
  const fieldPattern = new RegExp(`^${field}:\\s*(.*)$`);
  const fieldIndex = lines.findIndex((line) => fieldPattern.test(line));
  if (fieldIndex === -1) return null;

  const rawValue = lines[fieldIndex].match(fieldPattern)?.[1].trim() ?? "";
  if (/^[>|]/.test(rawValue)) {
    const blockHeader = rawValue.match(
      /^[>|](?:(?:[+-][1-9]?)|(?:[1-9][+-]?))?(?:\s+#.*)?$/,
    );
    if (!blockHeader) return null;

    const headerSyntax = rawValue.replace(/\s+#.*$/, "");
    const indentIndicator = headerSyntax.match(/[1-9]/)?.[0];
    const minimumIndent = indentIndicator ? Number(indentIndicator) : 1;
    const blockLines: string[] = [];
    for (let index = fieldIndex + 1; index < lines.length; index++) {
      const line = lines[index];
      if (line.trim()) {
        const indentation = line.match(/^[ \t]*/)?.[0].length ?? 0;
        if (indentation < minimumIndent) break;
      }
      blockLines.push(line.trim());
    }
    const value = blockLines.join(" ").trim();
    return value || null;
  }

  const doubleQuoted = rawValue.match(/^"((?:[^"\\]|\\.)*)"\s*(?:#.*)?$/);
  if (doubleQuoted) {
    const value = doubleQuoted[1].replace(/\\"/g, '"').trim();
    return value || null;
  }

  const singleQuoted = rawValue.match(/^'((?:[^']|'')*)'\s*(?:#.*)?$/);
  if (singleQuoted) {
    const value = singleQuoted[1].replace(/''/g, "'").trim();
    return value || null;
  }

  if (!rawValue || rawValue.startsWith("#") || /^(?:!|&|\*|\[|\{)/.test(rawValue)) {
    return null;
  }

  const withoutComment = rawValue.replace(/\s+#.*$/, "").trim();
  if (!withoutComment || /^(?:true|false|null|~|[-+]?\d+(?:\.\d+)?)$/i.test(withoutComment)) {
    return null;
  }
  return withoutComment;
}

function extractDescription(frontmatter: string): string | null {
  return extractYamlString({ frontmatter, field: "description" });
}

const NON_CONCRETE_WORDS = new Set([
  "a", "an", "the", "it", "thing", "things", "stuff", "helper", "helpers", "something",
  "anything", "task", "tasks", "needed", "necessary", "appropriate", "when",
]);

function hasConcreteObject(text: string): boolean {
  const words = text.toLowerCase().match(/[\p{L}\p{N}][\p{L}\p{N}'-]*/gu) ?? [];
  const objectHead = words.at(-1) ?? "";
  if (/ly$/.test(objectHead) || /^(?:helper|assistant|generator)s?$/.test(objectHead)) {
    return false;
  }
  return words.some((word) => !NON_CONCRETE_WORDS.has(word) && !/ly$/.test(word));
}

function hasUsableTriggerDescription(description: string): boolean {
  const normalized = description.trim();
  if (!normalized) return false;

  const explicitTrigger = normalized.match(
    /\b(?:when(?:ever)?|use\s+for|triggered\s+by)\b\s*(.*)$/i,
  );
  if (explicitTrigger) return hasConcreteObject(explicitTrigger[1]);
  if (/요청\s*시|사용\s*시|필요\s*시/i.test(normalized)) return true;

  const capability = normalized.match(/^([\p{L}][\p{L}'-]*)\s+(.+)$/u);
  if (!capability || /^(?:a|an|the)$/i.test(capability[1])) return false;

  // Imperative descriptions use a base-form-looking leader. Narrow productive
  // adjective/adverb endings reject phrase-shaped leaders without a verb list.
  if (/(?:ated|ized|ised|ified|ly|ous|ful|less|able|ible|ellent|icient|istent|ulent)$/i.test(capability[1])) {
    return false;
  }
  return hasConcreteObject(capability[2]);
}

type CommandContext = "executable" | "blocked-example" | "reference";

const BLOCKED_PROSE_CONTEXT = /\b(?:block(?:ed)?\s+(?:example|command)|reject(?:ed)?\s+(?:example|command)|forbidden\s+(?:example|command)|detection\s+pattern|negative\s+test|must\s+not\s+execute|do\s+not\s+execute)\b/i;
const SHELL_FENCE_LANGUAGES = new Set([
  "sh", "bash", "zsh", "fish", "pwsh", "powershell", "shell", "shellscript", "console", "terminal",
]);

type FenceContext = {
  delimiter: boolean;
  insideFence: boolean;
  language: string | null;
};

function normalizeFenceLanguage(info: string): string | null {
  const trimmed = info.trim();
  if (!trimmed) return null;
  const attributeLanguage = trimmed.match(/^\{[^}]*\.([\w-]+)/);
  if (attributeLanguage) return attributeLanguage[1].toLowerCase();
  return trimmed.split(/\s+/)[0].replace(/^\./, "").toLowerCase();
}

// Fence state is computed once so code lines never become prose evidence. An
// adjacent prose line may cross exactly one immediate opening/closing delimiter.
function parseFenceContexts(lines: string[]): FenceContext[] {
  const contexts: FenceContext[] = [];
  let activeFence: { marker: "`" | "~"; length: number; language: string | null } | null = null;

  for (const line of lines) {
    const fence = line.trim().match(/^(`{3,}|~{3,})(.*)$/);
    if (fence) {
      const marker = fence[1][0] as "`" | "~";
      if (activeFence && marker === activeFence.marker && fence[1].length >= activeFence.length) {
        contexts.push({ delimiter: true, insideFence: false, language: activeFence.language });
        activeFence = null;
        continue;
      }
      if (!activeFence) {
        activeFence = {
          marker,
          length: fence[1].length,
          language: normalizeFenceLanguage(fence[2]),
        };
        contexts.push({ delimiter: true, insideFence: false, language: activeFence.language });
        continue;
      }
    }

    contexts.push({
      delimiter: false,
      insideFence: activeFence !== null,
      language: activeFence?.language ?? null,
    });
  }

  return contexts;
}

function isBlockedProseLine(line: string): boolean {
  if (!BLOCKED_PROSE_CONTEXT.test(line)) return false;
  if (/(?:^|[;\s])[^\s=;]+\s*=|[;&]{1,2}|\|\||[{}]/.test(line)) return false;

  const prose = line.trim().replace(/^[-*>|]\s*/, "");
  return /^[A-Z]/.test(prose) || /[.:!?]$/.test(prose);
}

function adjacentBlockedProse({
  lines,
  contexts,
  lineIndex,
  direction,
}: {
  lines: string[];
  contexts: FenceContext[];
  lineIndex: number;
  direction: -1 | 1;
}): string | null {
  let adjacentIndex = lineIndex + direction;
  if (adjacentIndex < 0 || adjacentIndex >= lines.length) return null;

  if (contexts[adjacentIndex].delimiter) adjacentIndex += direction;
  if (adjacentIndex < 0 || adjacentIndex >= lines.length) return null;
  if (contexts[adjacentIndex].delimiter || contexts[adjacentIndex].insideFence) return null;

  return isBlockedProseLine(lines[adjacentIndex]) ? lines[adjacentIndex] : null;
}

function classifyCommandContext({
  lines,
  contexts,
  lineIndex,
}: {
  lines: string[];
  contexts: FenceContext[];
  lineIndex: number;
}): CommandContext {
  const line = lines[lineIndex];
  if (/^\s*(?:>|\|)/.test(line)) return "reference";
  const context = contexts[lineIndex];
  if (context.insideFence && context.language && !SHELL_FENCE_LANGUAGES.has(context.language)) {
    return "reference";
  }

  const prose = [
    !context.insideFence && isBlockedProseLine(line) ? line : null,
    adjacentBlockedProse({ lines, contexts, lineIndex, direction: -1 }),
    adjacentBlockedProse({ lines, contexts, lineIndex, direction: 1 }),
  ].filter((candidate): candidate is string => candidate !== null).join(" ");
  if (prose) return "blocked-example";

  return "executable";
}

export const skillSafetyRules: Rule[] = [
  {
    id: "skill-safety/skill-name-match-dir",
    category: "skillSafety",
    severity: "error",
    description: "SKILL.md name frontmatter must match parent directory name",
    check(files) {
      const diagnostics: Diagnostic[] = [];
      const skillFiles = files.filter(
        (f) => f.name.includes("skills/") && f.name.endsWith("SKILL.md")
      );

      for (const file of skillFiles) {
        if (!file.content.startsWith("---")) continue;

        const frontmatter = file.content.split("---")[1] || "";
        const declaredName = extractYamlString({ frontmatter, field: "name" });
        if (!declaredName) continue; // missing/invalid name is caught by has-metadata

        // Extract parent dir name from path like "skills/weather/SKILL.md"
        const parts = file.name.split("/");
        const skillDirIndex = parts.lastIndexOf("SKILL.md") - 1;
        if (skillDirIndex < 0) continue;
        const dirName = parts[skillDirIndex];

        if (declaredName !== dirName) {
          diagnostics.push({
            severity: "error",
            category: "skillSafety",
            rule: this.id,
            file: file.name,
            message: `Skill name "${declaredName}" does not match directory name "${dirName}". ClawdHub uses the directory name for routing.`,
            fix: `Change name to "${dirName}" in frontmatter, or rename the directory to "${declaredName}".`,
          });
        }
      }
      return diagnostics;
    },
  },

  {
    id: "skill-safety/skill-description-when-to-use",
    category: "skillSafety",
    severity: "warning",
    description: "SKILL.md description should explain when to use the skill",
    check(files) {
      const diagnostics: Diagnostic[] = [];
      const skillFiles = files.filter(
        (f) => f.name.includes("skills/") && f.name.endsWith("SKILL.md")
      );

      for (const file of skillFiles) {
        if (!file.content.startsWith("---")) continue;

        const frontmatter = file.content.split("---")[1] || "";
        const description = extractDescription(frontmatter);
        if (!description) continue; // missing description handled by has-metadata

        if (!hasUsableTriggerDescription(description)) {
          diagnostics.push({
            severity: "warning",
            category: "skillSafety",
            rule: this.id,
            file: file.name,
            message: `Skill description does not explain when to use it: "${description.substring(0, 80)}"`,
            fix: 'Add "when to use" context to description. Example: "Use when user asks for X" or "When Claude needs to Y".',
          });
        }
      }
      return diagnostics;
    },
  },

  {
    id: "skill-safety/has-metadata",
    category: "skillSafety",
    severity: "warning",
    description: "Skills should have required metadata (name and description)",
    check(files) {
      const diagnostics: Diagnostic[] = [];
      const skillFiles = files.filter(
        (f) => f.name.includes("skills/") && f.name.endsWith("SKILL.md")
      );

      for (const file of skillFiles) {
        const hasFrontmatter = file.content.startsWith("---");
        if (!hasFrontmatter) {
          diagnostics.push({
            severity: "info",
            category: "skillSafety",
            rule: this.id,
            file: file.name,
            message: "Skill missing YAML frontmatter (name and description).",
            fix: "Add frontmatter: ---\\nname: skill-name\\ndescription: ...\\n---",
          });
          continue;
        }

        const frontmatter = file.content.split("---")[1] || "";
        if (!extractYamlString({ frontmatter, field: "name" })) {
          diagnostics.push({
            severity: "info",
            category: "skillSafety",
            rule: this.id,
            file: file.name,
            message: "Skill missing name field — it cannot be routed reliably.",
            fix: "Add a non-empty name field to frontmatter.",
          });
        }
        if (!extractDescription(frontmatter)) {
          diagnostics.push({
            severity: "info",
            category: "skillSafety",
            rule: this.id,
            file: file.name,
            message: "Skill missing description — unclear what this skill does.",
            fix: "Add a description field to frontmatter.",
          });
        }
      }
      return diagnostics;
    },
  },

  {
    id: "skill-safety/dangerous-commands",
    category: "skillSafety",
    severity: "error",
    description: "Skills should not contain dangerous shell commands",
    check(files) {
      const diagnostics: Diagnostic[] = [];
      const skillFiles = files.filter((f) => f.name.includes("skills/"));

      for (const file of skillFiles) {
        const fenceContexts = parseFenceContexts(file.lines);
        for (let i = 0; i < file.lines.length; i++) {
          const line = file.lines[i];
          if (fenceContexts[i].delimiter) continue;

          for (const { pattern, name, severity } of DANGEROUS_EXEC_PATTERNS) {
            if (pattern.test(line)) {
              const context = classifyCommandContext({
                lines: file.lines,
                contexts: fenceContexts,
                lineIndex: i,
              });

              diagnostics.push({
                severity: context === "executable" ? severity : "info",
                category: "skillSafety",
                rule: this.id,
                file: file.name,
                line: i + 1,
                message: `Dangerous command: ${name} — "${line.trim().substring(0, 60)}"`,
                fix: "Review this command carefully. Consider restricting scope or adding user confirmation.",
              });
            }
          }
        }
      }
      return diagnostics;
    },
  },

  {
    id: "skill-safety/sensitive-paths",
    category: "skillSafety",
    severity: "warning",
    description: "Skills should not access sensitive system paths",
    check(files) {
      const diagnostics: Diagnostic[] = [];
      const skillFiles = files.filter((f) => f.name.includes("skills/"));
      for (const file of skillFiles) {
        const isSecurity = isSecuritySkill(file);
        for (let i = 0; i < file.lines.length; i++) {
          const line = file.lines[i];
          for (const { pattern, name } of SENSITIVE_PATH_PATTERNS) {
            if (pattern.test(line)) {
              diagnostics.push({
                severity: isSecurity ? "info" : "warning",
                category: "skillSafety",
                rule: this.id,
                file: file.name,
                line: i + 1,
                message: `Access to sensitive path: ${name}`,
                fix: isSecurity
                  ? "This is a security skill documenting sensitive paths. Verify context."
                  : "Ensure this access is necessary and the skill has legitimate reasons for it.",
              });
            }
          }
        }
      }
      return diagnostics;
    },
  },

  {
    id: "skill-safety/data-exfiltration",
    category: "skillSafety",
    severity: "error",
    description: "Skills should not exfiltrate data to external services",
    check(files) {
      const diagnostics: Diagnostic[] = [];
      const skillFiles = files.filter((f) => f.name.includes("skills/"));

      for (const file of skillFiles) {
        const isSecurity = isSecuritySkill(file);
        let inCodeBlock = false;
        for (let i = 0; i < file.lines.length; i++) {
          const line = file.lines[i];
          if (line.trim().startsWith("```")) inCodeBlock = !inCodeBlock;
          for (const { pattern, name } of DATA_EXFIL_PATTERNS) {
            if (pattern.test(line)) {
              const isDoc = isSecurity || inCodeBlock || /^[\s]*[>❌✅|$#]/.test(line);
              diagnostics.push({
                severity: isDoc ? "info" : "error",
                category: "skillSafety",
                rule: this.id,
                file: file.name,
                line: i + 1,
                message: `Potential data exfiltration: ${name}`,
                fix: "Review this skill for data exfiltration. Ensure external calls are intentional and authorized.",
              });
            }
          }
        }
      }
      return diagnostics;
    },
  },

  {
    id: "skill-safety/excessive-permissions",
    category: "skillSafety",
    severity: "warning",
    description: "Skills requesting broad permissions should be flagged",
    check(files) {
      const diagnostics: Diagnostic[] = [];
      const skillFiles = files.filter(
        (f) => f.name.includes("skills/") && f.name.endsWith("SKILL.md")
      );

      const broadPermissionPatterns = [
        /(?:grant|give|require|need)s?\s+(?:full|unrestricted|unlimited)\s+(?:access|permission|control)/i,
        /(?:grant|give|require|need)s?\s+access\s+(?:to\s+)?(?:all|any|every)\s+(?:files?|directories|folders)/i,
        /(?:read|write|modify)\s+(?:any|all|every)\s+(?:files?|data|directories)/i,
        /disable\s+(?:security|safety|restrictions|guardrails)/i,
      ];

      for (const file of skillFiles) {
        for (let i = 0; i < file.lines.length; i++) {
          const line = file.lines[i];
          for (const pattern of broadPermissionPatterns) {
            if (pattern.test(line)) {
              diagnostics.push({
                severity: "warning",
                category: "skillSafety",
                rule: this.id,
                file: file.name,
                line: i + 1,
                message: `Broad permission request: "${line.trim().substring(0, 60)}"`,
                fix: "Skills should request minimal necessary permissions. Review scope.",
              });
            }
          }
        }
      }
      return diagnostics;
    },
  },

  {
    id: "skill-safety/injection-vectors",
    category: "skillSafety",
    severity: "error",
    description: "Skills should not contain prompt injection vectors",
    check(files) {
      const diagnostics: Diagnostic[] = [];
      const skillFiles = files.filter((f) => f.name.includes("skills/"));

      const injectionPatterns = [
        /ignore\s+(?:all\s+)?(?:previous|above|prior)\s+(?:instructions?|rules?|constraints?)/i,
        /forget\s+(?:all|everything|your)\s+(?:previous|prior|above)/i,
        /system\s*:\s*you\s+(?:are|must|should|will)/i,
        /override\s+(?:all|your|system)\s+(?:rules|instructions|constraints)/i,
      ];
      // "you are now" is only suspicious if followed by jailbreak-style role changes, not normal role descriptions
      const jailbreakRolePattern = /you\s+are\s+now\s+(?:a|an|in)\s+(?:new|different|unrestricted|evil|DAN|jailbr)/i;

      for (const file of skillFiles) {
        const isSecurity = isSecuritySkill(file);
        let inCodeBlock = false;

        for (let i = 0; i < file.lines.length; i++) {
          const line = file.lines[i];

          // Track code blocks
          if (line.trim().startsWith("```")) inCodeBlock = !inCodeBlock;

          const allPatterns = [...injectionPatterns, jailbreakRolePattern];
          for (const pattern of allPatterns) {
            if (pattern.test(line)) {
              // Demote severity for security docs, code blocks, or example lines
              const isExample = inCodeBlock
                || /^[\s]*[❌✅⚠️|>$#]/.test(line)
                || /example|detect|pattern|test/i.test(line)
                || isSecurity;

              diagnostics.push({
                severity: isExample ? "info" : "error",
                category: "skillSafety",
                rule: this.id,
                file: file.name,
                line: i + 1,
                message: `Potential injection vector in skill: "${line.trim().substring(0, 60)}"`,
                fix: isExample
                  ? "This appears to be a security example/documentation. Verify it's not executable."
                  : "This skill may contain a prompt injection attack. Do NOT install without careful review.",
              });
            }
          }
        }
      }
      return diagnostics;
    },
  },
];
