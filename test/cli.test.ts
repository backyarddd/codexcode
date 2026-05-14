import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { parseFilesSpec } from "../src/accept.js";

const thisFile = fileURLToPath(import.meta.url);
const repoRoot = resolve(dirname(thisFile), "../..");
const cliPath = join(repoRoot, "dist", "src", "cli.js");
const shimPath = join(repoRoot, "bin", "codexcode");

function tempDir(prefix: string): string {
  return mkdtempSync(join(tmpdir(), prefix));
}

function runCli(args: string[], cwd: string, env: NodeJS.ProcessEnv = {}) {
  const proc = spawnSync(process.execPath, [cliPath, ...args], {
    cwd,
    env: { ...process.env, ...env },
    encoding: "utf8",
  });
  return proc;
}

function initRepo(): string {
  const repo = tempDir("codexcode-repo-");
  execFileSync("git", ["init", "-q"], { cwd: repo });
  execFileSync("git", ["config", "user.name", "Test"], { cwd: repo });
  execFileSync("git", ["config", "user.email", "test@example.com"], { cwd: repo });
  writeFileSync(join(repo, "README.md"), "base\n", "utf8");
  execFileSync("git", ["add", "README.md"], { cwd: repo });
  execFileSync("git", ["commit", "-q", "-m", "init"], { cwd: repo });
  return repo;
}

function writeExecutable(path: string, content: string): void {
  writeFileSync(path, content, "utf8");
  chmodSync(path, 0o755);
}

test("parseFilesSpec rejects paths outside the repo", () => {
  assert.throws(() => parseFilesSpec("host:../outside.txt"), /relative path/);
  assert.throws(() => parseFilesSpec("challenger:/tmp/outside.txt"), /relative path/);
});

test("symlinked bin shim resolves the checkout before running dist cli", () => {
  const dir = tempDir("codexcode-shim-");
  const link = join(dir, "codexcode");
  symlinkSync(shimPath, link);
  const output = execFileSync(link, ["version"], { encoding: "utf8" });
  assert.match(output, /"version"/);
});

test("show rejects path traversal before reading from worktree", () => {
  const stateRoot = tempDir("codexcode-state-");
  const repo = tempDir("codexcode-show-");
  const session = "showtest";
  const worktree = join(repo, "worktree");
  mkdirSync(join(stateRoot, "sessions", session), { recursive: true });
  mkdirSync(worktree, { recursive: true });
  writeFileSync(join(repo, "secret.txt"), "do not print me", "utf8");
  writeFileSync(
    join(stateRoot, "sessions", session, "meta.json"),
    JSON.stringify({
      session_id: session,
      repo_root: repo,
      base_commit: "HEAD",
      host: { worktree },
      challenger: { worktree },
    }),
    "utf8",
  );

  const proc = runCli(
    ["show", session, "--side", "host", "--path", "../secret.txt"],
    repo,
    { CODEXCODE_STATE_ROOT: stateRoot },
  );
  assert.notEqual(proc.status, 0);
  assert.equal(proc.stdout, "");
  assert.match(proc.stderr, /relative path/);
});

test("fake cli end-to-end workflow produces artifact and cleans up", async () => {
  const repo = initRepo();
  const stateRoot = tempDir("codexcode-state-");
  const fakeBin = tempDir("codexcode-bin-");
  writeExecutable(
    join(fakeBin, "codex"),
    `#!/usr/bin/env bash
if [ "$1" = "--version" ]; then echo "codex-cli fake"; exit 0; fi
if [ "$1" = "exec" ]; then
  shift
  while [ $# -gt 0 ]; do
    case "$1" in
      --dangerously-bypass-approvals-and-sandbox) shift ;;
      *) break ;;
    esac
  done
  if [ -f REVIEW.md ]; then printf 'fake codex review\\n' > REVIEW.md; else printf 'codex was here\\n' > CODEX_OUT.txt; fi
  exit 0
fi
exit 2
`,
  );
  writeExecutable(
    join(fakeBin, "claude"),
    `#!/usr/bin/env bash
if [ "$1" = "--version" ]; then echo "2.fake (Claude Code)"; exit 0; fi
while [ $# -gt 0 ]; do
  case "$1" in
    --dangerously-skip-permissions) shift ;;
    -p|--print) shift; break ;;
    *) break ;;
  esac
done
if [ -f REVIEW.md ]; then printf 'fake claude review\\n' > REVIEW.md; else printf 'claude was here\\n' > CLAUDE_OUT.txt; fi
exit 0
`,
  );
  const env = {
    PATH: `${fakeBin}:${process.env.PATH}`,
    CODEXCODE_STATE_ROOT: stateRoot,
  };

  const start = runCli(
    ["start", "--host", "claude-code", "--prompt", "make a marker"],
    repo,
    env,
  );
  assert.equal(start.status, 0, start.stderr);
  const sessionId = JSON.parse(start.stdout).session_id as string;
  assert.ok(sessionId);

  assert.equal(runCli(["wait", sessionId, "--timeout", "10"], repo, env).status, 0);
  assert.equal(runCli(["submit", sessionId, "--side", "host"], repo, env).status, 0);
  assert.equal(runCli(["collect-challenger", sessionId], repo, env).status, 0);
  assert.equal(runCli(["review", sessionId], repo, env).status, 0);
  const artifact = runCli(["artifact", sessionId], repo, env);
  assert.equal(artifact.status, 0);
  assert.match(artifact.stdout, /fake claude review/);
  assert.match(artifact.stdout, /CODEX_OUT.txt/);

  const cleanup = runCli(["abandon", sessionId], repo, env);
  assert.equal(cleanup.status, 0);
  rmSync(repo, { recursive: true, force: true });
});

