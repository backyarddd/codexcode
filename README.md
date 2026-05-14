# CodexCode

Race Claude Code and OpenAI Codex on the same coding task. Each agent
implements the prompt in isolation, then reviews the other's diff. You get
both diffs plus both critiques as a single artifact, and accept a result by
talking to your agent in plain English.

Three uses in one tool:

- Second opinion. Want to know what the other agent would have done.
- Head-to-head benchmark on a real task in your codebase.
- Selective merge. Take parts from each attempt and land a hybrid commit.

The cross-reviews are the centerpiece: each reviewer never sees its own
implementation, which produces unusually candid critiques.

---

## Prerequisites

| Requirement | Notes |
| --- | --- |
| git 2.20+ | required for worktrees |
| Node.js 20+ and npm | used to build and run the TypeScript CLI |
| Claude Code CLI (`claude`) | https://docs.claude.com/en/docs/claude-code |
| Codex CLI (`codex`) | `npm i -g @openai/codex` or https://github.com/openai/codex |
| bash | install script and entry shim |

The `install.sh` script will tell you exactly what is missing and show
platform-specific install commands.

## Install

```bash
git clone https://github.com/backyarddd/codexcode.git
cd codexcode
./install.sh
```

`install.sh` is idempotent. It:

1. Verifies Node.js 20+ and npm (prints install hints if missing).
2. Runs `npm install` and `npm run build`.
3. Warns if `claude` or `codex` is missing.
4. Symlinks `bin/codexcode` to `~/.local/bin/codexcode`.
5. Copies the Claude Code skill to `~/.claude/skills/codexcode/`.
6. Copies the Codex skill to `~/.codex/skills/codexcode/`.

Both skills invoke as `/codexcode <task>`.

Options: `--bin-dest DIR`, `--skip-plugin`, `--skip-skill`, `--dry-run`.

If you installed while Claude Code was already open and `/codexcode` does not
appear, restart Claude Code. Claude Code watches existing skill directories,
but creating the top-level `~/.claude/skills` directory for the first time is
only picked up on startup.

If the skill loads but says `codexcode` is not found, add `~/.local/bin` to the
shell profile used to start Claude Code, or run the installer with
`--bin-dest` pointing at a directory already on PATH.

Uninstall: remove `~/.claude/skills/codexcode`, `~/.codex/skills/codexcode`,
and the symlink.

A packaged plugin manifest is also shipped in the repo at
`claude-plugin/.claude-plugin/plugin.json` and
`codex-plugin/.codex-plugin/plugin.json` if you prefer the namespaced plugin
form (`/codexcode:codexcode`); the default install uses standalone skills so
the slash command stays bare `/codexcode`.

## Authenticate

CodexCode does not manage credentials. Each CLI handles its own login.

- Claude Code: run `claude` once to log in.
- Codex: run `codex login`.

`codexcode verify` only checks that both CLIs are on PATH and that `--version`
works. Auth errors surface on first use if you are logged out.

---

## Quick start

From inside either Claude Code or Codex:

```
/codexcode add a --json flag that prints parsed config as pretty JSON and exits
```

Whichever agent you invoked it from is the host. The other is the challenger.
Both implement the same prompt in isolated worktrees, both review each
other's diff, you get a comparison artifact, and you land a result by typing
something like "ship the host" or "use the challenger's logging but the
host's tests".

## How it works

```
host = the agent you invoked /codexcode from
challenger = the other agent, run headlessly

  preflight -> isolation -> race -> cross-review -> artifact -> acceptance
```

1. **Preflight.** Verifies both CLIs, refuses to run with a dirty tree.
2. **Isolation.** Creates two git worktrees off your current HEAD, one per
   agent, on ephemeral branches.
3. **Race.** The host (your live session) implements the prompt in its
   worktree. The challenger runs `claude -p` or `codex exec` headlessly in
   its worktree. The slower agent gates total time.
4. **Cross-review.** Once both diffs are captured, each agent reviews the
   other's diff in a disposable scratch directory containing only the prompt
   and the diff. The host review is written by your live Claude Code or Codex
   session. The challenger review runs headlessly. Neither reviewer sees its
   own implementation. Neither sees the other review.
5. **Artifact.** A single markdown document: both reviews up top, then a
   structural summary, then both diffs. It prints to stdout and is also saved
   to `~/.codexcode/sessions/<id>/artifact.md`.
6. **Acceptance.** You tell the host in plain English what to do. The host
   interprets, applies, commits on the original branch, and removes all
   isolation state.

