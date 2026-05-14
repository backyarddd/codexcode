---
description: Race Codex against this Claude Code session on the same prompt, have each agent critique the other, then accept a result by plain English.
argument-hint: "<task prompt>"
---

You are running the CodexCode workflow. Claude Code is the host. Codex is the
challenger. The user's task prompt is in `$ARGUMENTS`.

If `$ARGUMENTS` is empty, ask the user once for the task they want to race, then continue.

## Phase 0: preflight

Run, in order, and stop immediately if any step fails:

```bash
codexcode verify
```

Stop if `codexcode verify` exits non-zero. Print the failure to the user verbatim and offer to help fix it (install missing CLI, commit pending changes, etc).

## Phase 1: start

```bash
codexcode start --host claude-code --prompt "$ARGUMENTS"
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
- that Codex is running headlessly in the background with PID `challenger_pid`

## Phase 2: implement (host attempt)

Now do the implementation yourself, in the host worktree. Treat `host_worktree` as your working directory for this phase. Read the user's prompt (it was passed verbatim in $ARGUMENTS) and implement it as if it were a normal coding task: explore, edit, write, run commands. Do not look at the challenger worktree or its log during this phase.

When you are satisfied, capture the diff:

```bash
codexcode submit <session_id> --side host
```

## Phase 3: wait for the challenger

```bash
codexcode wait <session_id>
```

This blocks until the Codex process exits. While waiting, you may report progress to the user. If `wait` times out, run `codexcode status <session_id>` to peek at the challenger log tail.

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

- "ship the host", "go with yours", "land Claude's", "accept claude":
  ```bash
  codexcode apply <session_id> --from host
  ```
- "ship the challenger", "go with codex", "accept codex":
  ```bash
  codexcode apply <session_id> --from challenger
  ```
- "take the host's tests but the challenger's implementation", "use codex's src/foo.py and claude's tests/", or anything that names files from both sides: build a `--files` spec.
  ```bash
  codexcode apply <session_id> --files "host:tests/foo.py,challenger:src/foo.py"
  ```
  Use `codexcode files <session_id> --side host` and `... --side challenger` to enumerate available files.
- "let me see codex's version of X", "show me Claude's foo.py": use `codexcode show <session_id> --side <side> --path <path>` and print the file. Stay in comparison mode afterward.
- "compose this manually" or any hybrid request that requires editing: read files with `codexcode show ...`, write the chosen combination directly into the original repo using your own Edit/Write tools. After you are satisfied, run `codexcode cleanup <session_id>` and commit on the original branch.
- "retry with X tweaked", "try again but ask it to use Y": run `codexcode abandon <session_id>` to discard the session, then start a new one with the modified prompt.
- "scrap it", "abandon", "nevermind": `codexcode abandon <session_id>` and confirm cleanup. Do not commit.

After applying changes (Phase 6 commands that mutate the original tree):

1. Run `git status` in the original repo to show what changed.
2. Commit:

   ```bash
   git -C <repo_root> commit -am "<concise message describing the accepted result>"
   ```

   Write a clean, focused commit message that describes the change in plain English. Do not add Co-Authored-By or any other trailers.
3. Run `codexcode cleanup <session_id>` to remove the worktrees and ephemeral branches.
4. Confirm to the user with the new commit SHA.

## Rules

- Never reveal the challenger's worktree contents to the user before the cross-review artifact is presented. Until then, the comparison must stay blind.
- Never modify anything in the challenger's worktree.
- Never commit on behalf of the user without an explicit accept signal.
- Never reach for backup commands when the user has already given a clear instruction.
- Two implementations plus two reviews per invocation is expensive. If the user only wanted a small tweak, suggest skipping CodexCode next time.
