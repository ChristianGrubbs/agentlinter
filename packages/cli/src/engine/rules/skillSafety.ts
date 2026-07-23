/* ─── Skill Safety Rules (10%) ─── */
/* Pre-install security checks for agent skills */

import { appendFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { Rule, Diagnostic } from "../types";

export const SKILL_SAFETY_LOG_DEFAULT_PATH = "/tmp/agentlinter-skill-safety.jsonl";
const SKILL_SAFETY_LOG_RUN_ID = randomUUID();

type DecisionLogContext = Record<string, string | boolean | number>;

function logSkillSafetyDecision({
  event,
  loc,
  ctx,
}: {
  event: "skill-safety.yaml.parse" | "skill-safety.trigger-contract" | "skill-safety.command-context";
  loc: string;
  ctx: DecisionLogContext;
}): void {
  if (process.env.AGENTLINTER_SKILL_SAFETY_LOG !== "1") return;
  const entry = {
    ts: new Date().toISOString(),
    run_id: SKILL_SAFETY_LOG_RUN_ID,
    level: "info",
    event,
    loc,
    ctx,
  };
  appendFileSync(
    process.env.AGENTLINTER_SKILL_SAFETY_LOG_PATH || SKILL_SAFETY_LOG_DEFAULT_PATH,
    `${JSON.stringify(entry)}\n`,
    { encoding: "utf8", mode: 0o600 },
  );
}

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
 * block scalars. Collections and explicit tags/anchors/aliases fail closed;
 * implicit block indentation follows its first content line and tabs fail.
 */
function findYamlField(lines: string[], field: YamlStringField): { fieldIndex: number; rawValue: string } | null {
  const fieldPattern = new RegExp(`^${field}:\\s*(.*)$`);
  const fieldIndex = lines.findIndex((line) => fieldPattern.test(line));
  if (fieldIndex === -1) return null;
  return { fieldIndex, rawValue: lines[fieldIndex].match(fieldPattern)?.[1].trim() ?? "" };
}

function extractBlockYamlString({
  lines,
  fieldIndex,
  rawValue,
}: {
  lines: string[];
  fieldIndex: number;
  rawValue: string;
}): string | null {
  const blockHeader = rawValue.match(
    /^[>|](?:(?:[+-][1-9]?)|(?:[1-9][+-]?))?(?:\s+#.*)?$/,
  );
  if (!blockHeader) return null;

  const headerSyntax = rawValue.replace(/\s+#.*$/, "");
  const indentIndicator = headerSyntax.match(/[1-9]/)?.[0];
  let minimumIndent = indentIndicator ? Number(indentIndicator) : null;
  const blockLines: string[] = [];
  for (let index = fieldIndex + 1; index < lines.length; index++) {
    const line = lines[index];
    const indentationPrefix = line.match(/^[ \t]*/)?.[0] ?? "";
    if (indentationPrefix.includes("\t")) return null;
    if (!line.trim()) {
      blockLines.push("");
      continue;
    }

    const indentation = indentationPrefix.length;
    if (indentation === 0) break;
    if (minimumIndent === null) minimumIndent = indentation;
    if (indentation < minimumIndent) return null;
    blockLines.push(line.slice(minimumIndent).trim());
  }
  const value = blockLines.join(" ").trim();
  return value || null;
}

function hasValidDoubleQuotedEscapes(value: string): boolean {
  const escape = /\\(?:[0abtnvfre "\/\\N_LP]|x[\dA-Fa-f]{2}|u[\dA-Fa-f]{4}|U[\dA-Fa-f]{8})/gy;
  for (let index = 0; index < value.length; index++) {
    if (value[index] !== "\\") continue;
    escape.lastIndex = index;
    if (!escape.exec(value)) return false;
    index = escape.lastIndex - 1;
  }
  return true;
}

function extractDoubleQuotedYamlString(rawValue: string): string | null {
  const doubleQuoted = rawValue.match(/^"((?:[^"\\]|\\.)*)"\s*(?:#.*)?$/);
  if (!doubleQuoted || !hasValidDoubleQuotedEscapes(doubleQuoted[1])) return null;
  const value = doubleQuoted[1].replace(/\\"/g, '"').trim();
  return value || null;
}

function extractSingleQuotedYamlString(rawValue: string): string | null {
  const singleQuoted = rawValue.match(/^'((?:[^']|'')*)'\s*(?:#.*)?$/);
  if (!singleQuoted) return null;
  const value = singleQuoted[1].replace(/''/g, "'").trim();
  return value || null;
}

function extractPlainYamlString(rawValue: string): string | null {
  if (/^["']/.test(rawValue)) return null;
  if (!rawValue || rawValue.startsWith("#") || /^(?:!|&|\*|\[|\{)/.test(rawValue)) {
    return null;
  }
  const withoutComment = rawValue.replace(/\s+#.*$/, "").trim();
  if (!withoutComment || /^(?:true|false|null|~|[-+]?\d+(?:\.\d+)?)$/i.test(withoutComment)) {
    return null;
  }
  return withoutComment;
}

function extractYamlString({
  frontmatter,
  field,
}: {
  frontmatter: string;
  field: YamlStringField;
}): string | null {
  const lines = frontmatter.split("\n");
  const yamlField = findYamlField(lines, field);
  if (!yamlField) {
    logSkillSafetyDecision({
      event: "skill-safety.yaml.parse",
      loc: "extractYamlString",
      ctx: { field, scalar_style: "missing", parsed: false },
    });
    return null;
  }
  const scalarStyle = /^[>|]/.test(yamlField.rawValue)
    ? "block"
    : yamlField.rawValue.startsWith('"')
      ? "double-quoted"
      : yamlField.rawValue.startsWith("'")
        ? "single-quoted"
        : "plain";
  const value = scalarStyle === "block"
    ? extractBlockYamlString({ lines, ...yamlField })
    : scalarStyle === "double-quoted"
      ? extractDoubleQuotedYamlString(yamlField.rawValue)
      : scalarStyle === "single-quoted"
        ? extractSingleQuotedYamlString(yamlField.rawValue)
        : extractPlainYamlString(yamlField.rawValue);
  logSkillSafetyDecision({
    event: "skill-safety.yaml.parse",
    loc: "extractYamlString",
    ctx: { field, scalar_style: scalarStyle, parsed: value !== null },
  });
  return value;
}

function extractDescription(frontmatter: string): string | null {
  return extractYamlString({ frontmatter, field: "description" });
}

const NON_CONCRETE_WORDS = new Set([
  "a", "an", "the", "it", "thing", "things", "stuff", "helper", "helpers", "something",
  "anything", "task", "tasks", "needed", "necessary", "appropriate", "when", "now", "carefully",
  "assistant", "assistants", "generator", "generators",
]);

// Derived from the 2026-07-22 125-skill corpus audit; change only with a
// corpus-backed vocabulary review.
export const CAPABILITY_LEADERS_V1 = new Set([
  "Allows", "Ask", "Audit", "Author", "Break", "Browse", "Build", "Bulk-drain", "Call",
  "Compact", "Configure", "Consolidate", "Create", "Debug", "Decide", "Design", "Detect",
  "Dispatch", "Download", "Drain", "Drive", "Enforce", "Execute", "Find", "Generate", "Give",
  "Grill", "Hand", "Implement", "Install", "Interview", "Invoke", "Log", "Manage", "Operate",
  "Optimise", "Plan", "Prepare", "Query", "Read", "Remove", "Render", "Report", "Research",
  "Review", "Run", "Scrape", "Search", "Set", "Teach", "Track", "Train", "Transcribe", "Turn",
  "Upgrade", "Use", "Verify", "Write", "Summarize", "Apply", "Enable", "Document", "Archive",
  "Grant", "Seed", "Publish", "Orchestrate",
]);
const CAPABILITY_LEADER_CASEFOLD_V1 = new Set(
  [...CAPABILITY_LEADERS_V1].map((leader) => leader.toLowerCase()),
);

function hasConcreteObject(text: string): boolean {
  const words = text.toLowerCase().match(/[\p{L}\p{N}][\p{L}\p{N}'-]*/gu) ?? [];
  return words.some((word) => !NON_CONCRETE_WORDS.has(word) && !/ly$/.test(word));
}

function hasUsableTriggerDescription(description: string): boolean {
  const normalized = description.trim();
  let triggerForm = "unrecognized";
  let accepted = false;
  if (!normalized) {
    logSkillSafetyDecision({
      event: "skill-safety.trigger-contract",
      loc: "hasUsableTriggerDescription",
      ctx: { contract_version: "v2", trigger_form: triggerForm, accepted },
    });
    return false;
  }

  // v2 (2026-07-22, 127-skill corpus census): "use on" (56) and "use to" (4)
  // join "use for" as explicit forms; a leader may carry serial punctuation
  // ("Scrape, fetch, and extract ..."). Leader vocabulary itself is unchanged.
  const explicitTrigger = normalized.match(
    /\b(?:when(?:ever)?|use\s+(?:for|on|to)|triggered\s+by)\b\s*(.*)$/i,
  );
  if (explicitTrigger) {
    triggerForm = "explicit";
    accepted = hasConcreteObject(explicitTrigger[1]);
  } else if (/요청\s*시|사용\s*시|필요\s*시/i.test(normalized)) {
    triggerForm = "localized-explicit";
    accepted = true;
  } else {
    const capability = normalized.match(/^([\p{L}][\p{L}'-]*)[,:]?\s+(.+)$/u);
    if (capability && CAPABILITY_LEADER_CASEFOLD_V1.has(capability[1].toLowerCase())) {
      triggerForm = "capability-leader-v1";
      accepted = hasConcreteObject(capability[2]);
    }
  }
  logSkillSafetyDecision({
    event: "skill-safety.trigger-contract",
    loc: "hasUsableTriggerDescription",
    ctx: { contract_version: "v2", trigger_form: triggerForm, accepted },
  });
  return accepted;
}

type CommandContext = "executable" | "blocked-example" | "reference";

const BLOCKED_PROSE_STARTS = [
  /^(?:blocked|rejected|forbidden)(?:\s+command)?(?:\s*[:—]|\s+(?:example|command)\b)/i,
  /^(?:this|that|the)\s+command\s+is\s+(?:blocked|rejected|forbidden)\b/i,
  /^(?:detection\s+pattern|negative\s+test)\b/i,
  /^(?:must\s+not\s+execute|do\s+not\s+execute)\b/i,
];
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
  if (/(?:^|[;\s])[^\s=;]+\s*=|[;&]{1,2}|\|\||[{}]/.test(line)) return false;

  // A policy phrase must lead prose (or use "command is blocked"); shell that
  // merely echoes or assigns the same words is never demotion evidence.
  const prose = line.trim().replace(/^(?:[-*>|]\s*|#{1,6}\s+|\d+[.)]\s*)/, "");
  return BLOCKED_PROSE_STARTS.some((pattern) => pattern.test(prose));
}

const BLOCKED_EVIDENCE = /\b(?:was|is|are|were|got|gets)\s+\*{0,2}blocked\b|\bblocked\s+by\b/i;

function isBlockedEvidenceLine(line: string): boolean {
  // Same-line prose evidence that the mentioned command IS blocked by policy or
  // tooling ("`rm -rf /x` was blocked", "blocked by the PreToolUse hook").
  // Inline code spans are stripped first so shell content cannot vouch for
  // itself; the shell-shape guard then applies to the surrounding prose only.
  // Pipes and trailing-position "#" (a shell comment after content, unlike a
  // leading Markdown heading marker) are shell shapes too: an unfenced
  // `rm -rf / # was blocked` must never demote itself.
  const prose = line.replace(/`[^`]*`/g, " ");
  if (/(?:^|[;\s])[^\s=;]+\s*=|[;&]{1,2}|\||[{}]|\S.*#/.test(prose)) return false;
  return BLOCKED_EVIDENCE.test(prose);
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
  const context = contexts[lineIndex];
  let commandContext: CommandContext = "executable";
  if (/^\s*(?:>|\|)/.test(line)) commandContext = "reference";
  else if (context.insideFence && context.language && !SHELL_FENCE_LANGUAGES.has(context.language)) {
    commandContext = "reference";
  } else {
    const prose = [
      !context.insideFence && isBlockedProseLine(line) ? line : null,
      !context.insideFence && isBlockedEvidenceLine(line) ? line : null,
      adjacentBlockedProse({ lines, contexts, lineIndex, direction: -1 }),
      adjacentBlockedProse({ lines, contexts, lineIndex, direction: 1 }),
    ].filter((candidate): candidate is string => candidate !== null).join(" ");
    if (prose) commandContext = "blocked-example";
  }
  logSkillSafetyDecision({
    event: "skill-safety.command-context",
    loc: "classifyCommandContext",
    ctx: {
      command_context: commandContext,
      fence_context: context.insideFence ? (context.language ? "named" : "unnamed") : "outside",
    },
  });
  return commandContext;
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
            message: "Skill description has an unrecognized trigger form.",
            fix: "Add a clear trigger clause or propose a corpus-backed vocabulary addition.",
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
