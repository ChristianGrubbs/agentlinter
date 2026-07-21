// Shared by the Report API and the Run route so both write paths give
// diagnostics the same trust treatment before they reach the renderer.
export function sanitizeDiagnostics(diagnostics: any[]): any[] {
  return diagnostics.map((d) => ({
    severity: String(d.severity || "info").slice(0, 10),
    category: String(d.category || "").slice(0, 30),
    rule: String(d.rule || "").slice(0, 80),
    file: String(d.file || "").slice(0, 200),
    line: typeof d.line === "number" ? d.line : undefined,
    message: String(d.message || "").slice(0, 500),
    fix: d.fix ? String(d.fix).slice(0, 500) : undefined,
  }));
}
