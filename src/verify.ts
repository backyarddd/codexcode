import { spawnSync } from "node:child_process";
import { workingTreeClean } from "./isolation.js";

function which(name: string): string | null {
  const proc = spawnSync("which", [name], {
    encoding: "utf8",
  });
  return proc.status === 0 ? proc.stdout.trim() : null;
}

function run(cmd: string[], timeout = 10_000): { status: number; output: string } {
  const proc = spawnSync(cmd[0] ?? "", cmd.slice(1), {
    encoding: "utf8",
    timeout,
  });
  return {
    status: proc.status ?? 127,
    output: `${proc.stdout ?? ""}${proc.stderr ?? ""}`.trim(),
  };
}

export function checkGit(): string | null {
  return which("git") ? null : "git is not on PATH. Install git and try again.";
}

export function checkNode(): string | null {
  const major = Number(process.versions.node.split(".")[0]);
  if (major < 20) {
    return `Node.js 20+ required, found ${process.versions.node}.`;
  }
  return null;
}

export function checkClaudeCode(): string | null {
  if (!which("claude")) {
    return "Claude Code CLI not found on PATH. Install it from https://docs.claude.com/en/docs/claude-code and ensure `claude` is on your PATH.";
  }
  const result = run(["claude", "--version"]);
  if (result.status !== 0) {
    return `\`claude --version\` failed. Output:\n${result.output || "(no output)"}\nIf this is an authentication error, run \`claude\` once interactively to log in.`;
  }
  return null;
}

export function checkCodex(): string | null {
  if (!which("codex")) {
    return "Codex CLI not found on PATH. Install it (`npm i -g @openai/codex` or follow https://github.com/openai/codex) and ensure `codex` is on your PATH.";
  }
  const result = run(["codex", "--version"]);
  if (result.status !== 0) {
    return `\`codex --version\` failed. Output:\n${result.output || "(no output)"}\nIf this is an authentication error, run \`codex login\` to log in.`;
  }
  return null;
}

export function checkCleanTree(repo: string): string | null {
  const { clean, output } = workingTreeClean(repo);
  if (clean) {
    return null;
  }
  return `Working tree is not clean. CodexCode refuses to run with uncommitted changes so it can give each agent a faithful base.\nCommit, stash, or revert these changes and try again:\n${output.trimEnd()}`;
}

export function verifyAll(repo: string): string[] {
  const problems: string[] = [];
  for (const check of [checkNode, checkGit, checkClaudeCode, checkCodex]) {
    const problem = check();
    if (problem) {
      problems.push(problem);
    }
  }
  const cleanTree = checkCleanTree(repo);
  if (cleanTree) {
    problems.push(cleanTree);
  }
  return problems;
}
