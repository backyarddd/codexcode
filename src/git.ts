import { spawnSync } from "node:child_process";

export class GitError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "GitError";
  }
}

export interface CommandResult {
  status: number;
  stdout: string;
  stderr: string;
}

export function runGit(
  args: string[],
  cwd?: string,
  check = true,
): CommandResult {
  const proc = spawnSync("git", args, {
    cwd,
    encoding: "utf8",
  });
  const status = proc.status ?? 127;
  const stdout = proc.stdout ?? "";
  const stderr = proc.stderr ?? "";
  if (check && status !== 0) {
    throw new GitError(
      `git ${args.map(shellWord).join(" ")} failed in ${cwd ?? process.cwd()}:\n${stderr.trim()}`,
    );
  }
  return { status, stdout, stderr };
}

export function shellWord(value: string): string {
  if (/^[A-Za-z0-9_./:=@+-]+$/.test(value)) {
    return value;
  }
  return `'${value.replace(/'/g, "'\\''")}'`;
}
