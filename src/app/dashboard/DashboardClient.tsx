"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";

const PRESETS = [
  { label: "~/ai-stack", path: "/Users/christian/ai-stack", isDefault: true },
  { label: "~/.claude", path: "/Users/christian/.claude", isDefault: false },
  { label: "~/.codex", path: "/Users/christian/.codex", isDefault: false },
];

type Row = { id: string; workspace: string; score: number; created_at: string };

function gradeFor(score: number): string {
  return score >= 95 ? "S" : score >= 90 ? "A+" : score >= 85 ? "A" : score >= 80 ? "A-" : score >= 75 ? "B+" : score >= 68 ? "B" : "C";
}

function scoreColor(score: number): string {
  return score >= 85 ? "#5eead4" : score >= 68 ? "#facc15" : "#f87171";
}

export default function DashboardClient() {
  const router = useRouter();
  const [workspace, setWorkspace] = useState(PRESETS[0].path);
  const [custom, setCustom] = useState("");
  const [recents, setRecents] = useState<string[]>([]);
  const [rows, setRows] = useState<Row[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetch("/api/reports").then((r) => r.json()).then((d) => setRows(d.reports || [])).catch(() => {});
    try { setRecents(JSON.parse(localStorage.getItem("al.recents") || "[]")); } catch { /* fresh start */ }
  }, []);

  const target = custom.trim() || workspace;

  async function run() {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/run", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ workspace: target }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
      if (custom.trim() && !PRESETS.some((p) => p.path === custom.trim())) {
        const next = [custom.trim(), ...recents.filter((r) => r !== custom.trim())].slice(0, 5);
        localStorage.setItem("al.recents", JSON.stringify(next));
      }
      router.push(data.url);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setBusy(false);
    }
  }

  const latest = rows[0];

  return (
    <div className="min-h-screen bg-[var(--bg)] noise">
      <nav className="border-b border-[var(--border)] sticky top-0 bg-[var(--bg)]/80 backdrop-blur-xl z-50">
        <div className="max-w-[760px] mx-auto px-4 sm:px-6 h-14 flex items-center justify-between">
          <span className="font-semibold text-[14px]">AgentLinter <span className="text-[11px] mono text-[var(--text-dim)] ml-1">Dashboard</span></span>
          <button
            onClick={() => fetch("/api/rules-gui", { method: "POST" })}
            className="px-3 py-1.5 rounded-lg text-[12px] font-medium border border-[var(--border)] text-[var(--text-dim)] hover:text-white transition-colors"
          >
            Open Agent Rules
          </button>
        </div>
      </nav>
      <main className="max-w-[760px] mx-auto px-4 sm:px-6 py-8 grid gap-4 sm:grid-cols-2">
        <section className="rounded-xl border border-[var(--border)] p-5">
          <h2 className="mono text-[11px] uppercase tracking-wider text-[var(--text-dim)] mb-3">Run a lint</h2>
          <div className="flex flex-wrap gap-2 mb-3">
            {PRESETS.map((p) => (
              <button
                key={p.path}
                onClick={() => { setWorkspace(p.path); setCustom(""); }}
                className={`px-3 py-1.5 rounded-lg text-[12px] mono border transition-colors ${target === p.path ? "border-[#5eead4] text-[#5eead4]" : "border-[var(--border)] text-[var(--text-dim)] hover:text-white"}`}
              >
                {p.label}{p.isDefault ? " ·" : ""}
              </button>
            ))}
          </div>
          <input
            value={custom}
            onChange={(e) => setCustom(e.target.value)}
            placeholder="…or an absolute path"
            className="w-full mb-2 px-3 py-2 rounded-lg bg-transparent border border-[var(--border)] text-[13px] mono placeholder:text-[var(--text-dim)]"
          />
          {recents.length > 0 && (
            <div className="flex flex-wrap gap-1.5 mb-3">
              {recents.map((r) => (
                <button key={r} onClick={() => setCustom(r)} className="px-2 py-1 rounded text-[11px] mono text-[var(--text-dim)] border border-[var(--border)] hover:text-white">
                  {r}
                </button>
              ))}
            </div>
          )}
          <button
            onClick={run}
            disabled={busy}
            className="w-full px-3 py-2 rounded-lg text-[13px] font-semibold bg-[#5eead4] text-black disabled:opacity-50 hover:brightness-110 transition-all"
          >
            {busy ? "Linting…" : "Run lint"}
          </button>
          {error && <p className="mt-2 text-[12px] text-[#f87171]">{error}</p>}
          <p className="mt-3 text-[11px] text-[var(--text-dim)]">Read-only: findings are fixed in rules-gui or by agents, never from this GUI.</p>
        </section>
        <section className="rounded-xl border border-[var(--border)] p-5">
          <h2 className="mono text-[11px] uppercase tracking-wider text-[var(--text-dim)] mb-3">Latest score</h2>
          {latest ? (
            <div>
              <div className="flex items-baseline gap-2">
                <span className="text-5xl font-bold" style={{ color: scoreColor(latest.score) }}>{latest.score}</span>
                <span className="text-[var(--text-dim)]">/100</span>
                <span className="px-2 py-0.5 rounded text-[12px] font-bold text-black" style={{ background: scoreColor(latest.score) }}>{gradeFor(latest.score)}</span>
              </div>
              <p className="mt-2 text-[12px] mono text-[var(--text-dim)]">{latest.workspace}</p>
              <p className="text-[11px] text-[var(--text-dim)]">{latest.created_at.slice(0, 10)}</p>
              <a href={`/r/${latest.id}`} className="inline-block mt-3 text-[12px] text-[#5eead4] hover:brightness-110">Open report →</a>
            </div>
          ) : (
            <p className="text-[12px] text-[var(--text-dim)]">No runs yet — pick a workspace and run your first lint.</p>
          )}
        </section>
        <section className="rounded-xl border border-[var(--border)] p-5 sm:col-span-2">
          <h2 className="mono text-[11px] uppercase tracking-wider text-[var(--text-dim)] mb-3">History</h2>
          {rows.length === 0 && <p className="text-[12px] text-[var(--text-dim)]">Nothing here yet.</p>}
          <div className="divide-y divide-[var(--border)]">
            {rows.map((r) => (
              <a key={r.id} href={`/r/${r.id}`} className="flex items-center gap-3 py-2 text-[13px] hover:bg-white/5 transition-colors">
                <span className="mono text-[11px] text-[var(--text-dim)] w-20 shrink-0">{r.created_at.slice(0, 10)}</span>
                <span className="mono text-[12px] truncate flex-1">{r.workspace}</span>
                <span className="font-semibold" style={{ color: scoreColor(r.score) }}>{r.score}</span>
                <span className="px-1.5 py-0.5 rounded text-[10px] font-bold text-black" style={{ background: scoreColor(r.score) }}>{gradeFor(r.score)}</span>
              </a>
            ))}
          </div>
        </section>
      </main>
    </div>
  );
}
