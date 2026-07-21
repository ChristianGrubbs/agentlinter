// Agent Rules Shortcut: spawns the stack's rules-gui editor (it opens its own
// browser tab). The sanctioned path from a finding to an edit (ADR 0003).
import { NextResponse } from "next/server";
import { spawn } from "node:child_process";
import os from "node:os";
import path from "node:path";

export async function POST() {
  const bin = path.join(os.homedir(), "ai-stack", "bin", "rules-gui");
  const child = spawn(bin, [], { detached: true, stdio: "ignore" });
  child.on("error", (e) => console.error("rules-gui spawn failed:", e.message));
  child.unref();
  return NextResponse.json({ ok: true });
}
