export const RULE_EDUCATION: Record<string, {
  impact: string;
  example?: { bad: string; good: string };
}> = {
  "structure/heading-hierarchy": {
    impact: "Sequential heading levels make the document outline explicit.",
    example: {
      bad: "# Main Title\n### Subsection  ← skipped h2",
      good: "# Main Title\n## Section\n### Subsection",
    },
  },
  "consistency/language-mixing": {
    impact: "A primary language within each section makes the intended wording easier to review.",
    example: {
      bad: "이 파일을 read해서 check하고 update해야 함",
      good: "이 파일을 읽고, 확인하고, 업데이트해야 함\n(or: Read, check, and update this file)",
    },
  },
  "clarity/no-vague-instructions": {
    impact: "Measurable directions record what should happen without relying on an undefined qualifier.",
    example: {
      bad: "Be helpful and concise",
      good: "Answer in ≤3 sentences for simple questions. Use bullet points for complex answers.",
    },
  },
  "clarity/naked-conditional": {
    impact: "A measurable threshold gives a conditional an explicit trigger.",
    example: {
      bad: "If the response is too long, shorten it",
      good: "If the response exceeds 500 words, summarize in ≤3 bullet points",
    },
  },
  "clarity/escape-hatch-missing": {
    impact: "An exception or escalation path documents how an absolute instruction should handle a conflict.",
    example: {
      bad: "Never modify files without asking",
      good: "Never modify files without asking unless the user explicitly authorizes the edit in this conversation",
    },
  },
  "security/no-secrets": {
    impact: "Credential references can point to an environment variable instead of recording the credential value in configuration.",
    example: {
      bad: "credential: [redacted value]",
      good: "credential: $SERVICE_CREDENTIAL  # from environment",
    },
  },
  "security/has-injection-defense": {
    impact: "Injection-defense guidance documents how untrusted content should be treated.",
  },
  "consistency/referenced-files-exist": {
    impact: "An existing target lets a recorded file reference be followed and reviewed.",
  },
  "completeness/has-identity": {
    impact: "An identity section records the role and voice intended for the agent.",
  },
  "completeness/has-boundaries": {
    impact: "Explicit boundaries record which actions require confirmation or are out of scope.",
  },
};
