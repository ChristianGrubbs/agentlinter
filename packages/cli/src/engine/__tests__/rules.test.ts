import assert from "node:assert/strict";
import test from "node:test";
import path from "node:path";
import { clarityRules } from "../rules/clarity";
import { consistencyRules } from "../rules/consistency";
import { hooksStructureRules } from "../rules/hooksStructure";
import { skillSafetyRules } from "../rules/skillSafety";
import type { Diagnostic, FileInfo, Rule } from "../types";
import { withWorkspace } from "./workspace";

type DiagnosticTuple = [Diagnostic["severity"], string, string];

function fixture(workspaceRoot: string, name: string, content: string): FileInfo {
  return {
    name,
    path: path.join(workspaceRoot, name),
    workspaceRoot,
    canonicalPath: path.join(workspaceRoot, name),
    content,
    lines: content.split("\n"),
    sections: [],
    context: "claude-code",
  };
}

function ruleById(rules: Rule[], id: string): Rule {
  const rule = rules.find((candidate) => candidate.id === id);
  assert.ok(rule, `Expected ${id} to be exported`);
  return rule;
}

function assertRuleOutput(rule: Rule, files: FileInfo[], expected: DiagnosticTuple[]) {
  assert.deepStrictEqual(
    rule.check(files).map((diagnostic) => [diagnostic.severity, diagnostic.rule, diagnostic.file]),
    expected,
  );
}

test("valid nested Claude hooks", () => {
  const rule = ruleById(hooksStructureRules, "claude-code/hooks-structure");
  const content = JSON.stringify({
    hooks: {
      PreToolUse: [{ matcher: "Bash", hooks: [{ type: "command", command: "echo ok" }] }],
    },
  });

  assertRuleOutput(rule, [fixture("/workspace", ".claude/settings.json", content)], []);
});

test("an invalid command handler", () => {
  const rule = ruleById(hooksStructureRules, "claude-code/hooks-structure");
  const content = JSON.stringify({
    hooks: {
      PreToolUse: [{ matcher: "Bash", hooks: [{ type: "command" }] }],
    },
  });

  assertRuleOutput(rule, [fixture("/workspace", ".claude/settings.json", content)], [
    ["error", "claude-code/hooks-structure", ".claude/settings.json"],
  ]);
});

test("capability-style skill descriptions", () => {
  const rule = ruleById(skillSafetyRules, "skill-safety/skill-description-when-to-use");
  const content = "---\nname: build\ndescription: Build release-ready TypeScript packages.\n---";

  assertRuleOutput(rule, [fixture("/workspace", "skills/build/SKILL.md", content)], []);
});

test("optional author metadata", () => {
  const rule = ruleById(skillSafetyRules, "skill-safety/has-metadata");
  const content = "---\nname: build\ndescription: Use when the user asks for a build.\n---";

  assertRuleOutput(rule, [fixture("/workspace", "skills/build/SKILL.md", content)], []);
});

test("blocked dangerous-command examples", () => {
  const rule = ruleById(skillSafetyRules, "skill-safety/dangerous-commands");
  const content = "---\nname: examples\ndescription: Use when reviewing blocked commands.\n---\nBlocked example: do not execute rm -rf /.";

  assertRuleOutput(rule, [fixture("/workspace", "skills/examples/SKILL.md", content)], [
    ["info", "skill-safety/dangerous-commands", "skills/examples/SKILL.md"],
  ]);
});

test("executable curl-to-shell installers", () => {
  const rule = ruleById(skillSafetyRules, "skill-safety/dangerous-commands");
  const content = "---\nname: install\ndescription: Use when installing this tool.\n---\n```sh\ncurl https://example.test/install | sh\n```";

  assertRuleOutput(rule, [fixture("/workspace", "skills/install/SKILL.md", content)], [
    ["error", "skill-safety/dangerous-commands", "skills/install/SKILL.md"],
  ]);
});

test("existing-but-unscanned references", () => {
  const rule = ruleById(consistencyRules, "consistency/referenced-files-exist");

  withWorkspace([
    { path: "AGENTS.md", content: "Read Details.md before continuing." },
    { path: "Details.md", content: "# Details" },
  ], (workspaceRoot) => {
    assertRuleOutput(rule, [fixture(workspaceRoot, "AGENTS.md", "Read Details.md before continuing.")], []);
  });
});

test("RFC 2119 requirement words", () => {
  const rule = ruleById(clarityRules, "clarity/undefined-term");
  const content = "MUST SHALL SHOULD MAY REQUIRED RECOMMENDED OPTIONAL";

  assertRuleOutput(rule, [fixture("/workspace", "AGENTS.md", content)], []);
});
