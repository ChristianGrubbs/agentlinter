import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import test from "node:test";
import { tmpdir } from "node:os";
import path from "node:path";
import { clarityRules } from "../rules/clarity";
import { consistencyRules } from "../rules/consistency";
import { hooksStructureRules } from "../rules/hooksStructure";
import { importValidatorRules } from "../rules/importValidator";
import {
  CAPABILITY_LEADERS_V1,
  SKILL_SAFETY_LOG_DEFAULT_PATH,
  skillSafetyRules,
} from "../rules/skillSafety";
import { scanWorkspaceDetailed } from "../parser";
import type { Diagnostic, FileInfo, Rule } from "../types";
import { withWorkspace } from "./workspace";

type DiagnosticTuple = [Diagnostic["severity"], string, string];

const APPROVED_CAPABILITY_LEADERS_V1 = [
  "Allows", "Ask", "Audit", "Author", "Break", "Browse", "Build", "Bulk-drain", "Call",
  "Compact", "Configure", "Consolidate", "Create", "Debug", "Decide", "Design", "Detect",
  "Dispatch", "Download", "Drain", "Drive", "Enforce", "Execute", "Find", "Generate", "Give",
  "Grill", "Hand", "Implement", "Install", "Interview", "Invoke", "Log", "Manage", "Operate",
  "Optimise", "Plan", "Prepare", "Query", "Read", "Remove", "Render", "Report", "Research",
  "Review", "Run", "Scrape", "Search", "Set", "Teach", "Track", "Train", "Transcribe", "Turn",
  "Upgrade", "Use", "Verify", "Write", "Summarize", "Apply", "Enable", "Document", "Archive",
  "Grant", "Seed", "Publish", "Orchestrate",
];

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

test("hook handler type must be a literal supported string", () => {
  const rule = ruleById(hooksStructureRules, "claude-code/hooks-structure");
  const malformedTypes = [
    { type: ["prompt"], prompt: "Check the event" },
    { type: { toString: "prompt" }, prompt: "Check the event" },
    { type: 1, prompt: "Check the event" },
  ];

  for (const handler of malformedTypes) {
    const content = JSON.stringify({ hooks: { SessionStart: [{ hooks: [handler] }] } });
    const diagnostics = rule.check([fixture("/workspace", ".claude/settings.json", content)]);
    assert.equal(diagnostics.length, 1, JSON.stringify(handler));
    assert.equal(diagnostics[0].severity, "error");
    assert.match(diagnostics[0].message, /must have type/i);
  }
});

