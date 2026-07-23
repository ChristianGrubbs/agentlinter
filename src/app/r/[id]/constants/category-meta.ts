import type { ReportCategory } from "@/lib/localStore";

export const CATEGORY_META: Record<ReportCategory, {
  description: string;
  whyItMatters: string;
}> = {
  structure: {
    description: "How workspace instructions are organized across files, headings, and navigation aids.",
    whyItMatters: "Clear structure makes the written instruction hierarchy and document relationships easier to inspect.",
  },
  clarity: {
    description: "How specifically instructions state actions, triggers, exceptions, and defined terms.",
    whyItMatters: "Specific wording leaves fewer interpretations available when an instruction is applied.",
  },
  completeness: {
    description: "Which documented concerns are present, including tools, boundaries, memory, error handling, and workflows.",
    whyItMatters: "A completeness check identifies topics that the workspace does not explicitly document.",
  },
  security: {
    description: "Documented handling of credentials, untrusted instructions, permissions, and personal information.",
    whyItMatters: "These checks identify security-relevant patterns and missing safeguards in the scanned configuration.",
  },
  consistency: {
    description: "Whether files use compatible permissions, names, references, priorities, locales, and voice guidance.",
    whyItMatters: "Consistency checks surface places where two recorded instructions may be difficult to reconcile.",
  },
  memory: {
    description: "Documented session continuity, task tracking, context limits, and durable memory practices.",
    whyItMatters: "These checks show which continuity mechanisms are explicitly described in the workspace.",
  },
  runtime: {
    description: "Runtime configuration such as JSON validity, environment-variable references, timeouts, and permissions.",
    whyItMatters: "Runtime checks compare recorded configuration with the Engine rule catalog.",
  },
  skillSafety: {
    description: "Documentation, environment checks, error handling, security notes, and defaults for custom skills.",
    whyItMatters: "These checks describe the safeguards recorded for skill execution paths.",
  },
  remoteReady: {
    description: "Configuration intended to support remote or multi-environment operation.",
    whyItMatters: "These checks inspect whether environment-specific requirements are documented rather than embedded.",
  },
  blueprint: {
    description: "Coverage of identity, goals, constraints, memory, planning, and validation guidance.",
    whyItMatters: "The blueprint view records which of these configuration topics the Engine evaluated.",
  },
  freshness: {
    description: "File references and documented project commands checked against the scanned workspace.",
    whyItMatters: "Freshness findings identify references that may no longer match the workspace snapshot.",
  },
};
