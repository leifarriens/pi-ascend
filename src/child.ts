import { spawn, type ChildProcessWithoutNullStreams, type SpawnOptions } from "node:child_process";
import { Buffer } from "node:buffer";
import type { ChildRunOptions, ChildRunResult } from "./types.ts";

const READ_ONLY_TOOLS = "read,ls,grep,find";
const FORCE_KILL_DELAY_MS = 1_000;

export interface JsonAssistantText {
  text: string;
  parsedEvents: number;
  malformedLines: number;
}

export type SpawnFunction = (
  command: string,
  args: string[],
  options: SpawnOptions,
) => ChildProcessWithoutNullStreams;

const defaultSpawn: SpawnFunction = (command, args, options) =>
  spawn(command, args, options) as ChildProcessWithoutNullStreams;

function contentText(content: unknown): string {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";

  return content
    .map((block) => {
      if (!block || typeof block !== "object") return "";
      const candidate = block as { type?: unknown; text?: unknown };
      return candidate.type === "text" && typeof candidate.text === "string" ? candidate.text : "";
    })
    .filter(Boolean)
    .join("");
}

export function extractAssistantText(stdout: string): JsonAssistantText {
  let finalText = "";
  let streamedText = "";
  let parsedEvents = 0;
  let malformedLines = 0;

  for (const line of stdout.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed) continue;

    let event: unknown;
    try {
      event = JSON.parse(trimmed);
      parsedEvents += 1;
    } catch {
      malformedLines += 1;
      continue;
    }

    if (!event || typeof event !== "object") continue;
    const record = event as {
      type?: unknown;
      message?: { role?: unknown; content?: unknown };
      assistantMessageEvent?: { type?: unknown; delta?: unknown };
    };

    if (record.type === "message_end" && record.message?.role === "assistant") {
      finalText = contentText(record.message.content);
    }

    if (
      record.type === "message_update" &&
      record.assistantMessageEvent?.type === "text_delta" &&
      typeof record.assistantMessageEvent.delta === "string"
    ) {
      streamedText += record.assistantMessageEvent.delta;
    }
  }

  return {
    text: (finalText || streamedText).trim(),
    parsedEvents,
    malformedLines,
  };
}

export function buildChildArgs(options: Pick<ChildRunOptions, "model" | "role" | "prompt" | "thinkingLevel">): string[] {
  const args = [
    "--mode",
    "json",
    "--no-session",
    "--no-extensions",
    "--model",
    options.model,
  ];

  if (options.thinkingLevel) {
    args.push("--thinking", options.thinkingLevel);
  }

  if (options.role === "reviewer") {
    args.push("--tools", READ_ONLY_TOOLS);
  }

  args.push("--print", "--", options.prompt);
  return args;
}

function byteLength(value: string): number {
  return Buffer.byteLength(value, "utf8");
}

function appendWithinLimit(current: string, chunk: string, limit: number): { value: string; exceeded: boolean } {
  const remaining = limit - byteLength(current);
  if (remaining <= 0) return { value: current, exceeded: chunk.length > 0 };

  const encoded = Buffer.from(chunk, "utf8");
  if (encoded.byteLength <= remaining) {
    return { value: current + chunk, exceeded: false };
  }

  return {
    value: current + encoded.subarray(0, remaining).toString("utf8"),
    exceeded: true,
  };
}

function stoppedResult(options: ChildRunOptions, startedAt: number, reason: "aborted" | "timeout"): ChildRunResult {
  return {
    ok: false,
    exitCode: null,
    signal: null,
    stdout: "",
    stderr: "",
    assistantText: "",
    parsedEvents: 0,
    malformedLines: 0,
    timedOut: reason === "timeout",
    aborted: reason === "aborted",
    outputLimitExceeded: false,
    error: reason === "timeout" ? `Child exceeded the ${options.timeoutMs}ms timeout` : "Child cancelled",
    durationMs: Date.now() - startedAt,
  };
}

