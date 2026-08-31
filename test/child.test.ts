import assert from "node:assert/strict";
import test from "node:test";
import { buildChildArgs, extractAssistantText } from "../src/child.ts";

test("extracts final assistant text from Pi JSONL events", () => {
  const output = [
    JSON.stringify({ type: "session", version: 3 }),
    JSON.stringify({
      type: "message_update",
      assistantMessageEvent: { type: "text_delta", delta: "partial" },
    }),
    JSON.stringify({
      type: "message_end",
      message: {
        role: "assistant",
        content: [
          { type: "thinking", thinking: "hidden" },
          { type: "text", text: "final answer" },
        ],
      },
    }),
  ].join("\n");

  assert.deepEqual(extractAssistantText(output), {
    text: "final answer",
    parsedEvents: 3,
    malformedLines: 0,
  });
});

test("falls back to text deltas and counts malformed lines", () => {
  const result = extractAssistantText('{"type":"message_update","assistantMessageEvent":{"type":"text_delta","delta":"hello"}}\nnot-json');
  assert.equal(result.text, "hello");
  assert.equal(result.parsedEvents, 1);
  assert.equal(result.malformedLines, 1);
});

test("gives reviewers only read-only tools and disables recursion", () => {
  const args = buildChildArgs({
    model: "openai/gpt-5",
    role: "reviewer",
    prompt: "Review this.",
  });

  assert.deepEqual(args.slice(0, 8), [
    "--mode", "json", "--no-session", "--no-extensions", "--model", "openai/gpt-5", "--tools", "read,ls,grep,find",
  ]);
  assert.deepEqual(args.slice(-3), ["--print", "--", "Review this."]);
});
