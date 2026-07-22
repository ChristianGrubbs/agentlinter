import assert from "node:assert/strict";
import path from "node:path";
import test from "node:test";
import * as parser from "../parser";
import type { ScanResult } from "../types";
import { withWorkspace } from "./workspace";

type DetailedScanner = (workspacePath: string) => ScanResult;

function scanWorkspaceDetailed(workspacePath: string): ScanResult {
  const scanner = (parser as typeof parser & { scanWorkspaceDetailed?: DetailedScanner }).scanWorkspaceDetailed;
  if (typeof scanner !== "function") {
    assert.fail("scanWorkspaceDetailed should be exported by parser");
  }
  return scanner(workspacePath);
}

function normalizeWorkspacePath(value: string, workspaceRoot: string): string {
  if (value === workspaceRoot) return "<workspace>";
  const relative = path.relative(workspaceRoot, value);
  if (relative && !relative.startsWith("..") && !path.isAbsolute(relative)) {
    return `<workspace>/${relative.split(path.sep).join("/")}`;
  }
  return value;
}

function normalizeWorkspaceValue(value: unknown, workspaceRoot: string): unknown {
  if (typeof value === "string") return normalizeWorkspacePath(value, workspaceRoot);
  if (Array.isArray(value)) return value.map((entry) => normalizeWorkspaceValue(entry, workspaceRoot));
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value).map(([key, entry]) => [key, normalizeWorkspaceValue(entry, workspaceRoot)]),
    );
  }
  return value;
}

function assertScan(workspaceRoot: string, expected: unknown) {
  const scan = scanWorkspaceDetailed(workspaceRoot);
  assert.deepStrictEqual(normalizeWorkspaceValue(scan, workspaceRoot), expected);
}

test("deduplicates an in-workspace CLAUDE.md symlink and preserves alias provenance", () => {
  withWorkspace([
    { path: "AGENTS.md", content: "# Agent" },
    { path: "CLAUDE.md", symlinkTo: "AGENTS.md" },
  ], (workspaceRoot) => {
    assertScan(workspaceRoot, {
      files: [{
        name: "AGENTS.md",
        path: "<workspace>/AGENTS.md",
        workspaceRoot: "<workspace>",
        canonicalPath: "<workspace>/AGENTS.md",
        content: "# Agent",
        lines: ["# Agent"],
        sections: [{ heading: "Agent", level: 1, startLine: 0, endLine: 0, content: "# Agent" }],
        context: "claude-code",
      }],
      summary: {
        policyVersion: "2026-07-22",
        discovered: 2,
        analyzed: 1,
        aliases: [{ logicalPath: "CLAUDE.md", canonicalPath: "AGENTS.md" }],
        ignored: [],
      },
    });
  });
});

test("excludes .claude/worktrees recursively and reports the reason", () => {
  withWorkspace([
    { path: "AGENTS.md", content: "# Agent" },
    { path: ".claude/worktrees/run/CLAUDE.md", content: "# Generated" },
  ], (workspaceRoot) => {
    assertScan(workspaceRoot, {
      files: [{
        name: "AGENTS.md",
        path: "<workspace>/AGENTS.md",
        workspaceRoot: "<workspace>",
        canonicalPath: "<workspace>/AGENTS.md",
        content: "# Agent",
        lines: ["# Agent"],
        sections: [{ heading: "Agent", level: 1, startLine: 0, endLine: 0, content: "# Agent" }],
        context: "openclaw-runtime",
      }],
      summary: {
        policyVersion: "2026-07-22",
        discovered: 2,
        analyzed: 1,
        aliases: [],
        ignored: [{ logicalPath: ".claude/worktrees", reason: "generated-worktree" }],
      },
    });
  });
});

test("ignores a symlink whose real target escapes the Workspace", () => {
  withWorkspace([
    { path: "AGENTS.md", content: "# Agent" },
    { path: "CLAUDE.md", symlinkTo: "/dev/null" },
  ], (workspaceRoot) => {
    assertScan(workspaceRoot, {
      files: [{
        name: "AGENTS.md",
        path: "<workspace>/AGENTS.md",
        workspaceRoot: "<workspace>",
        canonicalPath: "<workspace>/AGENTS.md",
        content: "# Agent",
        lines: ["# Agent"],
        sections: [{ heading: "Agent", level: 1, startLine: 0, endLine: 0, content: "# Agent" }],
        context: "claude-code",
      }],
      summary: {
        policyVersion: "2026-07-22",
        discovered: 2,
        analyzed: 1,
        aliases: [],
        ignored: [{ logicalPath: "CLAUDE.md", reason: "outside-workspace-symlink" }],
      },
    });
  });
});

test("returns files in stable logical-path order", () => {
  withWorkspace([
    { path: "AGENTS.md", content: "# Agent" },
    { path: ".claude/rules/zeta.md", content: "# Zeta" },
    { path: ".claude/rules/alpha.md", content: "# Alpha" },
  ], (workspaceRoot) => {
    assertScan(workspaceRoot, {
      files: [
        {
          name: ".claude/rules/alpha.md",
          path: "<workspace>/.claude/rules/alpha.md",
          workspaceRoot: "<workspace>",
          canonicalPath: "<workspace>/.claude/rules/alpha.md",
          content: "# Alpha",
          lines: ["# Alpha"],
          sections: [{ heading: "Alpha", level: 1, startLine: 0, endLine: 0, content: "# Alpha" }],
          context: "openclaw-runtime",
        },
        {
          name: ".claude/rules/zeta.md",
          path: "<workspace>/.claude/rules/zeta.md",
          workspaceRoot: "<workspace>",
          canonicalPath: "<workspace>/.claude/rules/zeta.md",
          content: "# Zeta",
          lines: ["# Zeta"],
          sections: [{ heading: "Zeta", level: 1, startLine: 0, endLine: 0, content: "# Zeta" }],
          context: "openclaw-runtime",
        },
        {
          name: "AGENTS.md",
          path: "<workspace>/AGENTS.md",
          workspaceRoot: "<workspace>",
          canonicalPath: "<workspace>/AGENTS.md",
          content: "# Agent",
          lines: ["# Agent"],
          sections: [{ heading: "Agent", level: 1, startLine: 0, endLine: 0, content: "# Agent" }],
          context: "openclaw-runtime",
        },
      ],
      summary: {
        policyVersion: "2026-07-22",
        discovered: 3,
        analyzed: 3,
        aliases: [],
        ignored: [],
      },
    });
  });
});
