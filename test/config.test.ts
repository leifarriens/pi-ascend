import assert from "node:assert/strict";
import test from "node:test";
import { buildModelTiers, loadConfig } from "../src/config.ts";

test("loads an explicit ordered escalation ladder", () => {
  const config = loadConfig({
    PI_ASCEND_MODELS: "anthropic/claude-sonnet, openai/gpt-5, anthropic/claude-sonnet",
    PI_ASCEND_MAX_TIERS: "3",
    PI_ASCEND_TIMEOUT_MS: "5000",
    PI_ASCEND_OUTPUT_LIMIT_BYTES: "65536",
    PI_ASCEND_DEBUG: "yes",
  });

  assert.deepEqual(config.models, ["anthropic/claude-sonnet", "openai/gpt-5"]);
  assert.equal(config.maxTiers, 3);
  assert.equal(config.timeoutMs, 5000);
  assert.equal(config.outputLimitBytes, 65536);
  assert.equal(config.debug, true);
});

test("tier zero is the active model and duplicate configured entries are skipped", () => {
  const config = loadConfig({
    PI_ASCEND_MODELS: "google/gemini-2.5-pro, openai/gpt-5",
  });

  assert.deepEqual(
    buildModelTiers("google/gemini-2.5-pro", config),
    [
      { tier: 0, model: "google/gemini-2.5-pro" },
      { tier: 1, model: "openai/gpt-5" },
    ],
  );
});

test("max tiers includes tier zero", () => {
  const config = loadConfig({
    PI_ASCEND_MODELS: "a/one,b/two,c/three",
    PI_ASCEND_MAX_TIERS: "2",
  });

  assert.deepEqual(buildModelTiers("active/model", config), [
    { tier: 0, model: "active/model" },
    { tier: 1, model: "a/one" },
  ]);
});

test("rejects malformed model and limit configuration", () => {
  assert.throws(
    () => loadConfig({ PI_ASCEND_MODELS: "just-a-model" }),
    /explicit provider\/model identifiers/,
  );
  assert.throws(
    () => loadConfig({ PI_ASCEND_MAX_TIERS: "99" }),
    /PI_ASCEND_MAX_TIERS/,
  );
  assert.throws(
    () => loadConfig({ PI_ASCEND_TIMEOUT_MS: "not-a-number" }),
    /PI_ASCEND_TIMEOUT_MS/,
  );
});
