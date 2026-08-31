import assert from "node:assert/strict";
import extension from "../index.ts";

type CommandDefinition = { description?: string; handler: (args: string, ctx: unknown) => unknown };

const commands = new Map<string, CommandDefinition>();
const fakePi = {
  on() {
    // Lifecycle registration is intentionally inert in this load smoke test.
  },
  registerCommand(name: string, definition: CommandDefinition) {
    commands.set(name, definition);
  },
};

extension(fakePi as never);
assert.equal(commands.has("ascend"), true);
assert.match(commands.get("ascend")?.description ?? "", /review/i);
console.log("Pi Ascend extension factory loaded and /ascend was registered.");
