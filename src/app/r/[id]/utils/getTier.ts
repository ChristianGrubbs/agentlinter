export function getTier(score: number) {
  if (score >= 98) return { grade: "S", color: "#c084fc", bg: "#c084fc18" };
  if (score >= 96) return { grade: "A+", color: "#a78bfa", bg: "#a78bfa18" };
  if (score >= 93) return { grade: "A", color: "#818cf8", bg: "#818cf818" };
  if (score >= 90) return { grade: "A-", color: "#60a5fa", bg: "#60a5fa18" };
  if (score >= 85) return { grade: "B+", color: "#34d399", bg: "#34d39918" };
  if (score >= 80) return { grade: "B", color: "#4ade80", bg: "#4ade8018" };
  if (score >= 75) return { grade: "B-", color: "#a3e635", bg: "#a3e63518" };
  if (score >= 68) return { grade: "C+", color: "#fbbf24", bg: "#fbbf2418" };
  if (score >= 60) return { grade: "C", color: "#f59e0b", bg: "#f59e0b18" };
  if (score >= 55) return { grade: "C-", color: "#fb923c", bg: "#fb923c18" };
  if (score >= 50) return { grade: "D", color: "#ef4444", bg: "#ef444418" };
  return { grade: "F", color: "#991b1b", bg: "#991b1b18" };
}
