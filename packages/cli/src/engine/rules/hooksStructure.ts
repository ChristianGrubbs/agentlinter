/* ─── Rule: hooks-structure ─── */

import { Rule, Diagnostic } from "../types";

const HOOKS_DOCS_URL = "https://docs.anthropic.com/en/docs/claude-code/hooks";

const VALID_EVENTS = [
  "PreToolUse",
  "PostToolUse",
  "Stop",
  "SubagentStop",
  "Notification",
];

type HookHandler = {
  type: "command" | "prompt" | "agent" | "http";
  command?: string;
  prompt?: string;
  url?: string;
};

type HookGroup = {
  matcher?: string;
  hooks: HookHandler[];
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function requiredHandlerField(type: HookHandler["type"]): keyof HookHandler {
  if (type === "command") return "command";
  if (type === "http") return "url";
  return "prompt";
}

function validateHookGroup(group: unknown): string | null {
  if (!isRecord(group)) return "Hook matcher group must be an object";

  const candidate = group as Partial<HookGroup>;
  if (!Array.isArray(candidate.hooks) || candidate.hooks.length === 0) {
    return 'Hook matcher group must contain a non-empty "hooks" array';
  }

  for (const handler of candidate.hooks) {
    if (!isRecord(handler)) return "Nested hook handler must be an object";
    if (!["command", "prompt", "agent", "http"].includes(String(handler.type))) {
      return 'Nested hook handler must have type "command", "prompt", "agent", or "http"';
    }

    const type = handler.type as HookHandler["type"];
    const requiredField = requiredHandlerField(type);
    if (typeof handler[requiredField] !== "string" || !handler[requiredField].trim()) {
      return `Nested ${type} hook handler is missing required "${requiredField}" field`;
    }
  }

  return null;
}

export const hooksStructureRules: Rule[] = [
  {
    id: "claude-code/hooks-structure",
    category: "runtime",
    severity: "warning",
    description: "Validate .claude/hooks configuration structure",
    check(files) {
      const diagnostics: Diagnostic[] = [];

      for (const file of files) {
        const isHooksFile =
          file.name.includes("hooks") ||
          file.name === ".claude/settings.json" ||
          file.name.endsWith("settings.json");

        if (!isHooksFile) continue;

        // Claude settings use event -> matcher group[] -> handler[] nesting.
        if (file.name.endsWith(".json")) {
          try {
            const parsed = JSON.parse(file.content);
            const hooks = parsed?.hooks;
            if (hooks !== undefined && !isRecord(hooks)) {
              diagnostics.push({
                severity: "error",
                category: "runtime",
                rule: "claude-code/hooks-structure",
                file: file.name,
                message: 'The "hooks" setting must be an object keyed by hook event',
                fix: 'Use "hooks": { "PreToolUse": [{ "matcher": "...", "hooks": [...] }] }',
              });
            } else if (isRecord(hooks)) {
              for (const [eventName, entries] of Object.entries(hooks)) {
                if (!VALID_EVENTS.includes(eventName)) {
                  diagnostics.push({
                    severity: "info",
                    category: "runtime",
                    rule: "claude-code/hooks-structure",
                    file: file.name,
                    message: `Unknown hook event "${eventName}". Check the current official event list: ${HOOKS_DOCS_URL}`,
                    fix: `Verify the event name against ${HOOKS_DOCS_URL}`,
                  });
                }

                if (!Array.isArray(entries) || entries.length === 0) {
                  diagnostics.push({
                    severity: "error",
                    category: "runtime",
                    rule: "claude-code/hooks-structure",
                    file: file.name,
                    message: `Hook event "${eventName}" must contain a non-empty array of matcher groups`,
                    fix: 'Add a matcher group containing a non-empty nested "hooks" array',
                  });
                  continue;
                }

                for (const group of entries) {
                  const issue = validateHookGroup(group);
                  if (!issue) continue;
                  diagnostics.push({
                    severity: "error",
                    category: "runtime",
                    rule: "claude-code/hooks-structure",
                    file: file.name,
                    message: `${issue} for hook event "${eventName}"`,
                    fix: "Use a matcher group with valid nested command, prompt, agent, or http handlers",
                  });
                }
              }
            }
          } catch {
            // Not valid JSON or no hooks — skip
          }
        }
      }

      return diagnostics;
    },
  },
];