---

## Natural-language acceptance

After the artifact, you stay in comparison mode. No menus, no accept commands.
Tell the host what you want. It picks the right action.

Accept everything from one side:

- "ship the host" / "go with yours" -> `codexcode apply <id> --from host`
- "go with the challenger" / "accept Codex" -> `codexcode apply <id> --from challenger`

Selective merge by file:

- "host's tests, challenger's implementation"
- "Codex's src/foo.py and Claude's tests/foo_test.py"

The host translates that into a `--files "host:path,challenger:path,..."`
spec, using `codexcode files <id> --side host` to enumerate when needed.

Hybrid composition:

- "compose the best of both manually"
- "host's structure, challenger's naming"

The host reads both versions with `codexcode show <id> --side <s> --path <p>`,
writes the chosen combination directly into the original tree, then commits.

Inspection (does not exit comparison mode):

- "show me Codex's foo.py" -> `codexcode show <id> --side challenger --path foo.py`
- "what files did the challenger touch?" -> `codexcode files <id> --side challenger`

Retry with a tweaked prompt:

- "retry but ask for tests this time" -> abandon, start fresh with the new prompt

Abandon:

- "scrap it" / "nevermind" -> `codexcode abandon <id>`, nothing committed

If the host is genuinely unsure what you mean, it asks one focused question.
Never a wall of options.

---

## The cross-review mechanic

Each review uses a fresh scratch directory containing exactly:

```
PROMPT.md         original task verbatim
OTHER_DIFF.patch  unified diff of the other agent's change
REVIEW.md         empty placeholder for the reviewer to fill in
```

The reviewer is asked to cover correctness, design choices, edge cases, code
quality, and what it would have done differently. It is forbidden from
modifying anything other than `REVIEW.md`.

The host review is done in the live slash-command session, so invoking
`/codexcode` inside Claude Code does not launch a second Claude Code reviewer;
invoking it inside Codex does not launch a second Codex reviewer. The
challenger review still runs headlessly because the challenger is not the
active window.

Reviews are blinded: neither reviewer is told which agent produced the diff,
neither sees its own implementation, and neither sees the other review.

In practice the two reviews tend to:

- Agree on real bugs. Agreement is strong evidence.
- Disagree on style. Single-reviewer style flags warrant skepticism.
- Surface different edge cases. The union is usually more thorough than what
  either agent would have produced alone.

The artifact puts both reviews above the diffs because they are what justifies
the cost of running two agents.

---

## Isolation and safety

| Phase | Agent | CWD | Notes |
| --- | --- | --- | --- |
| Host implementation | host CLI | `~/.codexcode/sessions/<id>/work/host` | git worktree off your HEAD |
| Challenger implementation | challenger CLI | `~/.codexcode/sessions/<id>/work/challenger` | separate worktree |
| Host review | live host session | `~/.codexcode/sessions/<id>/reviews/host_workspace` | disposable scratch |
| Challenger review | challenger CLI | `~/.codexcode/sessions/<id>/reviews/challenger_workspace` | disposable scratch |

Ephemeral branches are named `codexcode-<id>-claude-code` and
`codexcode-<id>-codex`. Both branches and both worktrees are removed on
accept or abandon. Nothing is pushed anywhere. The original branch only
changes when you tell the host to accept.

CodexCode refuses to start if the working tree is dirty so both agents see
the same starting point.

If a run crashes, `codexcode list` shows leftover sessions and
`codexcode abandon <id>` cleans up.

---

## Cost expectations

A run pays for three extra agent activities beyond your live host work: the
headless challenger implementation, the live host review, and the headless
challenger review. Implementations dominate cost; reviews are typically a
fraction of an implementation. Use CodexCode when the cost of the wrong answer
matters more than the cost of the run.

---

## End-to-end examples

### 1. Deciding between two refactor splits

Inside Claude Code, on a tangled `auth.py`:

```
/codexcode refactor src/auth.py into focused modules. Keep public API stable. No new dependencies. Update imports.
```

Claude splits into `auth/session.py`, `auth/permissions.py`,
`auth/middleware.py`. Codex chooses `auth/core.py`, `auth/handlers.py`,
`auth/utils.py`. Codex's review flags `permissions.py` as too broad. Claude's
review flags `utils.py` as a dumping ground. You say: "ship the host but
rename permissions.py to authorization.py". The host applies the host side,
renames the file in the original tree, and commits.

