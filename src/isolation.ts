import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { runGit } from "./git.js";

export function repoRoot(start?: string): string {
  return runGit(["rev-parse", "--show-toplevel"], start).stdout.trim();
}

export function currentBranch(repo: string): string {
  const name = runGit(["branch", "--show-current"], repo).stdout.trim();
  if (name) {
    return name;
  }
  return runGit(["rev-parse", "HEAD"], repo).stdout.trim();
}

export function headCommit(repo: string): string {
  return runGit(["rev-parse", "HEAD"], repo).stdout.trim();
}

export function workingTreeClean(repo: string): { clean: boolean; output: string } {
  const output = runGit(["status", "--porcelain"], repo).stdout;
  return { clean: output.trim() === "", output };
}

export function createWorktree(
  repo: string,
  worktreePath: string,
  branch: string,
  base: string,
): void {
  mkdirSync(dirname(worktreePath), { recursive: true });
  runGit(["worktree", "add", "-b", branch, worktreePath, base], repo);
}

export function removeWorktree(
  repo: string,
  worktreePath: string,
  branch: string,
): void {
  runGit(["worktree", "remove", "--force", worktreePath], repo, false);
  runGit(["branch", "-D", branch], repo, false);
  runGit(["worktree", "prune"], repo, false);
}

export function stageAll(worktree: string): void {
  runGit(["add", "-A"], worktree);
}

export function unstageAll(worktree: string): void {
  runGit(["reset"], worktree, false);
}

export function diffAgainst(
  worktree: string,
  base: string,
  paths?: string[],
): string {
  stageAll(worktree);
  try {
    const args = ["diff", "--cached", "--binary", base];
    if (paths && paths.length > 0) {
      args.push("--", ...paths);
    }
    return runGit(args, worktree).stdout;
  } finally {
    unstageAll(worktree);
  }
}

export function changedFiles(worktree: string, base: string): Array<[string, string]> {
  stageAll(worktree);
  let output = "";
  try {
    output = runGit(["diff", "--cached", "--name-status", base], worktree).stdout;
  } finally {
    unstageAll(worktree);
  }
  return output
    .split(/\r?\n/)
    .filter((line) => line.trim() !== "")
    .map((line) => {
      const parts = line.split("\t");
      return [parts[0] ?? "", parts[parts.length - 1] ?? ""] as [string, string];
    });
}

export function commitAll(repo: string, message: string): string {
  runGit(["add", "-A"], repo);
  runGit(["commit", "-m", message], repo);
  return headCommit(repo);
}
