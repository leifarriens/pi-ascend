import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { loadConfig } from "./src/config.ts";
import { formatAscendResult, runAscend } from "./src/pipeline.ts";

const MAX_TASK_LENGTH = 100_000;

function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export default function (pi: ExtensionAPI): void {
  let running = false;
  let activeAbortController: AbortController | undefined;

  pi.on("session_shutdown", async () => {
    activeAbortController?.abort();
  });

  pi.registerCommand("ascend", {
    description: "Implement a coding problem, review it in a fresh read-only context, and escalate explicitly configured models when needed",
    handler: async (args, ctx) => {
      const task = args.trim();
      if (!task) {
        const message = "Usage: /ascend <coding problem>";
        if (ctx.hasUI) ctx.ui.notify(message, "warning");
        else console.error(message);
        return;
      }
      if (task.length > MAX_TASK_LENGTH) {
        const message = `The coding problem is too long; keep it under ${MAX_TASK_LENGTH} characters.`;
        if (ctx.hasUI) ctx.ui.notify(message, "warning");
        else console.error(message);
        return;
      }

      if (running) {
        const message = "Pi Ascend is already running. Wait for it to finish before starting another pipeline.";
        if (ctx.hasUI) ctx.ui.notify(message, "warning");
        else console.error(message);
        return;
      }

      running = true;
      const abortController = new AbortController();
      activeAbortController = abortController;
      const parentAbort = () => abortController.abort();
      ctx.signal?.addEventListener("abort", parentAbort, { once: true });
      if (ctx.signal?.aborted) abortController.abort();
      let debug = false;
      const setProgress = (message: string) => {
        if (ctx.hasUI) ctx.ui.setStatus("pi-ascend", message);
        if (debug) console.error(`[pi-ascend] ${message}`);
      };

      try {
        await ctx.waitForIdle();
        const config = loadConfig();
        debug = config.debug;
        const activeModel = ctx.model;
        if (!activeModel) throw new Error("No active Pi model is available for tier 0.");

        const activeModelRef = `${activeModel.provider}/${activeModel.id}`;
        const result = await runAscend(task, {
          cwd: ctx.cwd,
          activeModel: activeModelRef,
          thinkingLevel: ctx.thinkingLevel,
          config,
          signal: abortController.signal,
          onProgress: setProgress,
        });
        const summary = formatAscendResult(result);
        const level = result.status === "approved" ? "info" : result.status === "cancelled" ? "warning" : "error";

        if (ctx.hasUI) ctx.ui.notify(summary, level);
        else console.error(summary);
      } catch (error) {
        const message = `Pi Ascend stopped before completion: ${errorText(error)}`;
        if (ctx.hasUI) ctx.ui.notify(message, "error");
        else console.error(message);
      } finally {
        ctx.signal?.removeEventListener("abort", parentAbort);
        if (activeAbortController === abortController) activeAbortController = undefined;
        if (ctx.hasUI) ctx.ui.setStatus("pi-ascend", undefined);
        running = false;
      }
    },
  });
}
