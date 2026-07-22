"use client";

import {
  AlertCircle,
  AlertTriangle,
  CheckCircle2,
  ChevronRight,
  Copy,
  Eye,
  FileText,
  Info,
  Layers,
  Puzzle,
  Scale,
  Shield,
  Target,
} from "lucide-react";
import type { CSSProperties } from "react";

import {
  countedSeverity,
  reportProvenance,
  severityStats,
} from "@/lib/reportViewModel";
import type { Severity } from "@/lib/localStore";
import type { ReportData } from "../types";
import { getTier } from "../utils/getTier";
import { useCopyReportLink } from "./useCopyReportLink";

function CategoryIcon({ name, className, style }: { name: string; className?: string; style?: CSSProperties }) {
  const cn = className || "w-4 h-4";
  switch (name) {
    case "Structure": return <Layers className={cn} style={style} />;
    case "Clarity": return <Eye className={cn} style={style} />;
    case "Completeness": return <Puzzle className={cn} style={style} />;
    case "Security": return <Shield className={cn} style={style} />;
    case "Consistency": return <Scale className={cn} style={style} />;
    case "Blueprint": return <Target className={cn} style={style} />;
    default: return <FileText className={cn} style={style} />;
  }
}

const SEVERITY_STYLE: Record<Severity, { color: string; borderColor: string }> = {
  critical: { color: "var(--red)", borderColor: "rgba(248, 113, 113, 0.25)" },
  error: { color: "#fb7185", borderColor: "rgba(251, 113, 133, 0.22)" },
  warning: { color: "var(--amber)", borderColor: "rgba(251, 191, 36, 0.22)" },
  info: { color: "var(--text-secondary)", borderColor: "rgba(255, 255, 255, 0.12)" },
};

