import assert from "node:assert/strict";
import test from "node:test";
import path from "node:path";
import { clarityRules } from "../rules/clarity";
import { consistencyRules } from "../rules/consistency";
import { hooksStructureRules } from "../rules/hooksStructure";
import { importValidatorRules } from "../rules/importValidator";
import { skillSafetyRules } from "../rules/skillSafety";
import { scanWorkspaceDetailed } from "../parser";
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

test("current official Claude hook events and handler types", () => {
  const rule = ruleById(hooksStructureRules, "claude-code/hooks-structure");
  const eventNames = [
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
  const hooks = Object.fromEntries(
    eventNames.map((eventName) => [
      eventName,
      [{ hooks: [{ type: "command", command: "echo ok" }] }],
    ]),
  );
  hooks.SessionStart = [{
    matcher: "",
    hooks: [
      { type: "command", command: "echo ok" },
      { type: "http", url: "https://example.test/hooks" },
      { type: "prompt", prompt: "Check the event" },
      { type: "agent", prompt: "Investigate the event" },
      { type: "mcp_tool", server: "audit", tool: "record", input: { level: "info" } },
    ],
  }];

  assertRuleOutput(
    rule,
    [fixture("/workspace", ".claude/settings.json", JSON.stringify({ hooks }))],
    [],
  );
});

test("hook matcher must be a string when present", () => {
  const rule = ruleById(hooksStructureRules, "claude-code/hooks-structure");
  const content = JSON.stringify({
    hooks: {
      PreToolUse: [{ matcher: ["Bash"], hooks: [{ type: "command", command: "echo ok" }] }],
    },
  });

  const diagnostics = rule.check([fixture("/workspace", ".claude/settings.json", content)]);
  assert.equal(diagnostics.length, 1);
  assert.equal(diagnostics[0].severity, "error");
  assert.match(diagnostics[0].message, /matcher.*string/i);
});

test("mcp_tool hooks require server and tool strings plus object input", () => {
  const rule = ruleById(hooksStructureRules, "claude-code/hooks-structure");
  const invalidHandlers = [
    [{ type: "mcp_tool", tool: "record" }, /server/i],
    [{ type: "mcp_tool", server: "audit" }, /tool/i],
    [{ type: "mcp_tool", server: "audit", tool: "record", input: [] }, /input.*object/i],
  ] as const;

  for (const [handler, expectedMessage] of invalidHandlers) {
    const content = JSON.stringify({ hooks: { SessionStart: [{ hooks: [handler] }] } });
    const diagnostics = rule.check([fixture("/workspace", ".claude/settings.json", content)]);
    assert.equal(diagnostics.length, 1);
    assert.equal(diagnostics[0].severity, "error");
    assert.match(diagnostics[0].message, expectedMessage);
  }
});

test("unknown future hook events remain advisory and link current docs", () => {
  const rule = ruleById(hooksStructureRules, "claude-code/hooks-structure");
  const content = JSON.stringify({
    hooks: {
      FutureLifecycleEvent: [{ hooks: [{ type: "command", command: "echo ok" }] }],
    },
  });

  const diagnostics = rule.check([fixture("/workspace", ".claude/settings.json", content)]);
  assert.equal(diagnostics.length, 1);
  assert.equal(diagnostics[0].severity, "info");
  assert.match(diagnostics[0].message, /https:\/\/code\.claude\.com\/docs\/en\/hooks/);
});

test("capability-style skill descriptions", () => {
  const rule = ruleById(skillSafetyRules, "skill-safety/skill-description-when-to-use");
  const content = "---\nname: build\ndescription: Build release-ready TypeScript packages.\n---";

  assertRuleOutput(rule, [fixture("/workspace", "skills/build/SKILL.md", content)], []);
});

test("skill trigger descriptions require a concrete capability or explicit trigger", () => {
  const rule = ruleById(skillSafetyRules, "skill-safety/skill-description-when-to-use");
  const corpus = [
    ["Create release notes", false],
    ["Summarize incident timelines", false],
    ["Use when the user asks for release notes", false],
    ["Whenever CI reports a failed deployment, inspect its logs", false],
    ["A release note generator", true],
    ["Helpful assistant", true],
    ["Build a", true],
    ["Build a helper", true],
    ["Manage things", true],
    ["Use when needed", true],
  ] as const;

  for (const [description, shouldWarn] of corpus) {
    const content = `---\nname: trigger\ndescription: ${description}\n---`;
    const diagnostics = rule.check([fixture("/workspace", "skills/trigger/SKILL.md", content)]);
    assert.equal(
      diagnostics.length,
      shouldWarn ? 1 : 0,
      `Unexpected diagnostics for description: ${JSON.stringify(description)}`,
    );
  }
});

test("optional author metadata", () => {
  const rule = ruleById(skillSafetyRules, "skill-safety/has-metadata");
  const content = "---\nname: build\ndescription: Use when the user asks for a build.\n---";

  assertRuleOutput(rule, [fixture("/workspace", "skills/build/SKILL.md", content)], []);
});

test("skill metadata requires non-empty scalar strings", () => {
  const rule = ruleById(skillSafetyRules, "skill-safety/has-metadata");
  const invalidFields = [
    'name: ""\ndescription: Create release notes',
    "name: # supplied later\ndescription: Create release notes",
    "name: []\ndescription: Create release notes",
    'name: metadata\ndescription: ""',
    "name: metadata\ndescription: # supplied later",
    "name: metadata\ndescription: []",
  ];

  for (const fields of invalidFields) {
    const diagnostics = rule.check([
      fixture("/workspace", "skills/metadata/SKILL.md", `---\n${fields}\n---`),
    ]);
    assert.equal(diagnostics.length, 1, `Expected one metadata diagnostic for:\n${fields}`);
    assert.equal(diagnostics[0].severity, "info");
  }
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

test("dangerous-command context crosses delimiters without reading adjacent code as prose", () => {
  const rule = ruleById(skillSafetyRules, "skill-safety/dangerous-commands");
  const corpus = [
    [
      "blocked prose before an opening fence",
      "Blocked example, do not execute:\n```bash\nrm -rf /\n```",
      "info",
    ],
    [
      "the word blocked on an adjacent code line",
      "```bash\necho blocked\nrm -rf /\n```",
      "error",
    ],
    ["a tilde text fence", "~~~text\nrm -rf /\n~~~", "info"],
    ["a bash attribute fence", "```{.bash}\nrm -rf /\n```", "error"],
  ] as const;

  for (const [label, body, expectedSeverity] of corpus) {
    const content = `---\nname: fence\ndescription: Use when checking fence context.\n---\n${body}`;
    const diagnostics = rule.check([fixture("/workspace", "skills/fence/SKILL.md", content)]);
    assert.equal(diagnostics.length, 1, label);
    assert.equal(diagnostics[0].severity, expectedSeverity, label);
  }
});

test("supported shell fence identifiers preserve executable severity", () => {
  const rule = ruleById(skillSafetyRules, "skill-safety/dangerous-commands");

  for (const language of ["sh", "bash", "zsh", "fish", "pwsh", "powershell"]) {
    const content = `---\nname: shell\ndescription: Use when checking shell commands.\n---\n\`\`\`${language}\nrm -rf /\n\`\`\``;
    const diagnostics = rule.check([fixture("/workspace", "skills/shell/SKILL.md", content)]);
    assert.equal(diagnostics.length, 1, language);
    assert.equal(diagnostics[0].severity, "error", language);
  }
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

test("nested, absolute, and home references reach on-disk resolution", () => {
  const rule = ruleById(consistencyRules, "consistency/referenced-files-exist");

  withWorkspace([
    { path: "AGENTS.md", content: "# Agent" },
    { path: "docs/Details.md", content: "# Details" },
    { path: "absolute/Guide.md", content: "# Guide" },
    { path: "Manual.md", content: "# Manual" },
  ], (workspaceRoot) => {
    const previousHome = process.env.HOME;
    process.env.HOME = workspaceRoot;
    try {
      const content = [
        "Read docs/Details.md before continuing.",
        `Check ${path.join(workspaceRoot, "absolute/Guide.md")} before continuing.`,
        "Refer to ~/Manual.md before continuing.",
        "Read docs/README.md for the generic pattern.",
        "Read docs/Missing.md before continuing.",
        `Check ${path.join(workspaceRoot, "absolute/Missing.md")} before continuing.`,
        "Refer to ~/Missing.md before continuing.",
      ].join("\n");
      const diagnostics = rule.check([fixture(workspaceRoot, "AGENTS.md", content)]);

      assert.equal(diagnostics.length, 3);
      assert.ok(diagnostics.some((diagnostic) => diagnostic.message.includes('"docs/Missing.md"')));
      assert.ok(diagnostics.some((diagnostic) => diagnostic.message.includes('"~/Missing.md"')));
      assert.ok(diagnostics.some((diagnostic) => diagnostic.message.includes('"' + path.join(workspaceRoot, "absolute/Missing.md") + '"')));
    } finally {
      if (previousHome === undefined) delete process.env.HOME;
      else process.env.HOME = previousHome;
    }
  });
});

test("ordinary dotted prose is not treated as a file reference", () => {
  const rule = ruleById(consistencyRules, "consistency/referenced-files-exist");
  const content = [
    "See example.com for documentation.",
    "Read Node.js guidance before continuing.",
    "Check process.env when configuring the runtime.",
    "Refer to Page.captureScreenshot in the browser protocol.",
  ].join("\n");

  assertRuleOutput(rule, [fixture("/workspace", "AGENTS.md", content)], []);
});

test("circular imports normalize directory-relative and alias paths to analyzed files", () => {
  const rule = ruleById(importValidatorRules, "structure/circular-import");

  withWorkspace([
    { path: "CLAUDE.md", content: "@.claude/rules/Alias.md" },
    { path: ".claude/rules/B.md", content: "@../../CLAUDE.md" },
    { path: ".claude/rules/Alias.md", symlinkTo: "B.md" },
  ], (workspaceRoot) => {
    const diagnostics = rule.check(scanWorkspaceDetailed(workspaceRoot).files);

    assert.equal(diagnostics.length, 1);
    assert.equal(diagnostics[0].severity, "error");
    assert.equal(diagnostics[0].rule, "structure/circular-import");
    assert.match(diagnostics[0].message, /\.claude\/rules\/B\.md/);
    assert.match(diagnostics[0].message, /CLAUDE\.md/);
  });
});

test("RFC 2119 requirement words", () => {
  const rule = ruleById(clarityRules, "clarity/undefined-term");
  const content = "MUST SHALL SHOULD MAY REQUIRED RECOMMENDED OPTIONAL";

  assertRuleOutput(rule, [fixture("/workspace", "AGENTS.md", content)], []);
});
