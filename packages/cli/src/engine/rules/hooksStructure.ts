/* ─── Rule: hooks-structure ─── */

import { Rule, Diagnostic } from "../types";

const HOOKS_DOCS_URL = "https://code.claude.com/docs/en/hooks";

const VALID_EVENTS = [
  "SessionStart",
  "Setup",
  "UserPromptSubmit",
  "UserPromptExpansion",
  "PreToolUse",
  "PermissionRequest",
  "PermissionDenied",
  "PostToolUse",
  "PostToolUseFailure",
  "PostToolBatch",
  "Notification",
  "MessageDisplay",
  "SubagentStart",
  "SubagentStop",
  "TaskCreated",
  "TaskCompleted",
  "Stop",
  "StopFailure",
  "TeammateIdle",
  "InstructionsLoaded",
  "ConfigChange",
  "CwdChanged",
  "FileChanged",
  "WorktreeCreate",
  "WorktreeRemove",
  "PreCompact",
  "PostCompact",
  "Elicitation",
  "ElicitationResult",
  "SessionEnd",
];

type HookHandler = {
  type: "command" | "prompt" | "agent" | "http" | "mcp_tool";
  command?: string;
  prompt?: string;
  url?: string;
  server?: string;
  tool?: string;
  input?: Record<string, unknown>;
};

type HookGroup = {
  matcher?: string;
  hooks: HookHandler[];
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function requiredHandlerField(type: Exclude<HookHandler["type"], "mcp_tool">): keyof HookHandler {
  if (type === "command") return "command";
  if (type === "http") return "url";
  return "prompt";
}

function validateHookGroup(group: unknown): string | null {
  if (!isRecord(group)) return "Hook matcher group must be an object";

  const candidate = group as Partial<HookGroup>;
  if (candidate.matcher !== undefined && typeof candidate.matcher !== "string") {
    return 'Hook matcher group "matcher" must be a string when present';
  }
  if (!Array.isArray(candidate.hooks) || candidate.hooks.length === 0) {
    return 'Hook matcher group must contain a non-empty "hooks" array';
  }

  for (const handler of candidate.hooks) {
    if (!isRecord(handler)) return "Nested hook handler must be an object";
    if (!["command", "prompt", "agent", "http", "mcp_tool"].includes(String(handler.type))) {
      return 'Nested hook handler must have type "command", "prompt", "agent", "http", or "mcp_tool"';
    }

    const type = handler.type as HookHandler["type"];
    if (type === "mcp_tool") {
      for (const field of ["server", "tool"] as const) {
        if (typeof handler[field] !== "string" || !handler[field].trim()) {
          return `Nested mcp_tool hook handler is missing required "${field}" field`;
        }
      }
      if (handler.input !== undefined && !isRecord(handler.input)) {
        return 'Nested mcp_tool hook handler "input" must be an object when present';
      }
      continue;
    }

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
                    fix: "Use a matcher group with valid nested command, prompt, agent, http, or mcp_tool handlers",
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
