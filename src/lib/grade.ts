// Score → letter grade scale, shared by the Run route (Task 4) and the
// Dashboard (Task 6). Additive file — not one of the three upstream-modified files.
export function gradeFor(score: number): string {
  return score >= 95 ? "S" : score >= 90 ? "A+" : score >= 85 ? "A" : score >= 80 ? "A-" : score >= 75 ? "B+" : score >= 68 ? "B" : "C";
}
