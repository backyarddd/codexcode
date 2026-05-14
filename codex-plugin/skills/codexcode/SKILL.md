---
name: codexcode
description: Race Claude Code against this Codex session on the same prompt, have each agent critique the other, then accept a result by plain English. Trigger when the user asks for a head to head, a second opinion from Claude Code, or invokes /codexcode.
---

# CodexCode (from Codex)

You are Codex acting as the host of the CodexCode workflow. Claude Code is the
challenger. The user has given you a task prompt that you should race against
Claude Code.

If the user has not given a prompt yet, ask once for the task and then continue. The user's task prompt is what you will pass to `--prompt` below.

## Phase 0: preflight

Run, in order, and stop immediately if any step fails:

```bash
codexcode verify
```

If `codexcode verify` exits non-zero, surface the failure verbatim and offer to help fix it (install the missing CLI, commit pending changes, authenticate, etc).

## Phase 1: start

```bash
codexcode start --host codex --prompt "<user prompt>"
```

Parse the JSON output. You will use:
- `session_id`
- `host_worktree` (you will work in this directory)
- `challenger_worktree`
- `challenger_pid`
- `challenger_log`

Tell the user:
- the session id
- both worktree paths
- that Claude Code is running headlessly in the background with PID `challenger_pid`

## Phase 2: implement (host attempt)

Now do the implementation yourself, in the host worktree. Treat `host_worktree` as your working directory for this phase. Read the user's prompt and implement it as a normal coding task: explore, edit, write, run commands. Do not look at the challenger worktree or its log during this phase.

When you are satisfied, capture the diff:

```bash
codexcode submit <session_id> --side host
```

## Phase 3: wait for the challenger

```bash
codexcode wait <session_id>
```

This blocks until the Claude Code process exits. While waiting, you may report progress to the user. If `wait` times out, run `codexcode status <session_id>` to peek at the challenger log tail.

Once `wait` returns, snapshot the challenger's diff:

```bash
codexcode collect-challenger <session_id>
```

## Phase 4: cross-reviews

```bash
codexcode review <session_id>
```

This runs both reviews in parallel, headlessly. It blocks until both finish. Each review is written to `~/.codexcode/sessions/<session_id>/reviews/by_host.md` and `by_challenger.md`. You do not need to read them directly; the artifact will include them.

## Phase 5: present the artifact

```bash
codexcode artifact <session_id>
```

Pipe the full artifact to the user verbatim, including the two cross-reviews. Do not summarize the artifact away. After the artifact, add one line: "Tell me how you want to land this." Do not enumerate options.

## Phase 6: acceptance (natural language)

You are now in comparison mode. Wait for the user's next message. Interpret intent without offering menus.

Resolve ambiguity with at most one focused clarifying question. Never present a wall of options.

Common shapes you should recognize and the action for each:

- "ship the host", "go with yours", "land codex's", "accept codex":
  ```bash
  codexcode apply <session_id> --from host
  ```
- "ship the challenger", "go with Claude", "accept Claude Code":
  ```bash
  codexcode apply <session_id> --from challenger
  ```
- "take the host's tests but the challenger's implementation", or any naming of files from both sides: build a `--files` spec.
  ```bash
  codexcode apply <session_id> --files "host:tests/foo.py,challenger:src/foo.py"
  ```
  Use `codexcode files <session_id> --side host` and `... --side challenger` to enumerate available files.
- "show me Claude's version of X" or "let me see your X": use `codexcode show <session_id> --side <side> --path <path>` and print the file. Stay in comparison mode afterward.
- "compose this manually" or any hybrid request that requires hand editing: read files with `codexcode show ...`, write the chosen combination directly into the original repo using your own edit tools. After you are satisfied, run `codexcode cleanup <session_id>` and commit on the original branch.
- "retry with X tweaked", "try again but ask it to use Y": run `codexcode abandon <session_id>` to discard the session, then start a new one with the modified prompt.
- "scrap it", "abandon", "nevermind": `codexcode abandon <session_id>` and confirm cleanup. Do not commit.

After applying changes (Phase 6 commands that mutate the original tree):

1. Run `git status` in the original repo to show what changed.
2. Commit:

   ```bash
   git -C <repo_root> commit -am "<concise message describing the accepted result>"
   ```

   Write a clean, focused commit message in plain English. Do not add any trailers.
3. Run `codexcode cleanup <session_id>` to remove the worktrees and ephemeral branches.
4. Confirm to the user with the new commit SHA.

## Rules

- Never reveal the challenger's worktree contents to the user before the cross-review artifact is presented. Until then, the comparison must stay blind.
- Never modify anything in the challenger's worktree.
- Never commit on behalf of the user without an explicit accept signal.
- Never reach for backup commands when the user has already given a clear instruction.
- Two implementations plus two reviews per invocation is expensive. If the user only wanted a small tweak, suggest skipping CodexCode next time.
