# Pi Ascend

Pi Ascend is a small Pi extension that makes a bounded implementation and review loop available as `/ascend`. It is designed for tasks where a first coding attempt should be checked before asking a stronger, explicitly selected model to try again.

The extension runs child `pi` processes in the current working directory:

1. Tier 0 uses the active model in the parent Pi session.
2. An implementation child receives the task and may inspect, edit, and test the current project.
3. A fresh reviewer child receives the task and implementation summary. It has only `read`, `ls`, `grep`, and `find` tools, so it cannot edit or run commands.
4. A reviewer must emit exactly one `VERDICT: PASS` or `VERDICT: REVISE` line. Only `PASS` stops the loop. A rejection or an ambiguous/missing verdict moves to the next configured tier.
5. Every later implementation child gets the original task and the latest review feedback. The process stops at approval or when the ordered ladder is exhausted.

This is process and context isolation, not a filesystem sandbox. Implementation children intentionally share the current working directory so their changes are available to the next reviewer and attempt. **The implementation child can modify files in the current cwd. Do not run `/ascend` in a real repository unless those edits are intended.** Pi Ascend never automatically commits, resets, stashes, cleans, or discards changes.

## Command

Start Pi in a project and run:

```text
/ascend Add a small health endpoint, update its tests, and document how to use it.
```

The argument is the complete coding problem and is limited to 100,000 characters. An empty argument prints usage. The final notification includes the status, every tier/model, implementation process result, reviewer verdict, and latest feedback. In non-TUI modes the summary is written to stderr so it does not corrupt Pi's JSON event stream.

## Configuration

The active model is always tier 0. Configure only the stronger tiers with the comma-separated `PI_ASCEND_MODELS` environment variable. Entries are passed to Pi exactly as written and must be explicit `provider/model` identifiers. Their order is the escalation order. Pi Ascend does not infer that a model is stronger from its name.

```bash
export PI_ASCEND_MODELS="openai/gpt-5,anthropic/claude-opus-4-5"
export PI_ASCEND_MAX_TIERS=3
export PI_ASCEND_TIMEOUT_MS=600000
export PI_ASCEND_OUTPUT_LIMIT_BYTES=8388608
```

`PI_ASCEND_MAX_TIERS` includes tier 0. The default is 4 and the hard maximum is 8. Duplicate model identifiers are skipped. If the active model appears in `PI_ASCEND_MODELS`, it is not run a second time.

Supported limits:

| Variable | Default | Allowed range |
| --- | ---: | ---: |
| `PI_ASCEND_MAX_TIERS` | `4` | `1` to `8` |
| `PI_ASCEND_TIMEOUT_MS` | `600000` (10 minutes) | `1000` to `1800000` (30 minutes) |
| `PI_ASCEND_OUTPUT_LIMIT_BYTES` | `8388608` (8 MiB) | `65536` to `33554432` |
| `PI_ASCEND_DEBUG` | disabled | `1`, `true`, `yes`, `on` (or a false value) |

Each implementation and review child has its own timeout and stdout/stderr capture limit. Implementation summaries inserted into reviewer prompts are capped at 12,000 characters. A timed-out, cancelled, failed, or over-limit child stops the pipeline safely rather than silently escalating. `PI_ASCEND_DEBUG=1` logs stage and child-process details to stderr.

The child command always includes:

- `--mode json`, so Pi's JSONL event stream can be parsed without scraping terminal output.
- `--no-session`, so child work is ephemeral and does not create session files.
- `--no-extensions`, so Pi Ascend cannot recursively load itself or other extensions.
- `--model <provider/model>` for an explicit model selection.
- `--tools read,ls,grep,find` for reviewers. Implementation children use Pi's normal coding tools.

## Reviewer behavior

The reviewer is given the original task, the current cwd, and the latest implementation summary. It is explicitly told to inspect the files and not mutate anything. The parser accepts a verdict only when there is exactly one standalone line matching one of these forms:

```text
VERDICT: PASS
VERDICT: REVISE
```

A missing, duplicated, or otherwise ambiguous verdict is treated as `AMBIGUOUS`, which is not approval and causes escalation when another configured tier exists. A failed reviewer process is different from an ambiguous response and stops the pipeline with an error. This avoids hiding provider, authentication, or child-process failures.

