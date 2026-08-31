import type { ModelTier } from "./types.ts";

const MAX_IMPLEMENTATION_SUMMARY_LENGTH = 12_000;

function section(title: string, value: string): string {
  return `\n--- ${title} ---\n${value.trim()}\n--- END ${title} ---\n`;
}

export function buildImplementationPrompt(
  task: string,
  tier: ModelTier,
  priorFeedback?: string,
): string {
  const feedback = priorFeedback
    ? section(
        "LATEST REVIEW FEEDBACK",
        `Treat this as guidance, verify it against the files, and address it where valid:\n${priorFeedback}`,
      )
    : "";

  return `You are the implementation stage of Pi Ascend, tier ${tier.tier}, using ${tier.model}.
Work directly in the current working directory. Implement the user's coding task completely and safely.
You may inspect and edit files and run appropriate tests. Do not commit, reset, stash, clean, or discard changes; preserve unrelated user work.
Inspect the existing project before making changes. Keep the change focused, idiomatic, and maintainable.
At the end, provide a concise summary of files changed, tests run, and any remaining concern.
${section("ORIGINAL CODING TASK", task)}${feedback}`;
}

export function buildReviewerPrompt(
  task: string,
  tier: ModelTier,
  implementationSummary: string,
  priorFeedback?: string,
): string {
  const previous = priorFeedback
    ? section("PREVIOUS REVIEW FEEDBACK", priorFeedback)
    : "";

  const boundedImplementationSummary = implementationSummary.length > MAX_IMPLEMENTATION_SUMMARY_LENGTH
    ? `${implementationSummary.slice(0, MAX_IMPLEMENTATION_SUMMARY_LENGTH)}\n[implementation summary truncated]`
    : implementationSummary;

  return `You are the read-only review stage of Pi Ascend, tier ${tier.tier}, using ${tier.model}.
Evaluate whether the current working directory now fully solves the original coding task.
Inspect relevant files with read-only tools only. Do not edit, write, delete, run commands, commit, reset, stash, or otherwise mutate anything.
Use the filesystem as the source of truth, not the implementation summary. Check correctness, completeness, regressions, and tests where the files make that possible.
A PASS means the task is solved well enough to stop. Otherwise use REVISE.
Your response must contain exactly one standalone verdict line in this exact format:
VERDICT: PASS
or
VERDICT: REVISE
Do not put either verdict phrase in quotes, examples, or any other line. Put your concise rationale and actionable feedback after the verdict line.
${section("ORIGINAL CODING TASK", task)}${section("LATEST IMPLEMENTATION SUMMARY", boundedImplementationSummary || "No textual summary was emitted; inspect the current files.")}${previous}`;
}
