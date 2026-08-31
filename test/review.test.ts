import assert from "node:assert/strict";
import test from "node:test";
import { parseReview } from "../src/review.ts";

test("accepts exactly one PASS verdict line", () => {
  const result = parseReview("VERDICT: PASS\nThe files satisfy the task.");
  assert.equal(result.decision, "PASS");
  assert.match(result.feedback, /files satisfy/);
});

test("returns REVISE with actionable feedback", () => {
  const result = parseReview("The test still fails.\nVERDICT: REVISE\nAdd coverage for the empty input.");
  assert.equal(result.decision, "REVISE");
  assert.match(result.feedback, /empty input/);
});

test("treats missing and conflicting verdicts as ambiguous", () => {
  assert.equal(parseReview("Looks good, probably done.").decision, "AMBIGUOUS");
  assert.equal(parseReview("VERDICT: PASS\nVERDICT: REVISE").decision, "AMBIGUOUS");
});

test("does not accept a verdict embedded in prose", () => {
  const result = parseReview("I would write VERDICT: PASS if the task were complete.");
  assert.equal(result.decision, "AMBIGUOUS");
});