## Local installation and testing

Pi must be installed and available as `pi` on `PATH`. The model used by tier 0 and every configured tier must be available to Pi and authenticated with its provider. Use Pi's normal model/auth setup, for example:

```bash
pi --list-models
pi auth --help
```

Select the parent active model with Pi's `/model` command or the normal `--model provider/model` option. Configure credentials according to the provider. Pi Ascend does not include or proxy credentials.

This project has no runtime npm dependency beyond the Pi host. Its development dependencies are only used for local TypeScript checking. From the extension directory:

```bash
cd /home/leif/pi-ascend
npm install
npm test
npm run smoke
npm run typecheck
```

These commands do not call an LLM or modify a project. `npm test` covers configuration, JSONL extraction, and verdict parsing. `npm run smoke` imports the extension and verifies that the default factory registers `/ascend`. `npm run typecheck` checks the extension with the installed Pi declarations.

### One-off extension load

For a quick manual load from this directory, use either documented Pi spelling:

```bash
cd /home/leif/pi-ascend
pi -e ./index.ts --no-session
# In the Pi prompt: /ascend Print a short plan for adding a harmless smoke-test file.
```

or:

```bash
cd /home/leif/pi-ascend
pi --extension ./index.ts --no-session
```

The cwd in those commands is the extension directory. Do not ask the implementation child to edit this source tree unless that is intentional. For an actual manual run, launch Pi from a disposable project as shown below and use an absolute extension path.

### Global auto-discovery

Pi auto-discovers global extensions under `~/.pi/agent/extensions`. Symlink the complete project directory so the helper modules remain next to `index.ts`:

```bash
mkdir -p ~/.pi/agent/extensions
ln -sfn /home/leif/pi-ascend ~/.pi/agent/extensions/pi-ascend
cd /path/to/a/project
pi
```

Then use `/ascend <problem>`. A copy also works:

```bash
cp -a /home/leif/pi-ascend ~/.pi/agent/extensions/pi-ascend
```

### Project-local auto-discovery

For one project only, put the complete extension directory under `.pi/extensions`:

```bash
mkdir -p /path/to/project/.pi/extensions
ln -sfn /home/leif/pi-ascend /path/to/project/.pi/extensions/pi-ascend
cd /path/to/project
pi -a
```

Project-local extensions are subject to Pi project trust. In interactive mode, approve the project when prompted, or use `-a` / `--approve` when you explicitly trust its local files. `--no-approve` prevents that trust for a run. The child processes still use `--no-extensions`, regardless of how the parent extension was loaded.

### Safe disposable-project exercise

Use a temporary directory and a harmless task. This invokes the real model, so provider authentication is still required, but it does not touch a real repository:

```bash
set -eu
tmp_dir="$(mktemp -d)"
trap 'rm -rf "$tmp_dir"' EXIT
printf '# Pi Ascend disposable smoke project\n' > "$tmp_dir/README.md"
cd "$tmp_dir"
PI_ASCEND_MAX_TIERS=1 pi --no-session --extension /home/leif/pi-ascend/index.ts
```

At the prompt, use a task such as:

```text
/ascend Create hello.txt containing exactly the word hello, and do not change README.md.
```

The parent and all children are no-session runs, and the temporary directory is removed on exit. The task still allows an implementation model to write inside that temporary cwd. Never substitute a real repository for `$tmp_dir` unless you intend to accept the edits.

For parsing and configuration changes without any model call, run `npm test`, `npm run smoke`, and `npm run typecheck` from `/home/leif/pi-ascend`. For verbose parent startup diagnostics, add `--verbose`; for Pi Ascend stage and child diagnostics, set `PI_ASCEND_DEBUG=1`.

## Limitations

- The child executable must be named `pi` and be available on `PATH`.
- The implementation is intentionally not a git worktree sandbox. It shares the cwd and can leave partial edits if a child fails or is cancelled. Review the diff before continuing.
- The reviewer cannot run tests because it is restricted to read-only tools. It can inspect test files and implementation output, but it cannot independently execute the test suite.
- There is one implementation and one reviewer process per attempted tier. Failed child processes stop rather than being retried automatically.
- Pi Ascend does not validate that configured models are semantically stronger or available before starting. Pi reports model and authentication errors when a tier is reached.
