"use client";

import {
  AlertCircle,
  AlertTriangle,
  CheckCircle2,
  Copy,
  Info,
  Zap,
} from "lucide-react";
import { useState } from "react";

import type { Severity } from "@/lib/localStore";
import { countedSeverity, hiddenLegacyDiagnosticCount, severityStats } from "@/lib/reportViewModel";
import type { ReportData } from "../types";
import { RULE_EDUCATION } from "../constants/rule-education";
import CodeBlock from "./CodeBlock";
import { useCopyReportLink } from "./useCopyReportLink";

function SeverityIcon({ severity }: { severity: Severity }) {
  if (severity === "critical") return <AlertCircle className="w-5 h-5 shrink-0 text-[var(--red)]" />;
  if (severity === "error") return <AlertTriangle className="w-5 h-5 shrink-0 text-[#fb7185]" />;
  if (severity === "warning") return <AlertTriangle className="w-5 h-5 shrink-0 text-[var(--amber)]" />;
  return <Info className="w-5 h-5 shrink-0 text-[var(--text-dim)]" />;
}

const FILTER_STYLES: Record<Severity, string> = {
  critical: "bg-[var(--red)]/15 text-[var(--red)] ring-[var(--red)]/30",
  error: "bg-[#fb7185]/15 text-[#fb7185] ring-[#fb7185]/30",
  warning: "bg-[var(--amber)]/15 text-[var(--amber)] ring-[var(--amber)]/30",
  info: "bg-white/10 text-[var(--text-secondary)] ring-white/20",
};

export default function DiagnosticsTab({ data }: { data: ReportData }) {
  const [filters, setFilters] = useState<Set<Severity>>(
    new Set(["critical", "error", "warning", "info"]),
  );
  const { copyState, copyReportLink } = useCopyReportLink();

  function toggleFilter(severity: Severity) {
    const next = new Set(filters);
    if (next.has(severity)) {
      if (next.size > 1) next.delete(severity);
    } else {
      next.add(severity);
    }
    setFilters(next);
  }

  const filtered = data.diagnostics.filter((diagnostic) => filters.has(diagnostic.severity));
  const hiddenLegacyDiagnostics = hiddenLegacyDiagnosticCount(data);

  if (data.diagnostics.length === 0) {
    return (
      <div className="animate-fade-in flex flex-col items-center justify-center py-20 text-center">
        <CheckCircle2 className="w-16 h-16 text-[var(--green)] mb-4" />
        <div className="text-[28px] font-bold text-[var(--green)]">
          {hiddenLegacyDiagnostics > 0 ? "No renderable diagnostics" : "No diagnostics emitted"}
        </div>
        {!data.legacy && (
          <p className="mt-2 text-[14px] text-[var(--text-secondary)]">
            {data.ruleSummary.passed} of {data.ruleSummary.evaluated} evaluated rules passed.
          </p>
        )}
        {data.legacy && hiddenLegacyDiagnostics > 0 && (
          <p className="mt-3 max-w-lg text-[13px] text-[var(--amber)]">
            {hiddenLegacyDiagnostics} of {data.rawLegacyDiagnostics.length} historic diagnostic payloads could not be rendered.
          </p>
        )}
      </div>
    );
  }

  return (
    <div className="space-y-6 animate-fade-in">
      {data.legacy && hiddenLegacyDiagnostics > 0 && (
        <div className="rounded-xl border border-[var(--amber)]/25 bg-[var(--amber)]/5 p-4 text-[13px] text-[var(--amber)]">
          {hiddenLegacyDiagnostics} of {data.rawLegacyDiagnostics.length} historic diagnostic payloads could not be rendered; legacy totals can exceed the cards below.
        </div>
      )}
      <button
        type="button"
        onClick={() => void copyReportLink()}
        className="flex w-full items-center gap-3 rounded-xl border border-[var(--accent-dim)] bg-[var(--bg-card)] p-4 text-left transition-colors hover:bg-white/5"
      >
        <Copy className="w-5 h-5 text-[var(--accent)] shrink-0" />
        <span className="text-[15px] font-medium flex-1">Copy Report link</span>
        <span className="text-[13px] text-[var(--text-secondary)]">
          {copyState === "copied" ? "Copied" : copyState === "failed" ? "Clipboard unavailable" : "Copy"}
        </span>
      </button>

      <div className="flex flex-wrap gap-2" aria-label="Severity filters">
        {severityStats(data).map(({ severity, count }) => (
          <button
            type="button"
            key={severity}
            onClick={() => toggleFilter(severity)}
            aria-pressed={filters.has(severity)}
            className={`flex items-center gap-1.5 rounded-lg px-3 py-2 text-[13px] mono font-medium transition-all ${
              filters.has(severity)
                ? `${FILTER_STYLES[severity]} ring-1`
                : "bg-white/5 text-[var(--text-dim)]"
            }`}
          >
            <SeverityIcon severity={severity} />
            {countedSeverity(count, severity)}
          </button>
        ))}
      </div>

      <div className="space-y-3">
        {filtered.map((diagnostic, index) => {
          const education = RULE_EDUCATION[diagnostic.rule];
          return (
            <div key={`${diagnostic.rule}:${diagnostic.file}:${diagnostic.line ?? 0}:${index}`} className="rounded-xl border border-[var(--border)] bg-[var(--bg-card)] p-5">
              <div className="flex items-start gap-3">
                <SeverityIcon severity={diagnostic.severity} />
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap mb-1">
                    <span className="text-[13px] mono text-[var(--text-secondary)]">
                      {diagnostic.file}{diagnostic.line ? `:${diagnostic.line}` : ""}
                    </span>
                    <span className="text-[11px] mono px-1.5 py-0.5 rounded bg-white/5 text-[var(--text-dim)]">
                      {diagnostic.rule}
                    </span>
                    <span className="text-[11px] mono px-1.5 py-0.5 rounded bg-white/5 text-[var(--text-secondary)]">
                      {diagnostic.severity}
                    </span>
                  </div>
                  <p className="text-[14px] text-[var(--text)]">{diagnostic.message}</p>
                </div>
              </div>

              {diagnostic.fix && (
                <div className="mt-3 flex items-start gap-2 px-3 py-2.5 rounded-lg bg-[var(--green)]/5 border border-[var(--green)]/10">
                  <Zap className="w-3.5 h-3.5 mt-0.5 text-[var(--green)] shrink-0" />
                  <span className="text-[13px] text-[var(--green)]"><strong>Suggested fix:</strong> {diagnostic.fix}</span>
                </div>
              )}

              {education && (
                <div className="mt-3 space-y-2">
                  <p className="text-[13px] text-[var(--text-secondary)] leading-relaxed">{education.impact}</p>
                  {education.example && (
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 mt-2">
                      <CodeBlock code={education.example.bad} label="Before" />
                      <CodeBlock code={education.example.good} label="After" />
                    </div>
                  )}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