### 2. Head-to-head on a flaky test

Inside Codex:

```
/codexcode investigate the intermittent failure in tests/test_pagination.py and fix it. Do not change unrelated tests.
```

Codex finds a race in the fixture and replaces a sleep with an event.
Claude reaches the same conclusion but also rewrites the fixture to use an
async generator. Each review flags the other's extra scope or remaining
brittleness. You say "ship the host" because the smaller fix is more
obviously correct, and file the other finding as a follow-up.

### 3. Selective merge on a new feature

Inside Claude Code:

```
/codexcode add a --log-format flag with values text|json|logfmt. Structured fields include timestamp, level, message, kwargs. Add a smoke test.
```

Claude writes a custom JSON encoder plus a thorough smoke test. Codex uses
stdlib `logging` formatters with a smaller test. Each review praises the
other's smoke test and critiques the implementation choice. You say "take
the challenger's logging code but the host's smoke test". The host runs:

```
codexcode apply <id> --files "challenger:src/cli/logging.py,host:tests/test_logging.py"
git -C <repo> commit -am "add --log-format with text, json, logfmt"
codexcode cleanup <id>
```

---

## Troubleshooting

**`codexcode verify` says a CLI is missing.** Install it and retry. The
verify output prints the install command.

**A run fails with an auth error.** Log in to the affected CLI (`claude` or
`codex login`) and retry. CodexCode does not pre-check auth; the headless
invocation surfaces the real error.

**Working tree is not clean.** Commit, stash, or revert. CodexCode refuses
to start dirty so both agents see the same base.

**The challenger seems hung.** `codexcode status <id>` shows the last 4 KB
of its log. Kill the PID it reports and `codexcode abandon <id>` to clean up.

**A review is missing in the artifact.** The reviewer either timed out,
hit a rate limit, or refused to write `REVIEW.md`. Logs are under
`~/.codexcode/sessions/<id>/logs/`. For the challenger, re-run with
`codexcode review <id> --reviewer challenger`. For the live host, re-run
`codexcode prepare-review <id> --reviewer host`, write `REVIEW.md`, then run
`codexcode save-review <id> --reviewer host`. Reviews are idempotent and do
not rerun the implementations.

**Worktrees were not cleaned up after a crash.** `codexcode list` shows
leftover sessions; `codexcode abandon <id>` removes them.

**Node.js not found or too old.** Install Node.js 20+ and npm, then rerun
`./install.sh`. The entry shim prints platform-specific install hints.

---

## Limitations

- Two agents only. Adding more is out of scope.
- Selective merge is file-granular. Within-file mixing is done by hand in
  hybrid mode.
- Reviews can fail individually. The artifact still renders; rerun review.
- No retries framework. Rerun `start` or the relevant review command if needed.
- macOS and Linux only. Windows users need WSL.
- Requires git. Non-git projects are not supported.

---

## Subcommand reference

```
codexcode verify                                    check prerequisites
codexcode start --host <claude-code|codex>          prepare isolation, launch challenger
                --prompt TEXT [--prompt-file FILE]
                [--repo DIR]
codexcode status <id>                               session phase and challenger liveness
codexcode wait <id> [--poll N] [--timeout N]        block until challenger exits
codexcode submit <id> --side <host|challenger>      snapshot a worktree's diff
codexcode collect-challenger <id>                   shortcut for `submit --side challenger`
codexcode prepare-review <id> --reviewer <side>     create a review workspace
codexcode save-review <id> --reviewer <side>        save REVIEW.md from a review workspace
codexcode review <id> --reviewer <side>             run one headless review
codexcode review <id>                               legacy: run both reviews headlessly
codexcode artifact <id> [--out PATH]                render the comparison artifact
codexcode show <id> --side <s> --path <p>           print a file from a worktree
codexcode files <id> --side <s>                     list changed files in a worktree
codexcode apply <id> --from <host|challenger>       copy a side into the original tree
codexcode apply <id> --files "side:path,..."        per-file selection
codexcode cleanup <id>                              remove worktrees, branches, session dir
codexcode abandon <id>                              alias for cleanup
codexcode list                                      list active sessions
codexcode version                                   print version
```

All subcommands print JSON.

Environment overrides:

```
CODEXCODE_CLAUDE_FLAGS    override flags passed to `claude` invocations
CODEXCODE_CODEX_FLAGS     override flags passed to `codex` invocations
CODEXCODE_BIN_DEST        install.sh symlink target (default ~/.local/bin)
```