test("live-host review flow does not spawn a second host reviewer", async () => {
  const repo = initRepo();
  const stateRoot = tempDir("codexcode-state-");
  const fakeBin = tempDir("codexcode-bin-");
  const hostReviewMarker = join(fakeBin, "host-review-called");
  writeExecutable(
    join(fakeBin, "codex"),
    `#!/usr/bin/env bash
if [ "$1" = "--version" ]; then echo "codex-cli fake"; exit 0; fi
if [ "$1" = "exec" ]; then
  shift
  while [ $# -gt 0 ]; do
    case "$1" in
      --dangerously-bypass-approvals-and-sandbox) shift ;;
      *) break ;;
    esac
  done
  if [ -f REVIEW.md ]; then printf 'fake codex challenger review\\n' > REVIEW.md; else printf 'codex was here\\n' > CODEX_OUT.txt; fi
  exit 0
fi
exit 2
`,
  );
  writeExecutable(
    join(fakeBin, "claude"),
    `#!/usr/bin/env bash
if [ "$1" = "--version" ]; then echo "2.fake (Claude Code)"; exit 0; fi
if [ -f REVIEW.md ]; then printf 'unexpected host review call\\n' > ${JSON.stringify(hostReviewMarker)}; exit 42; fi
printf 'unexpected claude implementation call\\n' > CLAUDE_OUT.txt
exit 43
`,
  );
  const env = {
    PATH: `${fakeBin}:${process.env.PATH}`,
    CODEXCODE_STATE_ROOT: stateRoot,
  };
  const start = runCli(
    ["start", "--host", "claude-code", "--prompt", "make a marker"],
    repo,
    env,
  );
  assert.equal(start.status, 0, start.stderr);
  const sessionId = JSON.parse(start.stdout).session_id as string;

  assert.equal(runCli(["wait", sessionId, "--timeout", "10"], repo, env).status, 0);
  assert.equal(runCli(["submit", sessionId, "--side", "host"], repo, env).status, 0);
  assert.equal(runCli(["collect-challenger", sessionId], repo, env).status, 0);

  const prep = runCli(["prepare-review", sessionId, "--reviewer", "host"], repo, env);
  assert.equal(prep.status, 0, prep.stderr);
  const prepPayload = JSON.parse(prep.stdout) as { review_file: string; workspace: string };
  assert.ok(prepPayload.workspace.endsWith("host_workspace"));
  writeFileSync(prepPayload.review_file, "live host review\n", "utf8");
  assert.equal(runCli(["save-review", sessionId, "--reviewer", "host"], repo, env).status, 0);
  assert.equal(runCli(["review", sessionId, "--reviewer", "challenger"], repo, env).status, 0);
  assert.equal(existsSync(hostReviewMarker), false);

  const artifact = runCli(["artifact", sessionId], repo, env);
  assert.equal(artifact.status, 0);
  assert.match(artifact.stdout, /live host review/);
  assert.match(artifact.stdout, /fake codex challenger review/);
  assert.match(
    readFileSync(join(stateRoot, "sessions", sessionId, "artifact.md"), "utf8"),
    /fake codex challenger review/,
  );
  assert.equal(runCli(["abandon", sessionId], repo, env).status, 0);
});
