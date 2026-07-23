/* ─── Markdown Parser ─── */

import { FileInfo, Section, LintContext, ScanResult } from "./types";
import * as fs from "fs";
import * as path from "path";

const AGENT_FILES = [
  "CLAUDE.md",
  "AGENTS.md",
  "SOUL.md",
  "IDENTITY.md",
  "USER.md",
  "TOOLS.md",
  "SECURITY.md",
  "FORMATTING.md",
  "HEARTBEAT.md",
  "MEMORY.md",
  "BOOTSTRAP.md",
  ".clauderc",
  ".agentlinterrc",
  // Multi-framework config files
  ".cursorrules",
  ".github/copilot-instructions.md",
  // Runtime configs
  "clawdbot.json",
  "openclaw.json",
  "moltbot.json",
];

const AGENT_DIRS = [".claude", "claude", ".cursor", ".windsurf", ".github"];

/**
 * Detect lint context based on files present
 */
function detectContext(fileNames: string[]): LintContext {
  // CLAUDE.md → claude-code context
  if (fileNames.includes("CLAUDE.md")) {
    return "claude-code";
  }

  // .cursorrules → cursor context
  if (fileNames.includes(".cursorrules") || fileNames.some(f => f.startsWith(".cursor/"))) {
    return "cursor";
  }

  // copilot-instructions.md → copilot context
  if (fileNames.includes(".github/copilot-instructions.md") || fileNames.some(f => f.includes("copilot-instructions"))) {
    return "copilot";
  }

  // AGENTS.md or runtime config → agent-runtime context
  if (fileNames.includes("AGENTS.md") ||
      fileNames.includes("openclaw.json") ||
      fileNames.includes("clawdbot.json") ||
      fileNames.includes("moltbot.json")) {
    return "openclaw-runtime";
  }

  // Default to universal
  return "universal";
}

function toLogicalPath(value: string): string {
  return value.split(path.sep).join("/");
}

function isWithinWorkspace(workspaceRoot: string, candidatePath: string): boolean {
  const relative = path.relative(workspaceRoot, candidatePath);
  return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
}

function physicalIdentity(stat: fs.Stats): string {
  return `${stat.dev}:${stat.ino}`;
}

class WorkspaceCollector {
  readonly workspaceRoot: string;
  private readonly physicalWorkspaceRoot: string;
  private readonly filesByIdentity = new Map<string, FileInfo>();
  private readonly canonicalByIdentity = new Map<string, string>();
  private readonly logicalCandidates = new Set<string>();
  private readonly acceptedLogicalPaths = new Set<string>();
  private readonly aliases: ScanResult["summary"]["aliases"] = [];
  private readonly ignored: ScanResult["summary"]["ignored"] = [];
  private discovered = 0;

  constructor(workspacePath: string) {
    this.workspaceRoot = path.resolve(workspacePath);
    this.physicalWorkspaceRoot = fs.realpathSync.native(this.workspaceRoot);
  }

  private isGeneratedWorktree(logicalPath: string): boolean {
    return logicalPath === ".claude/worktrees" || logicalPath.startsWith(".claude/worktrees/");
  }

  private recordIgnored(logicalPath: string, reason: ScanResult["summary"]["ignored"][number]["reason"]): void {
    if (!this.ignored.some((entry) => entry.logicalPath === logicalPath && entry.reason === reason)) {
      this.ignored.push({ logicalPath, reason });
    }
  }

  private recordRejectedCandidate(
    logicalPath: string,
    reason: ScanResult["summary"]["ignored"][number]["reason"],
  ): void {
    if (!this.logicalCandidates.has(logicalPath)) {
      this.logicalCandidates.add(logicalPath);
      this.discovered++;
    }
    this.recordIgnored(logicalPath, reason);
  }

  private canonicalLogicalPath(realPath: string): string {
    return toLogicalPath(path.relative(this.physicalWorkspaceRoot, realPath));
  }

  private resolveInsideWorkspace(candidatePath: string, logicalPath: string): string | null {
    let realPath: string;
    try {
      realPath = fs.realpathSync.native(candidatePath);
    } catch {
      return null;
    }

    if (!isWithinWorkspace(this.physicalWorkspaceRoot, realPath)) {
      this.recordIgnored(logicalPath, "outside-workspace-symlink");
      return null;
    }
    return realPath;
  }

  canDescend(directoryPath: string, logicalPath: string): boolean {
    const normalizedLogicalPath = toLogicalPath(logicalPath);
    if (this.isGeneratedWorktree(normalizedLogicalPath)) {
      this.recordRejectedCandidate(normalizedLogicalPath, "generated-worktree");
      return false;
    }

    const realPath = this.resolveInsideWorkspace(directoryPath, normalizedLogicalPath);
    if (!realPath) {
      if (!this.logicalCandidates.has(normalizedLogicalPath)) {
        this.logicalCandidates.add(normalizedLogicalPath);
        this.discovered++;
      }
      return false;
    }

    if (this.isGeneratedWorktree(this.canonicalLogicalPath(realPath))) {
      this.recordRejectedCandidate(normalizedLogicalPath, "generated-worktree");
      return false;
    }

    try {
      const stat = fs.statSync(realPath);
      if (!stat.isDirectory()) return false;
      return true;
    } catch {
      return false;
    }
  }

