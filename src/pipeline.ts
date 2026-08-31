import { buildModelTiers } from "./config.ts";
import { runPiChild } from "./child.ts";
import { buildImplementationPrompt, buildReviewerPrompt } from "./prompts.ts";
import { parseReview } from "./review.ts";
import type {
  AscendConfig,
  AscendResult,
  ChildRunOptions,
  ChildRunResult,
  ChildStageSummary,
  ModelTier,
  ReviewStageSummary,
  TierHistory,
} from "./types.ts";

export interface PipelineOptions {
  cwd: string;
  activeModel: string;
  thinkingLevel?: string;
  config: AscendConfig;
  signal?: AbortSignal;
  onProgress?: (message: string) => void;
  runChild?: (options: ChildRunOptions) => Promise<ChildRunResult>;
}

const MAX_DISPLAY_TASK_LENGTH = 500;
const MAX_DISPLAY_SUMMARY_LENGTH = 800;
const MAX_DISPLAY_FEEDBACK_LENGTH = 1_200;

function clip(text: string | undefined, maxLength: number): string {
  const normalized = (text ?? "").trim().replace(/\s+/g, " ");
  if (normalized.length <= maxLength) return normalized;
  return `${normalized.slice(0, maxLength)}...`;
}

function progress(options: PipelineOptions, message: string): void {
  options.onProgress?.(message);
}

function childSummary(result: ChildRunResult): ChildStageSummary {
  return {
    ok: result.ok,
    exitCode: result.exitCode,
    signal: result.signal,
    durationMs: result.durationMs,
    timedOut: result.timedOut,
    aborted: result.aborted,
    outputLimitExceeded: result.outputLimitExceeded,
    error: result.error,
    summary: clip(result.assistantText, MAX_DISPLAY_SUMMARY_LENGTH) || undefined,
  };
}

function failureMessage(role: string, tier: ModelTier, result: ChildRunResult): string {
  return `${role} child failed at tier ${tier.tier} (${tier.model}): ${result.error ?? "unknown child process failure"}`;
}

function cancelledResult(task: string, history: TierHistory[], feedback?: string): AscendResult {
  return {
    status: "cancelled",
    task,
    history,
    finalFeedback: feedback,
  };
}

export async function runAscend(task: string, options: PipelineOptions): Promise<AscendResult> {
  const runChild = options.runChild ?? runPiChild;
  const tiers = buildModelTiers(options.activeModel, options.config);
  const history: TierHistory[] = [];
  let latestFeedback: string | undefined;

  for (const tier of tiers) {
    if (options.signal?.aborted) return cancelledResult(task, history, latestFeedback);

    progress(options, `Tier ${tier.tier}/${tiers.length - 1}: implementation with ${tier.model}`);
    const implementation = await runChild({
      cwd: options.cwd,
      model: tier.model,
      role: "implementation",
      prompt: buildImplementationPrompt(task, tier, latestFeedback),
      timeoutMs: options.config.timeoutMs,
      outputLimitBytes: options.config.outputLimitBytes,
      signal: options.signal,
      thinkingLevel: tier.tier === 0 ? options.thinkingLevel : undefined,
      debug: options.config.debug,
    });

    const stage: TierHistory = {
      tier: tier.tier,
      model: tier.model,
      implementation: childSummary(implementation),
    };
    history.push(stage);

    if (implementation.aborted || options.signal?.aborted) {
      return cancelledResult(task, history, latestFeedback);
    }
    if (!implementation.ok) {
      return {
        status: "failed",
        task,
        history,
        finalFeedback: latestFeedback,
        error: failureMessage("Implementation", tier, implementation),
      };
    }

    progress(options, `Tier ${tier.tier}/${tiers.length - 1}: read-only review with ${tier.model}`);
    const reviewRun = await runChild({
      cwd: options.cwd,
      model: tier.model,
      role: "reviewer",
      prompt: buildReviewerPrompt(task, tier, implementation.assistantText, latestFeedback),
      timeoutMs: options.config.timeoutMs,
      outputLimitBytes: options.config.outputLimitBytes,
      signal: options.signal,
      debug: options.config.debug,
    });

    if (reviewRun.aborted || options.signal?.aborted) {
      stage.review = {
        ...childSummary(reviewRun),
        feedback: reviewRun.error ?? "Review cancelled",
      };
      return cancelledResult(task, history, stage.review.feedback);
    }
    if (!reviewRun.ok) {
      stage.review = {
        ...childSummary(reviewRun),
        feedback: reviewRun.error ?? "Reviewer process failed before producing a verdict",
      };
      return {
        status: "failed",
        task,
        history,
        finalFeedback: latestFeedback,
        error: failureMessage("Reviewer", tier, reviewRun),
      };
    }

    const review = parseReview(reviewRun.assistantText);
    const reviewSummary: ReviewStageSummary = {
      ...childSummary(reviewRun),
      decision: review.decision,
      feedback: review.feedback,
    };
    stage.review = reviewSummary;
    latestFeedback = review.feedback;

    if (review.decision === "PASS") {
      return {
        status: "approved",
        task,
        history,
        finalFeedback: review.feedback,
      };
    }

    if (tier.tier === tiers.length - 1) {
      return {
        status: "exhausted",
        task,
        history,
        finalFeedback: review.feedback,
      };
    }

    progress(options, `Tier ${tier.tier} was not approved; escalating to the next configured model`);
  }

  return {
    status: "exhausted",
    task,
    history,
    finalFeedback: latestFeedback,
  };
}

function stageStatus(stage: ChildStageSummary): string {
  if (stage.ok) return `completed in ${stage.durationMs}ms`;
  if (stage.aborted) return "cancelled";
  if (stage.timedOut) return "timed out";
  if (stage.outputLimitExceeded) return "stopped at output limit";
  return `failed${stage.error ? `: ${stage.error}` : ""}`;
}

export function formatAscendResult(result: AscendResult): string {
  const status = result.status === "approved"
    ? "APPROVED"
    : result.status === "exhausted"
      ? "LADDER EXHAUSTED"
      : result.status.toUpperCase();
  const lines = [
    `Pi Ascend: ${status}`,
    `Task: ${clip(result.task, MAX_DISPLAY_TASK_LENGTH)}`,
    "Model and review history:",
  ];

  if (result.history.length === 0) lines.push("  No child stages were started.");
  for (const stage of result.history) {
    lines.push(`  Tier ${stage.tier} - ${stage.model}`);
    lines.push(`    Implementation: ${stageStatus(stage.implementation)}`);
    if (stage.implementation.summary) {
      lines.push(`    Implementation summary: ${stage.implementation.summary}`);
    }
    if (stage.review) {
      lines.push(`    Reviewer: ${stage.review.decision ?? "FAILED"} (${stageStatus(stage.review)})`);
      if (stage.review.feedback) {
        lines.push(`    Reviewer feedback: ${clip(stage.review.feedback, MAX_DISPLAY_FEEDBACK_LENGTH)}`);
      }
    } else {
      lines.push("    Reviewer: not run");
    }
  }

  if (result.error) lines.push(`Error: ${result.error}`);
  if (result.finalFeedback && result.status !== "approved") {
    lines.push(`Latest feedback: ${clip(result.finalFeedback, MAX_DISPLAY_FEEDBACK_LENGTH)}`);
  }
  if (result.status === "exhausted") {
    lines.push("No further configured model tier was available; inspect the latest feedback before continuing manually.");
  }
  return lines.join("\n");
}
