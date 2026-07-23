"use client";

import { useState } from "react";

export function useCopyReportLink() {
  const [copyState, setCopyState] = useState<"idle" | "copied" | "failed">("idle");

  async function copyReportLink() {
    try {
      await navigator.clipboard.writeText(window.location.href);
      setCopyState("copied");
    } catch {
      setCopyState("failed");
    } finally {
      window.setTimeout(() => setCopyState("idle"), 2000);
    }
  }

  return { copyState, copyReportLink };
}
