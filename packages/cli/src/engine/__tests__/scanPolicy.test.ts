import assert from "node:assert/strict";
import test from "node:test";
import * as parser from "../parser";
import { withWorkspace } from "./workspace";

type DetailedScanner = (workspacePath: string) => {
  files: Array<{ name: string }>;
  summary: {
    aliases: Array<{ logicalPath: string; canonicalPath: string }>;
    ignored: Array<{ logicalPath: string; reason: string }>;
  };
};

function scanWorkspaceDetailed(workspacePath: string) {
  const scanner = (parser as typeof parser & { scanWorkspaceDetailed?: DetailedScanner }).scanWorkspaceDetailed;
  if (typeof scanner !== "function") {
    assert.fail("scanWorkspaceDetailed should be exported by parser");
  }
  return scanner(workspacePath);
}

test("deduplicates an in-workspace CLAUDE.md symlink and preserves alias provenance", () => {
  withWorkspace([
    { path: "AGENTS.md", content: "# Agent" },
    { path: "CLAUDE.md", symlinkTo: "AGENTS.md" },
  ], (workspaceRoot) => {
    const scan = scanWorkspaceDetailed(workspaceRoot);

    assert.deepStrictEqual(scan.files.map((file) => file.name), ["AGENTS.md"]);
    assert.deepStrictEqual(scan.summary.aliases, [
      { logicalPath: "CLAUDE.md", canonicalPath: "AGENTS.md" },
    ]);
    assert.deepStrictEqual(scan.summary.ignored, []);
  });
});

test("excludes .claude/worktrees recursively and reports the reason", () => {
  withWorkspace([
    { path: "AGENTS.md", content: "# Agent" },
    { path: ".claude/worktrees/run/CLAUDE.md", content: "# Generated" },
  ], (workspaceRoot) => {
    const scan = scanWorkspaceDetailed(workspaceRoot);

    assert.deepStrictEqual(scan.files.map((file) => file.name), ["AGENTS.md"]);
    assert.deepStrictEqual(scan.summary.aliases, []);
    assert.deepStrictEqual(scan.summary.ignored, [
      { logicalPath: ".claude/worktrees", reason: "generated-worktree" },
    ]);
  });
});

test("ignores a symlink whose real target escapes the Workspace", () => {
  withWorkspace([
    { path: "AGENTS.md", content: "# Agent" },
    { path: "CLAUDE.md", symlinkTo: "/dev/null" },
  ], (workspaceRoot) => {
    const scan = scanWorkspaceDetailed(workspaceRoot);

    assert.deepStrictEqual(scan.files.map((file) => file.name), ["AGENTS.md"]);
    assert.deepStrictEqual(scan.summary.aliases, []);
    assert.deepStrictEqual(scan.summary.ignored, [
      { logicalPath: "CLAUDE.md", reason: "outside-workspace-symlink" },
    ]);
  });
});

test("returns files in stable logical-path order", () => {
  withWorkspace([
    { path: "AGENTS.md", content: "# Agent" },
    { path: ".claude/rules/zeta.md", content: "# Zeta" },
    { path: ".claude/rules/alpha.md", content: "# Alpha" },
  ], (workspaceRoot) => {
    const scan = scanWorkspaceDetailed(workspaceRoot);

    assert.deepStrictEqual(scan.files.map((file) => file.name), [
      ".claude/rules/alpha.md",
      ".claude/rules/zeta.md",
      "AGENTS.md",
    ]);
    assert.deepStrictEqual(scan.summary.aliases, []);
    assert.deepStrictEqual(scan.summary.ignored, []);
  });
});