  collect(candidatePath: string, logicalPath: string): void {
    const normalizedLogicalPath = toLogicalPath(logicalPath);
    if (this.logicalCandidates.has(normalizedLogicalPath)) return;
    this.logicalCandidates.add(normalizedLogicalPath);
    this.discovered++;

    if (this.isGeneratedWorktree(normalizedLogicalPath)) {
      this.recordIgnored(normalizedLogicalPath, "generated-worktree");
      return;
    }

    const realPath = this.resolveInsideWorkspace(candidatePath, normalizedLogicalPath);
    if (!realPath) return;

    const canonicalPath = this.canonicalLogicalPath(realPath);
    if (this.isGeneratedWorktree(canonicalPath)) {
      this.recordIgnored(normalizedLogicalPath, "generated-worktree");
      return;
    }

    let stat: fs.Stats;
    try {
      stat = fs.statSync(realPath);
    } catch {
      return;
    }
    if (!stat.isFile()) return;
    this.acceptedLogicalPaths.add(normalizedLogicalPath);

    const identity = physicalIdentity(stat);
    const existingCanonicalPath = this.canonicalByIdentity.get(identity);
    if (existingCanonicalPath) {
      if (normalizedLogicalPath !== existingCanonicalPath) {
        this.aliases.push({ logicalPath: normalizedLogicalPath, canonicalPath: existingCanonicalPath });
      }
      return;
    }

    const canonicalFilePath = path.join(this.workspaceRoot, canonicalPath);
    this.canonicalByIdentity.set(identity, canonicalPath);
    if (normalizedLogicalPath !== canonicalPath) {
      this.aliases.push({ logicalPath: normalizedLogicalPath, canonicalPath });
    }
    this.filesByIdentity.set(
      identity,
      parseFile(canonicalFilePath, canonicalPath, "universal", this.workspaceRoot, canonicalFilePath),
    );
  }

  result(): ScanResult {
    const context = detectContext([...this.acceptedLogicalPaths]);
    const files = [...this.filesByIdentity.values()]
      .map((file) => ({ ...file, context }))
      .sort((a, b) => a.name.localeCompare(b.name));
    const aliases = [...this.aliases].sort(
      (a, b) => a.logicalPath.localeCompare(b.logicalPath) || a.canonicalPath.localeCompare(b.canonicalPath),
    );
    const ignored = [...this.ignored].sort((a, b) => a.logicalPath.localeCompare(b.logicalPath));

    return {
      files,
      summary: {
        policyVersion: "2026-07-22",
        discovered: this.discovered,
        analyzed: files.length,
        aliases,
        ignored,
      },
    };
  }
}

/**
 * Scan a workspace for agent configuration files and provenance.
 */
export function scanWorkspaceDetailed(workspacePath: string): ScanResult {
  const collector = new WorkspaceCollector(workspacePath);
  const workspaceRoot = collector.workspaceRoot;

  // Second pass: parse files with context
  for (const fileName of AGENT_FILES) {
    const filePath = path.join(workspaceRoot, fileName);
    if (fs.existsSync(filePath)) {
      collector.collect(filePath, fileName);
    }
  }

  // Check agent directories (recursive for .claude/, 1-level for others)
  for (const dir of AGENT_DIRS) {
    const dirPath = path.join(workspaceRoot, dir);
    if (fs.existsSync(dirPath)) {
      if (dir === ".claude" || dir === "claude") {
        // Recursively scan .claude/ tree (agents/, rules/, skills/, hooks/, etc.)
        scanDirRecursive(dirPath, dir, collector, 0, 3);
      } else if (collector.canDescend(dirPath, dir)) {
        // Other dirs: one level only
        const dirFiles = fs.readdirSync(dirPath).sort();
        for (const fileName of dirFiles) {
          if (fileName.endsWith(".md") || fileName.endsWith(".txt")) {
            const filePath = path.join(dirPath, fileName);
            const relativeName = `${dir}/${fileName}`;
            collector.collect(filePath, relativeName);
          }
        }
      }
    }
  }

  // Also check for compound/ directory (Clawdbot pattern)
  const compoundDir = path.join(workspaceRoot, "compound");
  if (fs.existsSync(compoundDir) && collector.canDescend(compoundDir, "compound")) {
    const compoundFiles = fs.readdirSync(compoundDir).sort();
    for (const fileName of compoundFiles) {
      if (fileName.endsWith(".md")) {
        const filePath = path.join(compoundDir, fileName);
        collector.collect(filePath, `compound/${fileName}`);
      }
    }
  }

  // Check ~/.openclaw/openclaw.json (runtime config)
  // ONLY include home config when scanning the home directory itself.
  // Scanning a project dir should NOT pull in the user's live API keys.
  const homeDir = process.env.HOME || process.env.USERPROFILE || "";
  let isHomeDir = false;
  if (homeDir) {
    try {
      isHomeDir = fs.realpathSync.native(workspaceRoot) === fs.realpathSync.native(path.resolve(homeDir));
    } catch {
      isHomeDir = false;
    }
  }
  if (isHomeDir) {
    const runtimeConfigPaths = [
      path.join(homeDir, ".clawdbot", "clawdbot.json"),
      path.join(homeDir, ".openclaw", "openclaw.json"),
      path.join(homeDir, ".moltbot", "moltbot.json"),
    ];
    for (const configPath of runtimeConfigPaths) {
      if (fs.existsSync(configPath)) {
        collector.collect(configPath, toLogicalPath(path.relative(workspaceRoot, configPath)));
        break; // Only read the first one found
      }
    }
  }

  // Scan skills/ directory for skill safety checks
  const skillsDirs = [path.join(workspaceRoot, "skills")];
  if (isHomeDir) {
    skillsDirs.push(
      path.join(homeDir, ".clawdbot", "skills"),
      path.join(homeDir, ".openclaw", "skills"),
      path.join(homeDir, ".moltbot", "skills"),
    );
  }
  for (const skillsDir of skillsDirs) {
    if (fs.existsSync(skillsDir)) {
      const logicalDir = toLogicalPath(path.relative(workspaceRoot, skillsDir));
      scanSkillsDir(skillsDir, logicalDir, collector);
    }
  }

  return collector.result();
}

