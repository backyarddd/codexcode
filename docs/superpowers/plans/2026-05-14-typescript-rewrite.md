# TypeScript Rewrite Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the Python CodexCode orchestrator with a Node/TypeScript CLI while preserving clone-plus-install and slash-command behavior.

**Architecture:** TypeScript modules under `src/` mirror the current Python responsibilities: git isolation, session state, agent execution, review orchestration, artifact rendering, acceptance, verification, and CLI parsing. `npm run build` compiles to `dist/`, and `bin/codexcode` resolves its real path then executes `dist/cli.js` with Node.

**Tech Stack:** Node.js 20+, TypeScript, Node stdlib, bash install shim, git worktrees.

---

### Task 1: Project Skeleton

**Files:**
- Create: `package.json`
- Create: `tsconfig.json`
- Modify: `.gitignore`
- Modify: `bin/codexcode`
- Modify: `install.sh`

- [ ] Add TypeScript package metadata with build, test, and CLI scripts.
- [ ] Configure TypeScript to compile `src/**/*.ts` to `dist/`.
- [ ] Update the bin shim to resolve symlinks and run `node dist/cli.js`.
- [ ] Update install script to verify Node/npm, install dependencies, build, symlink the CLI, and copy skills.

### Task 2: TypeScript Modules

**Files:**
- Create: `src/constants.ts`
- Create: `src/errors.ts`
- Create: `src/git.ts`
- Create: `src/state.ts`
- Create: `src/verify.ts`
- Create: `src/agents.ts`
- Create: `src/isolation.ts`
- Create: `src/accept.ts`
- Create: `src/review.ts`
- Create: `src/artifact.ts`
- Create: `src/cli.ts`
- Delete: `src/codexcode/*.py`

- [ ] Port current behavior to TypeScript with no runtime dependencies beyond Node stdlib.
- [ ] Preserve all subcommands and JSON payload shapes.
- [ ] Improve detached challenger exit tracking by writing an explicit `.exit` file.
- [ ] Keep path traversal defenses for `show` and selective apply.

### Task 3: Tests

**Files:**
- Create: `test/cli.test.ts`
- Create: `test/shim.test.ts`
- Delete: `tests/test_cli_regressions.py`
- Delete: `tests/test_entry_shim.sh`

- [ ] Cover path safety, failed challenger wait behavior, symlink shim behavior, and a fake-CLI end-to-end workflow.
- [ ] Run `npm test` and `npm run build`.

### Task 4: Docs And Skills

**Files:**
- Modify: `README.md`
- Modify: `claude-plugin/skills/codexcode/SKILL.md`
- Modify: `codex-plugin/skills/codexcode/SKILL.md`

- [ ] Replace Python prerequisite text with Node.js/npm requirements.
- [ ] Keep the PATH and Claude Code restart troubleshooting notes.
- [ ] Ensure slash-command workflow still invokes `codexcode`.

### Task 5: Real Smoke Test

**Files:**
- Temporary: `.real-test-repo/`

- [ ] Run `./install.sh`.
- [ ] Create a clean disposable git repo.
- [ ] Invoke real Claude Code with `/codexcode <tiny prompt>`.
- [ ] Let real Codex and Claude complete implementation and cross-review.
- [ ] Apply or abandon the session after confirming the artifact renders.
- [ ] Report exact results and any limitations.
