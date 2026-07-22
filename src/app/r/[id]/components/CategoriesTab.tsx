"use client";

import {
  AlertCircle,
  AlertTriangle,
  CheckCircle2,
  Eye,
  FileText,
  Info,
  Layers,
  Lightbulb,
  Puzzle,
  Scale,
  Shield,
  Target,
  Zap,
} from "lucide-react";

import type { Severity } from "@/lib/localStore";
import { formatPercentage, ruleCatalogGroups } from "@/lib/reportViewModel";
import type { ReportData } from "../types";
import { CATEGORY_META } from "../constants/category-meta";
import { RULE_EDUCATION } from "../constants/rule-education";
import { getTier } from "../utils/getTier";
import CodeBlock from "./CodeBlock";
import Collapsible from "./Collapsible";

function CategoryIcon({ name, className }: { name: string; className?: string }) {
  const cn = className || "w-4 h-4";
  switch (name) {
    case "Structure": return <Layers className={cn} />;
    case "Clarity": return <Eye className={cn} />;
    case "Completeness": return <Puzzle className={cn} />;
    case "Security": return <Shield className={cn} />;
    case "Consistency": return <Scale className={cn} />;
    case "Blueprint": return <Target className={cn} />;
    default: return <FileText className={cn} />;
  }
}

function SeverityIcon({ severity }: { severity: Severity }) {
  if (severity === "critical") return <AlertCircle className="w-4 h-4 text-[var(--red)]" />;
  if (severity === "error") return <AlertTriangle className="w-4 h-4 text-[#fb7185]" />;
  if (severity === "warning") return <AlertTriangle className="w-4 h-4 text-[var(--amber)]" />;
  return <Info className="w-4 h-4 text-[var(--text-dim)]" />;
}

