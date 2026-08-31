export type ChildRole = "implementation" | "reviewer";

export type ReviewDecision = "PASS" | "REVISE" | "AMBIGUOUS";

export interface AscendConfig {
  /** Explicit escalation models. Tier 0 is added from the active Pi model. */
  models: string[];
  /** Total number of tiers, including the active model at tier 0. */
  maxTiers: number;
  /** Per-child wall-clock limit. */
  timeoutMs: number;
  /** Maximum stdout or stderr captured from one child. */
  outputLimitBytes: number;
  debug: boolean;
}

export interface ModelTier {
  tier: number;
  model: string;
}

export interface ChildRunOptions {
  cwd: string;
  model: string;
  role: ChildRole;
  prompt: string;
  timeoutMs: number;
  outputLimitBytes: number;
  signal?: AbortSignal;
  /** Used for tier 0 so the child follows the active session's thinking level. */
  thinkingLevel?: string;
  debug?: boolean;
  command?: string;
}

export interface ChildRunResult {
  ok: boolean;
  exitCode: number | null;
  signal: string | null;
  stdout: string;
  stderr: string;
  assistantText: string;
  parsedEvents: number;
  malformedLines: number;
  timedOut: boolean;
  aborted: boolean;
  outputLimitExceeded: boolean;
  error?: string;
  durationMs: number;
}

export interface ChildStageSummary {
  ok: boolean;
  exitCode: number | null;
  signal: string | null;
  durationMs: number;
  timedOut: boolean;
  aborted: boolean;
  outputLimitExceeded: boolean;
  error?: string;
  summary?: string;
}

export interface ReviewStageSummary extends ChildStageSummary {
  /** Omitted when the reviewer process failed before producing a verdict. */
  decision?: ReviewDecision;
  feedback?: string;
}

export interface TierHistory {
  tier: number;
  model: string;
  implementation: ChildStageSummary;
  review?: ReviewStageSummary;
}

export type AscendStatus = "approved" | "exhausted" | "failed" | "cancelled";

export interface AscendResult {
  status: AscendStatus;
  task: string;
  history: TierHistory[];
  finalFeedback?: string;
  error?: string;
}