export async function runPiChild(
  options: ChildRunOptions,
  spawnImpl: SpawnFunction = defaultSpawn,
): Promise<ChildRunResult> {
  const startedAt = Date.now();
  if (options.signal?.aborted) return stoppedResult(options, startedAt, "aborted");

  const command = options.command ?? "pi";
  const args = buildChildArgs(options);
  if (options.debug) {
    console.error(`[pi-ascend] starting ${options.role} child: ${command} ${args.slice(0, -1).join(" ")} <prompt>`);
  }

  let child: ChildProcessWithoutNullStreams;
  try {
    child = spawnImpl(command, args, {
      cwd: options.cwd,
      stdio: ["ignore", "pipe", "pipe"],
      windowsHide: true,
    });
  } catch (error) {
    return {
      ok: false,
      exitCode: null,
      signal: null,
      stdout: "",
      stderr: "",
      assistantText: "",
      parsedEvents: 0,
      malformedLines: 0,
      timedOut: false,
      aborted: false,
      outputLimitExceeded: false,
      error: error instanceof Error ? error.message : String(error),
      durationMs: Date.now() - startedAt,
    };
  }

  return new Promise((resolve) => {
    let stdout = "";
    let stderr = "";
    let outputLimitExceeded = false;
    let termination: "aborted" | "timeout" | "output-limit" | undefined;
    let processError: string | undefined;
    let settled = false;
    let timeoutId: ReturnType<typeof setTimeout> | undefined;
    let forceKillId: ReturnType<typeof setTimeout> | undefined;

    const terminate = (reason: "aborted" | "timeout" | "output-limit") => {
      if (termination || settled) return;
      termination = reason;
      try {
        child.kill("SIGTERM");
      } catch {
        // The process may have exited between the check and kill.
      }
      forceKillId = setTimeout(() => {
        if (!settled) {
          try {
            child.kill("SIGKILL");
          } catch {
            // Best effort only.
          }
        }
      }, FORCE_KILL_DELAY_MS);
    };

    const onAbort = () => terminate("aborted");
    options.signal?.addEventListener("abort", onAbort, { once: true });

    child.stdout.on("data", (chunk: Buffer | string) => {
      const appended = appendWithinLimit(stdout, String(chunk), options.outputLimitBytes);
      stdout = appended.value;
      if (appended.exceeded) {
        outputLimitExceeded = true;
        terminate("output-limit");
      }
    });

    child.stderr.on("data", (chunk: Buffer | string) => {
      const appended = appendWithinLimit(stderr, String(chunk), options.outputLimitBytes);
      stderr = appended.value;
      if (appended.exceeded) {
        outputLimitExceeded = true;
        terminate("output-limit");
      }
    });

    const finish = (exitCode: number | null, signal: NodeJS.Signals | null) => {
      if (settled) return;
      settled = true;
      if (timeoutId) clearTimeout(timeoutId);
      if (forceKillId) clearTimeout(forceKillId);
      options.signal?.removeEventListener("abort", onAbort);

      const parsed = extractAssistantText(stdout);
      const error = termination === "timeout"
        ? `Child exceeded the ${options.timeoutMs}ms timeout`
        : termination === "aborted"
          ? "Child cancelled"
          : termination === "output-limit"
            ? `Child output exceeded ${options.outputLimitBytes} bytes`
            : processError ?? (exitCode === 0 ? undefined : `Child exited with code ${exitCode ?? "unknown"}${signal ? ` (${signal})` : ""}`);

      const result: ChildRunResult = {
        ok: exitCode === 0 && !termination && !processError && !outputLimitExceeded,
        exitCode,
        signal,
        stdout,
        stderr,
        assistantText: parsed.text,
        parsedEvents: parsed.parsedEvents,
        malformedLines: parsed.malformedLines,
        timedOut: termination === "timeout",
        aborted: termination === "aborted",
        outputLimitExceeded,
        error,
        durationMs: Date.now() - startedAt,
      };

      if (options.debug) {
        console.error(`[pi-ascend] ${options.role} child finished: ok=${result.ok} code=${exitCode ?? "none"} duration=${result.durationMs}ms`);
      }
      resolve(result);
    };

    child.once("error", (error) => {
      processError = error instanceof Error ? error.message : String(error);
      finish(null, null);
    });
    child.once("close", finish);
    timeoutId = setTimeout(() => terminate("timeout"), options.timeoutMs);
  });
}
