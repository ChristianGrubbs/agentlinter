import { appendFileSync } from "node:fs";
import { randomUUID } from "node:crypto";

type Scalar = string | number | boolean;

const runId = randomUUID();

export function logEngineDecision({ event, loc, ctx }: {
  event: string;
  loc: string;
  ctx: Record<string, Scalar>;
}): void {
  if (process.env.AGENTLINTER_ENGINE_LOG !== "1") return;

  const path = process.env.AGENTLINTER_ENGINE_LOG_PATH ?? "/tmp/agentlinter-engine.jsonl";
  const record = {
    ts: new Date().toISOString(),
    run_id: runId,
    level: "info",
    event,
    loc,
    ctx,
  };

  try {
    appendFileSync(path, `${JSON.stringify(record)}\n`, "utf8");
  } catch {
    // Decision logging must not affect a lint result.
  }
}