export default function OverviewTab({
  data,
  onTabChange,
}: {
  data: ReportData;
  onTabChange: (tab: string) => void;
}) {
  const tier = getTier(data.totalScore);
  const provenance = reportProvenance(data);
  const { copyState, copyReportLink } = useCopyReportLink();

  return (
    <div className="space-y-8 sm:space-y-10">
      <div className="text-center">
        <div
          className="inline-flex flex-col items-center rounded-[2rem] px-6 py-4 sm:px-10 sm:py-6"
          style={{ filter: `drop-shadow(0 0 40px ${tier.color}40)` }}
        >
          <span className="mb-2 text-[11px] mono uppercase tracking-widest text-[var(--text-dim)]">
            Heuristic score
          </span>
          <div className="flex items-start justify-center leading-none">
            <span
              className="text-[96px] sm:text-[128px] font-black leading-none display"
              style={{
                background: `linear-gradient(135deg, ${tier.color}, ${tier.color}cc)`,
                WebkitBackgroundClip: "text",
                WebkitTextFillColor: "transparent",
              }}
            >
              {data.totalScore}
            </span>
            <span className="mt-4 text-[48px] sm:text-[64px] font-light text-white/30 align-top">/100</span>
          </div>
          <div
            className="mt-3 px-6 py-2 rounded-2xl text-[32px] sm:text-[40px] font-bold mono"
            style={{ color: tier.color, backgroundColor: tier.bg }}
          >
            {data.grade}
          </div>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4 sm:gap-4">
        {severityStats(data).map(({ severity, count }) => {
          const Icon = severity === "critical"
            ? AlertCircle
            : severity === "error" || severity === "warning"
              ? AlertTriangle
              : Info;
          const style = SEVERITY_STYLE[severity];
          return (
            <div
              key={severity}
              className="rounded-xl border bg-[var(--bg-card)] p-4 text-center"
              style={{ borderColor: style.borderColor }}
            >
              <Icon className="mx-auto h-5 w-5" style={{ color: style.color }} />
              <div className="mt-3 text-[36px] font-black mono leading-none" style={{ color: style.color }}>
                {count}
              </div>
              <div className="mt-2 text-[13px] text-[var(--text-dim)]">
                {countedSeverity(count, severity)}
              </div>
            </div>
          );
        })}
      </div>

      {!data.legacy && (
        <div className="rounded-xl border border-[var(--accent-dim)] bg-[var(--accent-glow)] p-5 text-[13px] text-[var(--text-secondary)]">
          <p>{data.scoringPolicy.disclaimer}</p>
          <p className="mt-2 mono text-[12px] text-[var(--text-dim)]">
            {data.ruleSummary.evaluated} evaluated · {data.ruleSummary.flagged} flagged · {data.ruleSummary.passed} passed
          </p>
        </div>
      )}

      {data.legacy && (
        <div className="rounded-xl border border-[var(--amber)]/25 bg-[var(--amber)]/5 p-5">
          <p className="font-medium text-[var(--amber)]">Legacy Report metadata unavailable</p>
          <p className="mt-2 text-[13px] text-[var(--text-secondary)]">
            Engine catalog, scoring policy, and scan provenance were not recorded. Some malformed historic diagnostic payloads may not be renderable.
          </p>
        </div>
      )}

      <div className="rounded-xl border border-[var(--border)] bg-[var(--bg-card)] p-4 sm:p-6">
        <div className="space-y-1">
          {data.categories.map((category) => {
            const categoryTier = getTier(category.score);
            return (
              <button
                type="button"
                key={category.name}
                onClick={() => onTabChange("categories")}
                className="flex w-full items-center gap-4 h-12 hover:bg-white/5 rounded-lg px-2 text-left transition-colors"
              >
                <div className="flex items-center gap-2 w-[130px]">
                  <CategoryIcon name={category.name} className="w-4 h-4" style={{ color: `${categoryTier.color}80` }} />
                  <span className="truncate text-[15px] font-medium text-[var(--text-secondary)] sm:text-[16px]">
                    {category.name}
                  </span>
                </div>
                <div className="flex-1 h-3 rounded-full overflow-hidden bg-white/[0.06]">
                  <div className="h-full rounded-full" style={{ backgroundColor: categoryTier.color, width: `${category.score}%` }} />
                </div>
                <span className="w-[50px] text-right text-[22px] font-bold mono sm:text-[24px]" style={{ color: categoryTier.color }}>
                  {category.score}
                </span>
                <ChevronRight className="h-3.5 w-3.5 text-[var(--text-dim)]" />
              </button>
            );
          })}
        </div>
      </div>

      <button
        type="button"
        onClick={() => void copyReportLink()}
        className="flex w-full items-center gap-4 rounded-xl border border-[var(--accent-dim)] bg-[var(--bg-card)] p-5 text-left transition-colors hover:bg-white/5"
      >
        <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-[var(--accent-glow)]">
          {copyState === "copied" ? <CheckCircle2 className="h-5 w-5 text-[var(--green)]" /> : <Copy className="h-5 w-5 text-[var(--accent)]" />}
        </span>
        <span className="flex-1">
          <span className="block text-[16px] font-semibold">Copy Report link</span>
          <span className="mt-0.5 block text-[13px] text-[var(--text-secondary)]">
            {copyState === "copied" ? "Copied" : copyState === "failed" ? "Clipboard unavailable" : "Copy this Report URL"}
          </span>
        </span>
      </button>

      {provenance && (
        <div className="rounded-xl border border-[var(--border)] bg-[var(--bg-card)] p-5 sm:p-6">
          <h3 className="text-[16px] font-semibold">Report provenance</h3>
          <div className="mt-4 grid grid-cols-2 gap-3 text-[13px] sm:grid-cols-4">
            <span>Engine {provenance.engineVersion}</span>
            <span>Schema {provenance.schemaVersion}</span>
            <span>Context {provenance.context}</span>
            <span>Scan policy {provenance.scanPolicyVersion}</span>
            <span>{provenance.discovered} discovered</span>
            <span>{provenance.analyzed} analyzed</span>
            <span>{provenance.generatedWorktreeIgnoreCount} generated worktree ignored</span>
            <span>{provenance.aliasCount} alias{provenance.aliasCount === 1 ? "" : "es"}</span>
          </div>
          <div className="mt-5 space-y-3 text-[13px] text-[var(--text-secondary)]">
            <div>
              <div className="mb-1 font-medium text-[var(--text)]">Ignored entries ({provenance.ignored.length})</div>
              {provenance.ignored.length === 0 ? <p>None recorded</p> : provenance.ignored.map((entry) => (
                <p key={`${entry.logicalPath}:${entry.reason}`} className="mono">{entry.logicalPath} · {entry.reason}</p>
              ))}
            </div>
            <div>
              <div className="mb-1 font-medium text-[var(--text)]">Aliases ({provenance.aliasCount})</div>
              {provenance.aliases.length === 0 ? <p>None recorded</p> : provenance.aliases.map((alias) => (
                <p key={`${alias.logicalPath}:${alias.canonicalPath}`} className="mono">{alias.logicalPath} -&gt; {alias.canonicalPath}</p>
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