/**
 * Compatibility wrapper for downstream callers that only need analyzed files.
 */
export function scanWorkspace(workspacePath: string): FileInfo[] {
  return scanWorkspaceDetailed(workspacePath).files;
}

/**
 * Recursively scan a directory tree (for .claude/ and similar)
 */
function scanDirRecursive(
  dir: string,
  prefix: string,
  collector: WorkspaceCollector,
  depth: number,
  maxDepth: number
) {
  if (depth > maxDepth) return;
  if (!collector.canDescend(dir, prefix)) return;
  try {
    const entries = fs.readdirSync(dir).sort();
    for (const entry of entries) {
      if (entry === "node_modules" || (entry.startsWith(".") && depth > 0)) continue;
      const fullPath = path.join(dir, entry);
      const relativeName = `${prefix}/${entry}`;
      let isDirectory = false;
      try {
        isDirectory = fs.statSync(fullPath).isDirectory();
      } catch {
        continue;
      }
      if (isDirectory) {
        scanDirRecursive(fullPath, relativeName, collector, depth + 1, maxDepth);
      } else if (
        entry.endsWith(".md") ||
        entry.endsWith(".txt") ||
        entry.endsWith(".json")
      ) {
        collector.collect(fullPath, relativeName);
      }
    }
  } catch {
    // Permission denied or other error — skip
  }
}

/**
 * Recursively scan skills directory (max depth 3)
 */
function scanSkillsDir(dir: string, logicalDir: string, collector: WorkspaceCollector, depth = 0) {
  if (depth > 3) return;
  if (!collector.canDescend(dir, logicalDir)) return;
  try {
    const entries = fs.readdirSync(dir).sort();
    for (const entry of entries) {
      if (entry === "node_modules" || entry.startsWith(".")) continue;
      const fullPath = path.join(dir, entry);
      const stat = fs.statSync(fullPath);
      if (stat.isDirectory()) {
        scanSkillsDir(fullPath, `${logicalDir}/${entry}`, collector, depth + 1);
      } else if (entry === "SKILL.md" || entry.endsWith(".md")) {
        collector.collect(fullPath, `${logicalDir}/${entry}`);
      }
    }
  } catch {
    // Permission denied or other error — skip
  }
}

/**
 * Parse a single markdown file
 */
export function parseFile(
  filePath: string,
  name: string,
  context: LintContext,
  workspaceRoot = path.dirname(filePath),
  canonicalPath = fs.realpathSync.native(filePath),
): FileInfo {
  const content = fs.readFileSync(filePath, "utf-8");
  const lines = content.split("\n");
  const sections = parseSections(lines);

  return { name, path: filePath, workspaceRoot, canonicalPath, content, lines, sections, context };
}

/**
 * Extract sections from markdown by headings
 */
function parseSections(lines: string[]): Section[] {
  const sections: Section[] = [];
  let currentSection: Section | null = null;
  let inCodeBlock = false;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    // Track code block state — skip heading detection inside code blocks
    if (line.trimStart().startsWith("```")) {
      inCodeBlock = !inCodeBlock;
    }
    if (inCodeBlock) continue;

    const headingMatch = line.match(/^(#{1,6})\s+(.+)/);

    if (headingMatch) {
      // Close previous section
      if (currentSection) {
        currentSection.endLine = i - 1;
        currentSection.content = lines
          .slice(currentSection.startLine, i)
          .join("\n");
        sections.push(currentSection);
      }

      currentSection = {
        heading: headingMatch[2].trim(),
        level: headingMatch[1].length,
        startLine: i,
        endLine: i,
        content: "",
      };
    }
  }

  // Close last section
  if (currentSection) {
    currentSection.endLine = lines.length - 1;
    currentSection.content = lines
      .slice(currentSection.startLine)
      .join("\n");
    sections.push(currentSection);
  }

  return sections;
}
