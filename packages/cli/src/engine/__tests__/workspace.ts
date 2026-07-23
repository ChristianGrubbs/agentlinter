import fs from "node:fs";
import os from "node:os";
import path from "node:path";

export interface WorkspaceFile {
  path: string;
  content?: string;
  symlinkTo?: string;
}

export function withWorkspace<T>(
  files: WorkspaceFile[],
  callback: (workspaceRoot: string) => T,
): T {
  const workspaceRoot = fs.mkdtempSync(path.join(os.tmpdir(), "agentlinter-workspace-"));

  try {
    for (const file of files) {
      const destination = path.resolve(workspaceRoot, file.path);
      if (!destination.startsWith(`${workspaceRoot}${path.sep}`)) {
        throw new Error(`Workspace fixture escapes its root: ${file.path}`);
      }
      fs.mkdirSync(path.dirname(destination), { recursive: true });
      if (file.symlinkTo !== undefined) {
        fs.symlinkSync(file.symlinkTo, destination);
      } else {
        fs.writeFileSync(destination, file.content ?? "", "utf-8");
      }
    }
    return callback(workspaceRoot);
  } finally {
    fs.rmSync(workspaceRoot, { recursive: true, force: true });
  }
}
