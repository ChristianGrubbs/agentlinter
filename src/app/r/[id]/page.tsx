import { notFound } from "next/navigation";

import { gradeFor } from "@/lib/grade";
import { listReports, readReport } from "@/lib/localStore";
import { adaptStoredReport, metadataDiagnosticCount } from "@/lib/reportAdapter";
import ReportClientLoader from "./ReportClientLoader";
import type { ReportData } from "./types";

async function fetchReport(id: string): Promise<ReportData | null> {
  const stored = readReport(id);
  if (!stored) return null;
  return {
    ...adaptStoredReport(stored),
    history: listReports(10).map((report) => ({
      id: report.id,
      score: report.score,
      created_at: report.created_at,
    })),
  };
}

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const data = await fetchReport(id);
  if (!data) return { title: "Report Not Found — AgentLinter" };

  const grade = data.legacy ? gradeFor(data.totalScore) : data.grade;
  const diagnosticsCount = metadataDiagnosticCount(data);

  return {
    title: `${data.totalScore}/100 (${grade}) — AgentLinter Report`,
    description: `Agent workspace scored ${data.totalScore}/100 — ${data.filesScanned} files scanned, ${diagnosticsCount} issues found.`,
    openGraph: {
      title: `${data.totalScore}/100 (${grade}) — AgentLinter Report`,
      description: `Agent workspace scored ${data.totalScore}/100. ${data.filesScanned} files, ${diagnosticsCount} issues.`,
    },
    twitter: {
      card: "summary",
      title: `${data.totalScore}/100 (${grade}) — AgentLinter`,
    },
  };
}

export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const data = await fetchReport(id);
    if (!data) notFound();
    return <ReportClientLoader data={data} />;
  } catch (error) {
    console.error("Page render error:", error);
    notFound();
  }
}
