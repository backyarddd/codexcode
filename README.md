# CodexCode

Race Claude Code and OpenAI Codex on the same coding task. Have each agent
critique the other's implementation. Accept a result by talking to your agent
in plain English.

CodexCode is three tools in one:

1. **A second-opinion generator.** You wanted Claude's answer but you also
   want to know what Codex would have done, or vice versa.
2. **A head-to-head benchmark.** Pick a real task, let both agents take a
   swing, see how they differ in practice on your codebase.
3. **A selective-merge composer.** Take the best parts of each attempt and
   land a hybrid commit guided by natural language.

The cross-reviews are the centerpiece. Each agent reviews the other's diff
without seeing its own implementation, which produces unusually candid
critiques.

---

## Table of contents

- [How it works](#how-it-works)
- [Prerequisites](#prerequisites)
- [Install](#install)
- [Authenticate the two CLIs](#authenticate-the-two-clis)
- [Quick start](#quick-start)
- [Full usage walkthrough](#full-usage-walkthrough)
- [Natural-language acceptance patterns](#natural-language-acceptance-patterns)
- [The cross-review mechanic in detail](#the-cross-review-mechanic-in-detail)
- [Isolation and safety model](#isolation-and-safety-model)
- [Cost expectations](#cost-expectations)
- [End-to-end examples](#end-to-end-examples)
- [Troubleshooting](#troubleshooting)
- [Known limitations](#known-limitations)
- [FAQ](#faq)
- [Reference: every codexcode subcommand](#reference-every-codexcode-subcommand)

---

## How it works

Whichever agent you invoke CodexCode from is the **host**. The other agent is
the **challenger**.

```
You type /codexcode "..."  inside  Claude Code  ->  host = Claude Code,  challenger = Codex
You type /codexcode "..."  inside  Codex        ->  host = Codex,        challenger = Claude Code
```

The flow is identical in both directions:

1. **Preflight.** CodexCode checks that both CLIs are installed, both are
   authenticated, and that your repo's working tree is clean.
2. **Isolation.** CodexCode creates two git worktrees off your current commit,
   one per agent. Each agent works only inside its own worktree.
3. **Race.** The host agent (your live session) implements the prompt directly
   in its worktree. The challenger runs headlessly in the background in its
   worktree. Neither agent can see the other.
4. **Cross-review.** Once both implementations are captured as diffs, each
   agent reviews the other's diff in parallel, headlessly, in a disposable
   scratch directory. Neither reviewer sees its own implementation, and
   neither sees the other review.
5. **Artifact.** CodexCode renders a single markdown artifact: both reviews
   in full, a structural summary, both diffs, and the original prompt.
6. **Acceptance.** You tell the host agent in plain English what to do.
   It interprets, applies, commits, and removes all isolation state.

---

## Prerequisites

| Requirement | Why |
| --- | --- |
| **git 2.20+** | git worktrees |
| **Python 3.8+** | the orchestrator (stdlib only, no pip install) |
| **Claude Code CLI** (`claude`) | one of the two racers |
| **OpenAI Codex CLI** (`codex`) | the other racer |
| **bash** | the entry shim and installer |

CodexCode itself has no third-party Python dependencies. It uses only the
standard library so it runs against system Python on macOS and most Linux
distros without a virtualenv.

### Installing each prerequisite

- **Python 3.8+**

  ```
  macOS (Homebrew):    brew install python
  macOS (no Homebrew): xcode-select --install
  Debian / Ubuntu:     sudo apt-get install -y python3
  Fedora / RHEL:       sudo dnf install -y python3
  Arch Linux:          sudo pacman -S python
  Windows (winget):    winget install Python.Python.3
  ```

- **Claude Code CLI.** Follow the install guide at
  <https://docs.claude.com/en/docs/claude-code>. Verify with `claude --version`.

- **OpenAI Codex CLI.** `npm install -g @openai/codex` (or follow
  <https://github.com/openai/codex>). Verify with `codex --version`.

---

## Install

```bash
git clone https://github.com/backyarddd/codexcode.git
cd codexcode
./install.sh
```

`install.sh` is idempotent. It will:

1. Verify Python 3.8+ is on PATH (and print install hints if not).
2. Warn (but not abort) if `claude` or `codex` is missing.
3. Symlink `bin/codexcode` into `~/.local/bin/codexcode`.
4. Copy the Claude Code skill to `~/.claude/skills/codexcode/` so it invokes as `/codexcode`.
5. Copy the Codex skill to `~/.codex/skills/codexcode/` so it invokes as `/codexcode`.

Options:

```
./install.sh --bin-dest /usr/local/bin     # symlink target
./install.sh --skip-plugin                 # skip Claude Code skill copy
./install.sh --skip-skill                  # skip Codex skill copy
./install.sh --dry-run                     # show what would happen
```

To uninstall: delete `~/.claude/skills/codexcode`, `~/.codex/skills/codexcode`,
and the symlink at `~/.local/bin/codexcode` (or wherever you pointed it).

The source tree also ships a packaged plugin manifest for each side
(`claude-plugin/.claude-plugin/plugin.json` and
`codex-plugin/.codex-plugin/plugin.json`). The default install path uses the
standalone skill layout because plugin slash commands are always namespaced as
`/plugin-name:skill-name`, which would produce `/codexcode:codexcode`. If you
prefer the namespaced form, copy the corresponding `*-plugin/` directory into
`~/.claude/plugins/codexcode/` or `~/.codex/plugins/codexcode/`.

### Verifying the install

```bash
codexcode verify
```

Run this from inside a git repo. It exits zero on success and prints a list of
specific problems on failure (missing CLI, unauthenticated CLI, dirty tree,
git not available, Python too old).

---

## Authenticate the two CLIs

CodexCode does not manage credentials. It just shells out to `claude` and
`codex`, and those CLIs handle their own login state. You only need to do
this once per machine.

**Claude Code.** Run `claude` once in your terminal and complete the login.
Then `claude --version` should work without any prompts.

**OpenAI Codex.** Run `codex login` and follow the prompts. Then
`codex --version` should work.

`codexcode verify` checks that both CLIs are on PATH and that `--version`
works for each. It does not try to second-guess your login state; if either
CLI is logged out, the headless invocation will tell you so clearly when the
race starts.

---

## Quick start

From inside Claude Code:

```
/codexcode add a CLI flag --json that prints the parsed config as pretty JSON and exits
```

From inside the Codex CLI:

```
/codexcode add a CLI flag --json that prints the parsed config as pretty JSON and exits
```

Either invocation:

1. Verifies prerequisites.
2. Creates two worktrees off your current branch.
3. Spawns the other agent headlessly in the background.
4. Has the host agent (your live session) implement the prompt in its worktree.
5. Captures both diffs.
6. Has each agent review the other's diff in parallel.
7. Prints the comparison artifact.
8. Waits for your plain-English instructions.

Then you say something like "ship the host" or "take the host's tests and the
challenger's implementation" and CodexCode lands a clean commit on your
original branch and tears down the worktrees.

---

## Full usage walkthrough

This walks through what actually happens from the moment you invoke the
command until you have a commit on your branch.

### 0. Preflight (~1 second)

`codexcode verify` checks:

- `git`, `python3`, `claude`, `codex` all on PATH
- Each CLI passes `--version`
- Your working tree is clean

Failures are aggregated and printed. The host agent is instructed to surface
them verbatim.

### 1. Setup (~1 second)

`codexcode start --host <claude-code|codex> --prompt "..."` does, atomically:

- Creates a session id (10 hex chars).
- Captures the current branch and HEAD commit as the **base**.
- Creates `~/.codexcode/sessions/<id>/work/host` (git worktree on branch
  `codexcode-<id>-<host>`).
- Creates `~/.codexcode/sessions/<id>/work/challenger` (git worktree on branch
  `codexcode-<id>-<challenger>`).
- Spawns the challenger CLI in `work/challenger` in the background, with
  combined output streaming to `~/.codexcode/sessions/<id>/logs/challenger.log`.
- Prints the session id, both worktree paths, and the challenger PID.

The challenger runs with the documented permission-bypass flag for its CLI
(`--dangerously-skip-permissions` for Claude Code,
`--dangerously-bypass-approvals-and-sandbox` for Codex). You can swap these
flags via `CODEXCODE_CLAUDE_FLAGS` and `CODEXCODE_CODEX_FLAGS` if you prefer a
stricter or weaker permission model.

### 2. Host implementation (most of the wall-clock time)

The host agent (the session you typed the command into) implements the prompt
in its worktree. From the user's perspective this looks like a normal coding
session, just rooted in a different directory. The plugin and skill both
instruct the host to never glance at the challenger worktree or its log during
this phase.

When the host is done, the plugin runs `codexcode submit <id> --side host`,
which captures the host worktree's diff against the base commit and stores it
in the session directory.

### 3. Wait (gated by the slower agent)

The host runs `codexcode wait <id>`, which blocks until the challenger
process exits. While blocked, it polls in the background and you can ask the
agent for progress; the agent can run `codexcode status <id>` to peek at the
last 4 KB of the challenger log without disturbing it.

Once the challenger exits, the host runs `codexcode collect-challenger <id>`
to snapshot the challenger's diff.

### 4. Cross-reviews (parallel, headless)

`codexcode review <id>` spawns both reviews in parallel:

- The host agent reviews the challenger's diff in a fresh scratch directory
  containing `PROMPT.md` and `OTHER_DIFF.patch`. It writes `REVIEW.md`.
- The challenger agent reviews the host's diff in a separate fresh scratch
  directory containing its own `PROMPT.md` and `OTHER_DIFF.patch`. It writes
  its own `REVIEW.md`.

Both run with the same review prompt (see `src/codexcode/review.py`). The
review prompt forbids modifying anything but `REVIEW.md` and asks for a
candid critique covering correctness, design choices, edge cases, code
quality, and what the reviewer would have done differently.

Reviews are independent. Neither reviewer sees its own implementation, neither
sees the other review, and neither knows which agent produced the diff under
review.

### 5. Artifact (~instant)

`codexcode artifact <id>` renders a single markdown document:

```
# CodexCode comparison <id>

Host: <Claude Code | Codex>   Challenger: ...   Base: <branch> @ <commit>

## Original prompt
...

## Cross-reviews
### <Host> reviewing <Challenger>
...
### <Challenger> reviewing <Host>
...

## Structural summary
| Aspect | Host | Challenger |
| files changed, lines added, lines removed, files shared, files unique |

## Diffs
### <Host> (host) diff
```diff
...
```
### <Challenger> (challenger) diff
```diff
...
```

## Next step
Tell the host agent in plain English what you want to do...
```

The host agent prints this verbatim to the user.

### 6. Acceptance (you talk, the agent acts)

You read the artifact and tell the agent what you want. The agent interprets
intent and runs the right combination of:

- `codexcode apply <id> --from host`
- `codexcode apply <id> --from challenger`
- `codexcode apply <id> --files "host:path,challenger:path,..."`
- `codexcode show <id> --side <s> --path <p>` (for "show me X")
- Direct file edits in the original repo for hybrid composition
- `git commit` on the original branch
- `codexcode cleanup <id>` to remove the worktrees and ephemeral branches

If you say "scrap it" or "abandon", the agent runs `codexcode abandon <id>`
and confirms cleanup without committing.

After acceptance, your branch has exactly one new commit. There are no
leftover branches, worktrees, or session directories.

---

## Natural-language acceptance patterns

You do not type accept commands. You talk to your agent. Here are the shapes
the plugin and skill are trained to recognize, with realistic phrasings and
the action each produces.

### Accept everything from one side

| You say | Agent runs |
| --- | --- |
| "ship the host" | `codexcode apply <id> --from host` |
| "go with yours" | same |
| "land Claude's" / "land Codex's" (whichever is the host) | same |
| "accept the challenger" | `codexcode apply <id> --from challenger` |
| "go with Codex" (if Claude is the host) | same |
| "go with Claude" (if Codex is the host) | same |

### Selective merge by file

| You say | Agent does |
| --- | --- |
| "take the host's tests but the challenger's implementation" | enumerates files, then `apply --files "host:tests/...,challenger:src/..."` |
| "use Codex's src/foo.py and Claude's src/foo_test.py" | same, with the explicit paths |
| "host for tests/, challenger for everything else" | enumerates, builds the spec |

If the agent is uncertain which files you mean, it asks one focused question.
It will not present a wall of options.

### Hybrid composition

| You say | Agent does |
| --- | --- |
| "compose the best of both manually" | reads both versions of each file, writes the chosen mix into the original tree using its own edit tools, then commits |
| "take the host's structure but use the challenger's naming" | same, applied to the relevant files |
| "merge them but drop the challenger's new dependency" | applies the host or challenger as the base, then edits to remove the dependency |

In hybrid mode the agent reads file contents with `codexcode show <id> --side <s> --path <p>` and writes the result directly into the original repo.

### Retry with a modified prompt

| You say | Agent does |
| --- | --- |
| "retry but tell them to use Python instead of Bash" | `codexcode abandon <id>`, then start a new session with the modified prompt |
| "try again, but ask for tests this time" | same |
| "same task, new attempt" | `abandon`, `start` again with the same prompt |

### Inspection without committing

| You say | Agent does |
| --- | --- |
| "show me Codex's foo.py" | `codexcode show <id> --side challenger --path foo.py` |
| "let me see the host's tests/foo_test.py" | `codexcode show <id> --side host --path tests/foo_test.py` |
| "what files did the challenger touch?" | `codexcode files <id> --side challenger` |

Inspection does not exit comparison mode. The agent stays ready for more.

### Abandon

| You say | Agent does |
| --- | --- |
| "scrap it" | `codexcode abandon <id>` |
| "abandon" | same |
| "nevermind" | same |
| "throw both away" | same |

Nothing is committed and all worktrees are removed.

---

## The cross-review mechanic in detail

The cross-review is the part of CodexCode that produces information you
cannot get from running either agent alone.

### What each reviewer sees

Each review runs in a fresh scratch directory containing exactly three files:

```
PROMPT.md         <- the original user task, verbatim
OTHER_DIFF.patch  <- a unified diff of the other agent's complete change
REVIEW.md         <- empty, the agent fills it in
```

The reviewer is given this prompt (verbatim, paraphrased here for the README;
see `src/codexcode/review.py` for the literal text):

> You are reviewing another coding agent's implementation of a task. Read
> PROMPT.md and the proposed change in OTHER_DIFF.patch. Write a candid review
> to REVIEW.md covering: correctness, design choices, edge cases the author
> missed, code quality, and what you would have done differently. Reference
> specific files and line numbers. Do not produce code. Do not modify any
> files except REVIEW.md.

### Why blinding matters

Neither reviewer is told which agent produced the diff. Neither reviewer sees
its own implementation. This is not anti-cheating; it is a design choice to
keep the critique focused on the artifact in front of it. When an agent knows
it is reviewing "the other guy", critiques tend to be more pointed. When the
reviewer cannot distinguish "my version" from "their version", you get
something closer to a code review from a stranger.

The two reviews never see each other. They are not arguing; they are
independently grading the same student.

### What you get out of it

In practice the two reviews tend to:

- **Agree on real bugs.** When both reviews flag the same issue, it is
  usually a real bug. Treat agreement as strong evidence.
- **Disagree on style.** Style critiques diverge sharply between agents.
  Treat single-reviewer style flags with appropriate skepticism.
- **Surface invariants you forgot.** Both agents tend to enumerate edge
  cases; combining the lists is often more thorough than what either agent
  would have written if you asked it alone.
- **Justify the cost.** This is the bit you cannot get cheaply elsewhere.

The artifact places the two reviews above the diffs so they are not buried.

---

## Isolation and safety model

CodexCode treats isolation as non-negotiable.

### Where each agent operates

| Phase | Agent | CWD | Can write outside CWD? |
| --- | --- | --- | --- |
| Host implementation | host CLI | `~/.codexcode/sessions/<id>/work/host` | No |
| Challenger implementation | challenger CLI | `~/.codexcode/sessions/<id>/work/challenger` | No |
| Host review | host CLI | `~/.codexcode/sessions/<id>/reviews/host_workspace` | No |
| Challenger review | challenger CLI | `~/.codexcode/sessions/<id>/reviews/challenger_workspace` | No |

"Can write outside CWD" is enforced by the agent's own permission model
combined with the chosen flags. CodexCode does not run the agents inside a
sandbox of its own; the only sandbox is the one the CLI provides. This is the
same isolation you get from running each CLI manually in a separate
directory. CodexCode adds:

- A guarantee that the host worktree starts at the same base commit as the
  challenger worktree.
- A guarantee that neither agent ever sees the other's worktree path.
- A clean-up step that removes worktrees and ephemeral branches on accept or
  abandon.

### Working tree safety

Before doing anything, CodexCode refuses to run if your working tree has
uncommitted changes. The reason is that each worktree is created off your
current HEAD, and giving each agent a different starting point would be
unfair to both. Commit, stash, or revert first.

### Branch and worktree naming

Each session creates two branches:

- `codexcode-<id>-claude-code`
- `codexcode-<id>-codex`

And two worktrees:

- `~/.codexcode/sessions/<id>/work/host`
- `~/.codexcode/sessions/<id>/work/challenger`

Both are removed on accept or abandon. If CodexCode crashes mid-run, you can
remove leftovers manually with `git worktree remove --force <path>` plus
`git branch -D <name>` and `rm -rf ~/.codexcode/sessions/<id>`. Running
`codexcode list` shows any sessions still on disk.

### What CodexCode never does

- Push anything to a remote.
- Modify any branch other than its own ephemeral ones.
- Touch files outside the session directory and the original repo.
- Commit on your behalf without an explicit accept signal from you to the
  host agent.
- Send your prompt, diffs, or reviews anywhere except to the two CLIs you
  already use.

---

## Cost expectations

A CodexCode run pays for **four** agent invocations:

1. Host implementation (real coding work)
2. Challenger implementation (real coding work)
3. Host review of challenger
4. Challenger review of host

For a typical short task ("add a CLI flag X, with help text and a test"),
expect:

- Implementations to dominate cost (most of the wall-clock and tokens)
- Each review to be a fraction of an implementation (one diff in, one
  markdown document out)
- Total cost roughly 2.5x to 3x what a single agent would have cost on the
  same task

For larger tasks the multiplier stays similar but the absolute cost grows
with the task. Two implementations plus two reviews is not free. CodexCode
is best used when:

- The cost of getting it wrong matters more than the cost of the run.
- You genuinely want a second opinion rather than just an answer.
- You want to learn which agent is better at a class of task on your
  codebase.

It is not the right tool for trivial tweaks, scripts you would throw away,
or any task where you already know the answer you want.

---

## End-to-end examples

### Example 1: deciding between two refactor approaches

You are inside Claude Code. You have a tangled `auth.py` that you want
extracted into smaller modules. You are not sure how to split it.

```
/codexcode refactor src/auth.py into focused modules. Keep public API stable. Add no new dependencies. Update imports across the repo.
```

What happens:

1. Claude Code (host) implements the refactor in `work/host`, splitting
   `auth.py` into `auth/session.py`, `auth/permissions.py`, and
   `auth/middleware.py`.
2. Codex (challenger) runs headlessly in `work/challenger`, choosing a
   different split: `auth/core.py`, `auth/handlers.py`, `auth/utils.py`.
3. Both agents review each other. Codex's review flags that Claude's
   `permissions.py` is doing too much. Claude's review flags that Codex's
   `utils.py` is a generic dumping ground.
4. You read both reviews and decide: "take the host's split but rename
   permissions.py to authorization.py".

You tell Claude that in plain English. It:

```
codexcode apply <id> --from host
# then edits the original tree to rename permissions.py -> authorization.py
git -C <repo> commit -am "split auth into focused modules"
codexcode cleanup <id>
```

One commit on your branch. Both critiques saved in your terminal scrollback.

### Example 2: head-to-head on a bug fix

You are inside Codex. You have an intermittent test failure in
`tests/test_pagination.py`. You suspect a race in the fixture but you are
not sure.

```
/codexcode investigate the intermittent failure in tests/test_pagination.py and fix it. Do not change unrelated tests.
```

What happens:

1. Codex (host) finds the race in the fixture, replaces the time-based wait
   with an event.
2. Claude Code (challenger) reaches the same conclusion but also rewrites
   the fixture to use an async generator.
3. Codex's review of Claude says "the async generator change is unrelated
   to the bug and adds risk". Claude's review of Codex says "the fix is
   correct but the test still has a brittle sleep elsewhere; flagging".
4. You say "ship the host" because the smaller fix is more obviously
   correct, but you also file the brittle-sleep finding as a follow-up.

```
codexcode apply <id> --from host
git -C <repo> commit -am "fix race in pagination fixture"
codexcode cleanup <id>
```

### Example 3: selective merge for a new feature

You are inside Claude Code. You want to add a structured-logging mode to
your CLI. You suspect both agents will produce different but partially-
correct designs.

```
/codexcode add a --log-format flag with values text|json|logfmt. When json or logfmt, structured fields include timestamp, level, message, and any kwargs. Add a smoke test.
```

What happens:

1. Claude (host) implements the flag with a custom JSON encoder and a
   thorough smoke test.
2. Codex (challenger) implements it using the stdlib `logging` module's
   built-in formatters and a smaller smoke test.
3. Both reviews praise the other's smoke test. Codex's review flags Claude's
   custom encoder as reinventing stdlib. Claude's review flags Codex's
   formatter as missing the `logfmt` case.

You say:

```
take the challenger's logging code but the host's smoke test
```

Claude figures out the spec:

```
codexcode files <id> --side host
codexcode files <id> --side challenger
codexcode apply <id> --files "challenger:src/cli/logging.py,host:tests/test_logging.py"
git -C <repo> commit -am "add --log-format with text, json, logfmt"
codexcode cleanup <id>
```

---

## Troubleshooting

### `codexcode verify` says Codex CLI is not on PATH

Install it:

```
npm install -g @openai/codex
codex --version
```

or follow the install guide at <https://github.com/openai/codex>.

### A run fails with an authentication error

CodexCode does not pre-check login state. If the headless invocation fails
with an auth error, log in to the affected CLI:

- Claude Code: run `claude` in a terminal and complete the login.
- Codex: run `codex login`.

Then retry. If the error persists, run the CLI manually in the affected
worktree (`~/.codexcode/sessions/<id>/work/<side>`) with the same flags
CodexCode uses to see the full error.

### `Working tree is not clean`

Commit, stash, or revert the listed files. CodexCode refuses to run with
uncommitted changes so that both agents see the same starting point.

### The challenger seems to hang forever

```
codexcode status <id>
```

Shows the last 4 KB of the challenger log. If the agent is genuinely stuck,
kill it manually (`kill <pid>` from the status output) and run
`codexcode abandon <id>` to clean up.

### The cross-review for one agent is empty

The reviewer either failed to invoke or refused to write `REVIEW.md`. The
artifact will say `_(review unavailable)_` for that side. Common causes:

- The agent hit a rate limit. Check the log under
  `~/.codexcode/sessions/<id>/logs/`.
- The permission-bypass flag for that CLI changed in a recent release.
  Override it with `CODEXCODE_CLAUDE_FLAGS` or `CODEXCODE_CODEX_FLAGS`.
- Authentication expired between `verify` and `review`. Re-authenticate
  and run `codexcode review <id>` again; reviews are idempotent.

### Worktrees were not cleaned up

If CodexCode crashed mid-run, you can clean up by hand:

```
codexcode list
git -C <repo> worktree remove --force <leftover-path>
git -C <repo> branch -D codexcode-<id>-claude-code codexcode-<id>-codex
rm -rf ~/.codexcode/sessions/<id>
```

Or just run `codexcode abandon <id>` if the session metadata is intact.

### Python version warning

If `bin/codexcode` prints "CodexCode requires Python 3.8 or newer" but you
have a newer Python installed under a different name (e.g. `python3.12`),
point CodexCode at it:

```
export CODEXCODE_PYTHON=/opt/homebrew/bin/python3.12
```

The shim respects this override.

---

## Known limitations

- **Two agents, not N.** CodexCode is hardcoded to Claude Code and Codex.
  Adding a third agent would require extending the orchestrator and is
  intentionally out of scope.
- **No partial-line cherry-pick.** Selective merge works at file granularity.
  If you want to mix two implementations of the same function, you do it
  by hand in hybrid mode.
- **Reviews can fail.** A flaky CLI or rate-limited account can produce a
  blank review. The artifact still renders, and you can re-run
  `codexcode review <id>` without re-running the implementations.
- **No retries framework.** The orchestrator does not retry agent failures.
  Run `codexcode review <id>` or `codexcode start ...` again if needed.
- **Linux and macOS only.** The Bash shim and installer assume a POSIX
  shell. Windows users can run the Python module directly under WSL or
  PowerShell + Python.

---

## FAQ

**Why two agents instead of just running one really well?**

Because the cross-review surfaces things neither agent would tell you on its
own. The value is in the disagreement, not in picking a winner.

**Does CodexCode work without git?**

No. Isolation is implemented with git worktrees. A non-git project would
require copying the directory twice, which is doable but not implemented.

**Can I run more than one CodexCode session at a time?**

Yes. Each session has its own directory under `~/.codexcode/sessions/` and
its own pair of branches. You can run several concurrently in the same repo,
as long as you do not need to commit between them.

**Do the agents share any state across runs?**

No. Each invocation creates fresh worktrees and fresh scratch dirs. Nothing
persists in `~/.codexcode/` after `cleanup` or `abandon`.

**Can I see the raw transcripts of each agent?**

Yes, while the session is live. Logs are at
`~/.codexcode/sessions/<id>/logs/`. They are removed during cleanup.

**Does CodexCode work inside CI?**

Not directly. The host agent assumes an interactive session for the
acceptance phase. You could script it by replacing the acceptance phase with
direct `codexcode apply` calls, but that defeats the natural-language part
of the design.

**Can I use it with a non-default model on either side?**

Yes. The orchestrator does not constrain model selection. Configure your
preferred model in the underlying CLI's config (Claude Code or Codex). The
flags CodexCode passes are only the permission-bypass flags.

**Why is Python 3.8 the minimum?**

It is the oldest version that ships f-strings, `pathlib.Path.is_file()`-style
ergonomics, and the `concurrent.futures` features the orchestrator uses. Most
deployed Python installations meet it.

**Why does the host run "directly" instead of headlessly like the challenger?**

Because the host is already an interactive session that the user is paying
attention to. Running it headlessly would mean spinning up a second instance
of the same CLI just to keep both sides symmetric, doubling the cost. The
host's "directness" is also what makes the natural-language acceptance phase
work.

**What happens if the host's implementation is much faster than the
challenger's?**

The host finishes, runs `submit`, and then waits. `codexcode wait` blocks
until the challenger exits. This is intentional: the slower agent gates total
time.

---

## Reference: every codexcode subcommand

```
codexcode verify                                     check prerequisites
codexcode start --host <claude-code|codex> --prompt  prepare isolation, launch challenger
                  [--prompt-file FILE] [--repo DIR]
codexcode status <id>                                show session phase and challenger liveness
codexcode wait <id> [--poll N] [--timeout N]         block until challenger exits
codexcode submit <id> --side <host|challenger>       snapshot a worktree's diff
codexcode collect-challenger <id>                    shortcut for `submit --side challenger`
codexcode review <id>                                run both cross-reviews in parallel
codexcode artifact <id> [--out PATH]                 render the comparison artifact
codexcode show <id> --side <s> --path <p>            print a file from a worktree
codexcode files <id> --side <s>                      list changed files in a worktree
codexcode apply <id> --from <host|challenger>        copy a side into the original tree
codexcode apply <id> --files "side:path,side:path"   per-file selection
codexcode cleanup <id>                               remove worktrees, branches, session dir
codexcode abandon <id>                               alias for cleanup
codexcode list                                       list active sessions
codexcode version                                    print version
```

All subcommands print JSON to stdout for programmatic consumption.

Environment overrides:

```
CODEXCODE_PYTHON          pin a specific Python interpreter
CODEXCODE_CLAUDE_FLAGS    override flags passed to `claude` invocations
CODEXCODE_CODEX_FLAGS     override flags passed to `codex` invocations
CODEXCODE_BIN_DEST        install.sh symlink target (default ~/.local/bin)
```
