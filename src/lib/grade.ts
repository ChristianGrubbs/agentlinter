export const GRADE_SCALE = [
  { grade: "S", min: 98 },
  { grade: "A+", min: 96 },
  { grade: "A", min: 93 },
  { grade: "A-", min: 90 },
  { grade: "B+", min: 85 },
  { grade: "B", min: 80 },
  { grade: "B-", min: 75 },
  { grade: "C+", min: 68 },
  { grade: "C", min: 60 },
  { grade: "C-", min: 55 },
  { grade: "D", min: 50 },
  { grade: "F", min: 0 },
] as const;

export function gradeFor(score: number): string {
  return GRADE_SCALE.find((tier) => score >= tier.min)?.grade ?? "F";
}
