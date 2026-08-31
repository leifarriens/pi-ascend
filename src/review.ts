import type { ReviewDecision } from "./types.ts";

export interface ParsedReview {
  decision: ReviewDecision;
  feedback: string;
}

const MAX_FEEDBACK_LENGTH = 4_000;
const VERDICT_LINE = /^\s*VERDICT\s*:\s*(PASS|REVISE)\s*$/gim;

function clip(text: string): string {
  const normalized = text.trim();
  if (normalized.length <= MAX_FEEDBACK_LENGTH) return normalized;
  return `${normalized.slice(0, MAX_FEEDBACK_LENGTH)}\n[feedback truncated]`;
}

export function parseReview(text: string): ParsedReview {
  const normalized = text.replace(/\r\n/g, "\n");
  const matches = [...normalized.matchAll(VERDICT_LINE)];

  if (matches.length !== 1) {
    const reason = matches.length === 0
      ? "No single VERDICT: PASS or VERDICT: REVISE line was found."
      : "More than one verdict line was found.";
    const raw = clip(normalized);
    return {
      decision: "AMBIGUOUS",
      feedback: raw
        ? `${reason}\nReviewer response:\n${raw}`
        : reason,
    };
  }

  const match = matches[0];
  const decision = match[1].toUpperCase() as Exclude<ReviewDecision, "AMBIGUOUS">;
  const withoutVerdict = `${normalized.slice(0, match.index)}\n${normalized.slice(
    (match.index ?? 0) + match[0].length,
  )}`;
  const feedback = clip(withoutVerdict);

  return {
    decision,
    feedback: feedback || (decision === "PASS" ? "Reviewer approved the implementation." : "Reviewer requested changes without additional feedback."),
  };
}
