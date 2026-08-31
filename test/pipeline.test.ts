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

test("escalates sequentially and passes the latest feedback to the next implementation", async () => {
  const calls: ChildRunOptions[] = [];
  const config = loadConfig({
    PI_ASCEND_MODELS: "provider/stronger",
    PI_ASCEND_MAX_TIERS: "2",
  });

  const result = await runAscend("Implement the feature", {
    cwd: "/tmp/disposable-project",
    activeModel: "provider/active",
    config,
    runChild: async (options) => {
      calls.push(options);
      if (options.role === "implementation" && options.model === "provider/active") {
        return successfulChild("Initial attempt");
      }
      if (options.role === "reviewer" && options.model === "provider/active") {
        return successfulChild("VERDICT: REVISE\nHandle the empty input case.");
      }
      if (options.role === "implementation" && options.model === "provider/stronger") {
        assert.match(options.prompt, /Implement the feature/);
        assert.match(options.prompt, /Handle the empty input case/);
        return successfulChild("Improved attempt");
      }
      assert.equal(options.role, "reviewer");
      assert.equal(options.model, "provider/stronger");
      return successfulChild("VERDICT: PASS\nThe feature is complete.");
    },
  });

  assert.equal(result.status, "approved");
  assert.deepEqual(
    calls.map(({ role, model }) => `${role}:${model}`),
    [
      "implementation:provider/active",
      "reviewer:provider/active",
      "implementation:provider/stronger",
      "reviewer:provider/stronger",
    ],
  );
  assert.equal(result.history.length, 2);
  assert.equal(result.history[0].review?.decision, "REVISE");
  assert.equal(result.history[1].review?.decision, "PASS");
});
