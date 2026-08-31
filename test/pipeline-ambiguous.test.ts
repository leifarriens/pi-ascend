import assert from "node:assert/strict";
import test from "node:test";
import { loadConfig } from "../src/config.ts";
import { runAscend } from "../src/pipeline.ts";
import type { ChildRunOptions, ChildRunResult } from "../src/types.ts";

function successfulChild(assistantText: string): ChildRunResult {
  return {
    ok: true,
    exitCode: 0,
    signal: null,
    stdout: "",
    stderr: "",
    assistantText,
    parsedEvents: 1,
    malformedLines: 0,
    timedOut: false,
    aborted: false,
    outputLimitExceeded: false,
    durationMs: 1,
  };
}

test("does not treat an ambiguous review as approval when the ladder is exhausted", async () => {
  const calls: ChildRunOptions[] = [];
  const result = await runAscend("Do the task", {
    cwd: "/tmp/disposable-project",
    activeModel: "provider/active",
    config: loadConfig({ PI_ASCEND_MAX_TIERS: "1" }),
    runChild: async (options) => {
      calls.push(options);
      return successfulChild(options.role === "reviewer" ? "The result looks plausible." : "Done");
    },
  });

  assert.equal(result.status, "exhausted");
  assert.equal(result.history[0].review?.decision, "AMBIGUOUS");
  assert.equal(calls.length, 2);
});