export default function CategoriesTab({ data }: { data: ReportData }) {
  if (data.legacy) {
    return (
      <div className="rounded-xl border border-[var(--amber)]/25 bg-[var(--amber)]/5 p-6 animate-fade-in">
        <h2 className="text-[18px] font-semibold text-[var(--amber)]">Rule catalog not recorded for this Report</h2>
        <p className="mt-2 text-[14px] text-[var(--text-secondary)]">
          This legacy snapshot contains category scores but no Engine rule catalog or per-rule status.
        </p>
        <div className="mt-5 space-y-2">
          {data.categories.map((category) => (
            <div key={category.name} className="flex justify-between rounded-lg bg-white/[0.03] px-3 py-2 text-[13px]">
              <span>{category.name}</span>
              <span className="mono">{category.score}/100</span>
            </div>
          ))}
        </div>
      </div>
    );
  }

  const groups = ruleCatalogGroups(data);

  return (
    <div className="space-y-5 animate-fade-in">
      <p className="text-[14px] text-[var(--text-secondary)]">
        Engine catalog: {data.ruleSummary.evaluated} evaluated · {data.ruleSummary.flagged} flagged · {data.ruleSummary.passed} passed.
      </p>

      {groups.map((group) => {
        const categoryTier = getTier(group.score);
        const meta = CATEGORY_META[group.key];
        const categoryDiagnostics = data.diagnostics.filter((diagnostic) => diagnostic.category === group.key);

        return (
          <Collapsible
            key={group.key}
            title={group.name}
            icon={<CategoryIcon name={group.name} className="w-5 h-5" />}
            badge={
              <div className="flex items-center gap-2">
                <span className="text-[24px] sm:text-[28px] font-bold mono" style={{ color: categoryTier.color }}>
                  {group.score}
                </span>
                <span className="text-[11px] mono px-2 py-0.5 rounded-md" style={{ color: categoryTier.color, backgroundColor: categoryTier.bg }}>
                  {group.grade} · {formatPercentage(group.weight)} weight
                </span>
              </div>
            }
            defaultOpen={group.diagnosticCount > 0}
          >
            <div className="space-y-6 pt-4">
              <p className="text-[14px] text-[var(--text-secondary)] leading-relaxed">{meta.description}</p>
              <div className="rounded-lg bg-[var(--accent-glow)] border border-[var(--accent-dim)] p-5">
                <div className="flex items-center gap-2 mb-2">
                  <Lightbulb className="w-4 h-4 text-[var(--accent)]" />
                  <span className="text-[13px] font-semibold text-[var(--accent)] uppercase tracking-wider">Education</span>
                </div>
                <p className="text-[14px] text-[var(--text)] leading-relaxed">{meta.whyItMatters}</p>
              </div>

              <div>
                <h4 className="mb-3 text-[13px] font-semibold uppercase tracking-wider text-[var(--text-secondary)]">
                  Recorded rules ({group.rules.length})
                </h4>
                <div className="space-y-2">
                  {group.rules.map((rule) => {
                    const diagnostic = categoryDiagnostics.find((entry) => entry.rule === rule.id);
                    return (
                      <div key={rule.id} className="rounded-lg border border-[var(--border)] bg-white/[0.02] p-4">
                        <div className="flex items-start gap-2.5">
                          {diagnostic
                            ? <SeverityIcon severity={diagnostic.severity} />
                            : <CheckCircle2 className="w-4 h-4 mt-0.5 text-[var(--green)]" />}
                          <div className="min-w-0 flex-1">
                            <div className="flex flex-wrap items-center gap-2">
                              <span className="text-[14px] text-[var(--text)]">{rule.description}</span>
                              <span className={`rounded px-1.5 py-0.5 text-[10px] mono ${rule.status === "flagged" ? "bg-[var(--amber)]/10 text-[var(--amber)]" : "bg-[var(--green)]/10 text-[var(--green)]"}`}>
                                {rule.status}
                              </span>
                            </div>
                            <div className="mt-1 flex flex-wrap items-center gap-2 text-[11px] mono text-[var(--text-dim)]">
                              <span>{rule.id}</span>
                              <span>default {rule.defaultSeverity}</span>
                              <span className="rounded bg-white/5 px-1.5 py-0.5 normal-case">{rule.evidenceLabel}</span>
                            </div>
                            {rule.source && (
                              <div className="mt-2 text-[12px] text-[var(--text-secondary)]">
                                <a href={rule.source.url} target="_blank" rel="noreferrer" className="text-[var(--accent)] hover:underline">
                                  {rule.source.label}
                                </a>{" "}
                                <span className="mono text-[var(--text-dim)]">as of {rule.source.asOf}</span>
                              </div>
                            )}
                            {diagnostic && <p className="mt-2 text-[13px] text-[var(--text-secondary)]">{diagnostic.message}</p>}
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>

              {categoryDiagnostics.length > 0 && (
                <div>
                  <h4 className="mb-3 text-[13px] font-semibold uppercase tracking-wider text-[var(--text-secondary)]">
                    Flagged diagnostics ({categoryDiagnostics.length})
                  </h4>
                  <div className="space-y-4">
                    {categoryDiagnostics.map((diagnostic, index) => {
                      const education = RULE_EDUCATION[diagnostic.rule];
                      return (
                        <div key={`${diagnostic.rule}:${diagnostic.file}:${diagnostic.line ?? 0}:${index}`} className="rounded-lg border border-[var(--border)] bg-[var(--bg)] p-5">
                          <div className="flex items-start gap-3">
                            <SeverityIcon severity={diagnostic.severity} />
                            <div className="flex-1">
                              <div className="flex items-center gap-2 flex-wrap">
                                <span className="text-[13px] mono text-[var(--text-secondary)]">
                                  {diagnostic.file}{diagnostic.line ? `:${diagnostic.line}` : ""}
                                </span>
                                <span className="text-[11px] mono px-1.5 py-0.5 rounded bg-white/5 text-[var(--text-dim)]">{diagnostic.rule}</span>
                              </div>
                              <p className="mt-1 text-[14px] text-[var(--text)]">{diagnostic.message}</p>
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
              )}
            </div>
          </Collapsible>
        );
      })}
    </div>
  );
}
