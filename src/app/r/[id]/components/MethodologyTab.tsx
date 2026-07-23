"use client";

import { Info, Target } from "lucide-react";

import { formatPercentage, methodologyPolicy } from "@/lib/reportViewModel";
import type { ReportData } from "../types";
import { getTier } from "../utils/getTier";

function PolicyValue({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="flex items-center justify-between gap-4 rounded-lg bg-white/[0.03] px-3 py-2 text-[13px]">
      <span className="text-[var(--text-secondary)]">{label}</span>
      <span className="mono text-[var(--text)]">{value}</span>
    </div>
  );
}

export default function MethodologyTab({ data }: { data: ReportData }) {
  const policy = methodologyPolicy(data);

  if (!policy) {
    return (
      <div className="space-y-5 animate-fade-in">
        <div className="rounded-xl border border-[var(--amber)]/25 bg-[var(--amber)]/5 p-6">
          <h2 className="text-[18px] font-semibold text-[var(--amber)]">Scoring policy not recorded for this Report</h2>
          <p className="mt-2 text-[14px] text-[var(--text-secondary)]">
            This legacy snapshot preserves its score and category values only; deduction rules, bonuses, formula, and grade scale are unavailable.
          </p>
        </div>
        <div className="rounded-xl border border-[var(--border)] bg-[var(--bg-card)] p-5">
          <PolicyValue label="Report score" value={`${data.totalScore}/100 (${data.grade})`} />
          <div className="mt-3 space-y-2">
            {data.categories.map((category) => (
              <PolicyValue key={category.name} label={category.name} value={`${category.score}/100`} />
            ))}
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-8 animate-fade-in">
      <div className="rounded-xl border border-[var(--accent-dim)] bg-[var(--accent-glow)] p-5">
        <div className="flex items-start gap-3">
          <Info className="mt-0.5 h-4 w-4 shrink-0 text-[var(--accent)]" />
          <div>
            <div className="text-[13px] mono text-[var(--text-dim)]">{policy.kind} scoring policy</div>
            <p className="mt-2 text-[14px] text-[var(--text-secondary)]">{policy.disclaimer}</p>
          </div>
        </div>
      </div>

      <div className="rounded-xl border border-[var(--border)] bg-[var(--bg-card)] p-5 sm:p-6">
        <div className="flex items-center gap-2 mb-4">
          <Target className="w-5 h-5 text-[var(--accent)]" />
          <h2 className="text-[18px] sm:text-[20px] font-semibold">Stored grade scale</h2>
        </div>
        <div className="grid grid-cols-3 gap-2 sm:grid-cols-6">
          {policy.gradeScale.map((entry) => {
            const entryTier = getTier(entry.min);
            return (
              <div
                key={entry.grade}
                className={`rounded-lg px-2 py-2 text-center mono ${data.grade === entry.grade ? "ring-2 ring-white/30" : ""}`}
                style={{ color: entryTier.color, backgroundColor: entryTier.bg }}
              >
                <div className="font-bold">{entry.grade}</div>
                <div className="text-[10px] opacity-70">minimum {entry.min}</div>
              </div>
            );
          })}
        </div>
      </div>

      <div className="rounded-xl border border-[var(--border)] bg-[var(--bg-card)] p-5 sm:p-6">
        <h2 className="text-[18px] sm:text-[20px] font-semibold">Formula and base</h2>
        <div className="mt-4 space-y-2">
          <PolicyValue label="Base per category" value={policy.basePerCategory} />
          <PolicyValue label="Formula" value={policy.formula} />
        </div>
      </div>

      <div className="rounded-xl border border-[var(--border)] bg-[var(--bg-card)] p-5 sm:p-6">
        <h2 className="text-[18px] sm:text-[20px] font-semibold">Standard deductions</h2>
        <div className="mt-4 grid gap-2 sm:grid-cols-2">
          <PolicyValue label="Critical" value={`-${policy.criticalPenalty}`} />
          <PolicyValue label="Default error" value={`-${policy.defaultErrorPenalty}`} />
          <PolicyValue label="Default warning" value={`-${policy.defaultWarningPenalty}`} />
          <PolicyValue label="Info" value={`-${policy.infoPenalty}`} />
          <PolicyValue label="Info cap" value={policy.infoCap} />
        </div>
      </div>

      <div className="rounded-xl border border-[var(--border)] bg-[var(--bg-card)] p-5 sm:p-6">
        <h2 className="text-[18px] sm:text-[20px] font-semibold">Category exceptions, caps, and floor</h2>
        <div className="mt-4 grid gap-2 sm:grid-cols-2">
          <PolicyValue label="Consistency error" value={`-${policy.consistencyErrorPenalty}`} />
          <PolicyValue label="Runtime warning" value={`-${policy.runtimeWarningPenalty}`} />
          <PolicyValue label="Clarity warning cap" value={policy.clarityWarningCap} />
          <PolicyValue label="Consistency floor" value={policy.consistencyFloor} />
        </div>
      </div>

      <div className="rounded-xl border border-[var(--border)] bg-[var(--bg-card)] p-5 sm:p-6">
        <h2 className="text-[18px] sm:text-[20px] font-semibold">Skill Safety scaling</h2>
        <div className="mt-4 grid gap-2 sm:grid-cols-2">
          <PolicyValue label="Skill count threshold" value={policy.skillSafetyScaling.skillCountThreshold} />
          <PolicyValue label="Skill Safety error cap" value={policy.skillSafetyScaling.errorCap} />
          <PolicyValue label="Skill Safety warning" value={`-${policy.skillSafetyScaling.warningPenalty}`} />
          <PolicyValue label="Skill Safety warning cap" value={policy.skillSafetyScaling.warningCap} />
        </div>
      </div>

      <div className="rounded-xl border border-[var(--border)] bg-[var(--bg-card)] p-5 sm:p-6">
        <h2 className="text-[18px] sm:text-[20px] font-semibold">Stored category weights</h2>
        <div className="mt-4 grid gap-2 sm:grid-cols-2">
          {Object.entries(policy.categoryWeights).map(([category, weight]) => (
            <PolicyValue key={category} label={category} value={formatPercentage(weight)} />
          ))}
        </div>
      </div>

      <div className="rounded-xl border border-[var(--border)] bg-[var(--bg-card)] p-5 sm:p-6">
        <h2 className="text-[18px] sm:text-[20px] font-semibold">Recorded bonuses</h2>
        {policy.bonusDescriptions.length === 0 ? (
          <p className="mt-3 text-[13px] text-[var(--text-secondary)]">No bonus descriptions recorded.</p>
        ) : (
          <ul className="mt-3 space-y-2 text-[13px] text-[var(--text-secondary)]">
            {policy.bonusDescriptions.map((description) => <li key={description}>{description}</li>)}
          </ul>
        )}
      </div>
    </div>
  );
}