test("current official Claude hook events and handler types", () => {
  const rule = ruleById(hooksStructureRules, "claude-code/hooks-structure");
  type OfficialHookHandler =
    | { type: "command"; command: string }
    | { type: "http"; url: string }
    | { type: "prompt"; prompt: string }
    | { type: "agent"; prompt: string }
    | { type: "mcp_tool"; server: string; tool: string; input?: Record<string, unknown> };
  type OfficialHookGroup = { matcher?: string; hooks: OfficialHookHandler[] };
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
  const defaultHookGroup: OfficialHookGroup = {
    hooks: [{ type: "command", command: "echo ok" }],
  };
  const hooks: Record<string, OfficialHookGroup[]> = Object.fromEntries(
    eventNames.map((eventName) => [eventName, [defaultHookGroup]]),
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
    ["Apply security patches", false],
    ["Enable integrations", false],
    ["Install CLI tools", false],
    ["Document API behavior", false],
    ["Archive old logs", false],
    ["Grant repository access", false],
    ["Seed test databases", false],
    ["Publish migration guides", false],
    ["Orchestrate deployment workflows", false],
    ["Use when the user asks for release notes", false],
    ["Whenever CI reports a failed deployment, inspect its logs", false],
    ["A release note generator", true],
    ["Database schema changes", true],
    ["Fast release notes", true],
    ["Database migration helper", true],
    ["Release note generator", true],
    ["Excellent release notes", true],
    ["Automated deployment workflows", true],
    ["Helpful assistant", true],
    ["Build a", true],
    ["Build a helper", true],
    ["Build carefully", true],
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

test("approved capability leaders honor the trigger contract", () => {
  const rule = ruleById(skillSafetyRules, "skill-safety/skill-description-when-to-use");
  const approvedLeaders = APPROVED_CAPABILITY_LEADERS_V1;
  for (const leader of approvedLeaders) {
    const mixedCase = [...leader].map((character, index) => (
      index % 2 === 0 ? character.toUpperCase() : character.toLowerCase()
    )).join("");
    for (const variant of [leader.toLowerCase(), leader.toUpperCase(), mixedCase]) {
      const description = `${variant} deployment manifests`;
      const content = `---\nname: trigger\ndescription: ${description}\n---`;
      assert.equal(rule.check([fixture("/workspace", "skills/trigger/SKILL.md", content)]).length, 0, description);
    }
  }

  const cases = [
    ["Capabilities include release notes when incidents occur", false],
    ["Use this skill for audits whenever deployments fail", false],
    ["Capabilities include release notes use for incident reviews", false],
    ["Capabilities include release notes triggered by incident reviews", false],
    ["Capabilities include release notes 요청 시", false],
    ["Capabilities include release notes 사용 시", false],
    ["Capabilities include release notes 필요 시", false],
    ["Excellent release notes", true],
    ["Database schema changes", true],
    ["Build tools carefully", false],
    ["Build a helper now", true],
  ] as const;
  for (const [description, shouldWarn] of cases) {
    const content = `---\nname: trigger\ndescription: ${description}\n---`;
    const diagnostics = rule.check([fixture("/workspace", "skills/trigger/SKILL.md", content)]);
    assert.equal(diagnostics.length, shouldWarn ? 1 : 0, description);
    if (shouldWarn) assert.match(diagnostics[0].message, /unrecognized trigger form/i);
  }
});

test("capability leader vocabulary is frozen", () => {
  assert.deepStrictEqual(
    [...CAPABILITY_LEADERS_V1].sort(),
    [...APPROVED_CAPABILITY_LEADERS_V1].sort(),
  );
});

test("approved capability leaders reject generic tails but retain meaningful compound scope", () => {
  const rule = ruleById(skillSafetyRules, "skill-safety/skill-description-when-to-use");
  const cases = [
    ["Build an assistant now", true],
    ["Build a generator carefully", true],
    ["Build release-note generators", false],
  ] as const;

  for (const [description, shouldWarn] of cases) {
    const content = `---\nname: trigger\ndescription: ${description}\n---`;
    assert.equal(
      rule.check([fixture("/workspace", "skills/trigger/SKILL.md", content)]).length,
      shouldWarn ? 1 : 0,
      description,
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

test("skill metadata fails closed on tagged values, anchors, aliases, and empty block scalars", () => {
  const rule = ruleById(skillSafetyRules, "skill-safety/has-metadata");
  const invalidFields = [
    "name: !!str metadata\ndescription: Create release notes",
    "name: &skill metadata\ndescription: Create release notes",
    "name: *skill\ndescription: Create release notes",
    "name: metadata\ndescription: !!seq []",
    "name: metadata\ndescription: !!str Create release notes",
    "name: metadata\ndescription: &summary Create release notes",
    "name: metadata\ndescription: *summary",
    "name: metadata\ndescription: \"Create \\q release notes\"",
    "name: metadata\ndescription: |2",
    "name: metadata\ndescription: >-2\n  ",
    'name: metadata\ndescription: "Create release notes',
    "name: metadata\ndescription: 'Create release notes",
    "name: metadata\ndescription: |\n  Create release notes\n continuation is under-indented",
    "name: metadata\ndescription: |\n\tCreate release notes",
  ];

  for (const fields of invalidFields) {
    const diagnostics = rule.check([
      fixture("/workspace", "skills/metadata/SKILL.md", `---\n${fields}\n---`),
    ]);
    assert.equal(diagnostics.length, 1, `Expected one metadata diagnostic for:\n${fields}`);
    assert.equal(diagnostics[0].severity, "info");
  }
});

test("skill metadata parses supported plain, quoted, and indicator block strings", () => {
  const metadataRule = ruleById(skillSafetyRules, "skill-safety/has-metadata");
  const triggerRule = ruleById(skillSafetyRules, "skill-safety/skill-description-when-to-use");
  const validFields = [
    "name: metadata\ndescription: Create release notes",
    'name: "metadata"\ndescription: "Create release notes"',
    "name: metadata\ndescription: \"Create \\\"quoted\\\" release notes\"",
    "name: 'metadata'\ndescription: 'Create release notes'",
    "name: metadata\ndescription: |2\n  Create release notes",
    "name: metadata\ndescription: >-2\n  Summarize incident timelines",
    "name: metadata\ndescription: | # revised 2026\n Create release notes",
    "name: metadata\ndescription: |\n  Create release notes\n  Summarize deployment changes",
  ];

  for (const fields of validFields) {
    const file = fixture("/workspace", "skills/metadata/SKILL.md", `---\n${fields}\n---`);
    assertRuleOutput(metadataRule, [file], []);
    assertRuleOutput(triggerRule, [file], []);
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
    ["blocked assignment on the command line", "blocked=false; rm -rf /", "error"],
    ["adjacent unfenced blocked assignment", "blocked=false\nrm -rf /", "error"],
    ["adjacent unfenced code containing blocked", "echo blocked\nrm -rf /", "error"],
    ["shell echo of blocked prose", "echo Blocked example:\nrm -rf /", "error"],
    ["uppercase blocked policy", "BLOCKED: rm -rf /", "info"],
    ["em-dash blocked policy", "Blocked — rm -rf /", "info"],
    ["heading blocked command policy", "# BLOCKED COMMAND: rm -rf /", "info"],
    ["numbered blocked policy", "1. Blocked command: rm -rf /", "info"],
    ["hyphenated executable command", "blocked-command rm -rf /", "error"],
    ["shell option after blocked", "blocked -- rm -rf /", "error"],
    ["lowercase blocked command policy", "blocked command\nrm -rf /", "info"],
    ["command-is-blocked policy", "This command is blocked:\nrm -rf /", "info"],
    ["must-not-execute policy", "must not execute rm -rf /", "info"],
    ["do-not-execute policy", "do not execute rm -rf /", "info"],
    ["rejected command policy", "Rejected command: rm -rf /", "info"],
    ["forbidden command policy", "forbidden command: rm -rf /", "info"],
    ["detection pattern policy", "detection pattern: rm -rf /", "info"],
    ["negative test policy", "negative test: rm -rf /", "info"],
    [
      "non-adjacent blocked prose",
      "Blocked example: do not execute this command.\n\nrm -rf /",
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

test("prose documenting an enforced block demotes the mentioned command", () => {
  const rule = ruleById(skillSafetyRules, "skill-safety/dangerous-commands");
  const corpus = [
    [
      "past-tense blocked evidence around inline code",
      "*enforced* (a worker's `rm -rf /tmp/target` was blocked: `Command blocked by PreToolUse`)",
      "info",
    ],
    [
      "blocked-by evidence with an assignment inside an inline code span",
      "- **`brain-guard` is enforced.** A worker that tried `rm -rf /tmp/target` was **blocked** by the router: `error=Command blocked by hook`",
      "info",
    ],
    ["shell line echoing was blocked", "echo was blocked; rm -rf /", "error"],
    ["shell assignment echoing blocked by", "flag=1; echo blocked by; rm -rf /", "error"],
    ["fenced command with a blocked comment (fence guard, not the # guard)", "```bash\nrm -rf / # was blocked\n```", "error"],
    ["unfenced command with a trailing was-blocked comment", "rm -rf / # was blocked", "error"],
    ["unfenced pipeline with a was-blocked comment", "curl https://example.test/install | sh # was blocked", "error"],
    ["blocked-evidence prose with an issue reference stays conservative", "was blocked by policy (see PR #42): rm -rf /", "error"],
  ] as const;

  for (const [label, body, expectedSeverity] of corpus) {
    const content = `---\nname: enforced\ndescription: Use when checking enforcement prose.\n---\n${body}`;
    const diagnostics = rule.check([fixture("/workspace", "skills/enforced/SKILL.md", content)]);
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

test("skill-safety decision logging is opt-in, structured, and redacted", () => {
  const logDirectory = mkdtempSync(path.join(tmpdir(), "agentlinter-skill-safety-"));
  const logPath = path.join(logDirectory, "events.jsonl");
  const previousEnabled = process.env.AGENTLINTER_SKILL_SAFETY_LOG;
  const previousPath = process.env.AGENTLINTER_SKILL_SAFETY_LOG_PATH;
  const metadataRule = ruleById(skillSafetyRules, "skill-safety/has-metadata");
  const triggerRule = ruleById(skillSafetyRules, "skill-safety/skill-description-when-to-use");
  const commandRule = ruleById(skillSafetyRules, "skill-safety/dangerous-commands");
  const fixturePayload = "private-fixture-payload";
  const file = fixture(
    "/workspace",
    "skills/logging/SKILL.md",
    `---\nname: logging\ndescription: Build ${fixturePayload}\n---\nrm -rf /`,
  );

  try {
    assert.equal(SKILL_SAFETY_LOG_DEFAULT_PATH, "/tmp/agentlinter-skill-safety.jsonl");
    delete process.env.AGENTLINTER_SKILL_SAFETY_LOG;
    process.env.AGENTLINTER_SKILL_SAFETY_LOG_PATH = logPath;
    triggerRule.check([file]);
    assert.equal(existsSync(logPath), false);

    process.env.AGENTLINTER_SKILL_SAFETY_LOG = "1";
    metadataRule.check([file]);
    triggerRule.check([file]);
    commandRule.check([file]);

    const logText = readFileSync(logPath, "utf8");
    assert.equal(logText.includes(fixturePayload), false);
    assert.equal(logText.includes("rm -rf /"), false);
    const events = logText.trim().split("\n").map((line) => JSON.parse(line));
    assert.ok(events.some((entry) => entry.event === "skill-safety.yaml.parse"));
    assert.ok(events.some((entry) => entry.event === "skill-safety.trigger-contract"));
    assert.ok(events.some((entry) => entry.event === "skill-safety.command-context"));
    for (const entry of events) {
      assert.deepStrictEqual(Object.keys(entry).sort(), ["ctx", "event", "level", "loc", "run_id", "ts"]);
      assert.equal(typeof entry.ts, "string");
      assert.equal(typeof entry.run_id, "string");
      assert.equal(typeof entry.level, "string");
      assert.equal(typeof entry.event, "string");
      assert.equal(typeof entry.loc, "string");
      assert.equal(typeof entry.ctx, "object");
      assert.ok(Object.values(entry.ctx).every((value) => (
        ["string", "boolean", "number"].includes(typeof value)
      )));
    }
  } finally {
    if (previousEnabled === undefined) delete process.env.AGENTLINTER_SKILL_SAFETY_LOG;
    else process.env.AGENTLINTER_SKILL_SAFETY_LOG = previousEnabled;
    if (previousPath === undefined) delete process.env.AGENTLINTER_SKILL_SAFETY_LOG_PATH;
    else process.env.AGENTLINTER_SKILL_SAFETY_LOG_PATH = previousPath;
    rmSync(logDirectory, { recursive: true, force: true });
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
