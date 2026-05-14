import { spawn, spawnSync } from "node:child_process";
import {
  chmodSync,
  existsSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import { dirname } from "node:path";
import { type AgentName, AGENT_CLAUDE, AGENT_CODEX } from "./constants.js";
import { shellWord } from "./git.js";

function flagList(envName: string, defaults: string[]): string[] {
  const override = process.env[envName];
  return override === undefined ? [...defaults] : splitShellWords(override);
}

function splitShellWords(input: string): string[] {
  const out: string[] = [];
  let current = "";
  let quote: "'" | '"' | null = null;
  for (let i = 0; i < input.length; i += 1) {
    const ch = input[i];
    if (quote) {
      if (ch === quote) {
        quote = null;
      } else {
        current += ch;
      }
      continue;
    }
    if (ch === "'" || ch === '"') {
      quote = ch;
    } else if (/\s/.test(ch)) {
      if (current) {
        out.push(current);
        current = "";
      }
    } else {
      current += ch;
    }
  }
  if (current) {
    out.push(current);
  }
  return out;
}

export function claudeFlags(): string[] {
  return flagList("CODEXCODE_CLAUDE_FLAGS", ["--dangerously-skip-permissions"]);
}

export function codexFlags(): string[] {
  return flagList("CODEXCODE_CODEX_FLAGS", [
    "--dangerously-bypass-approvals-and-sandbox",
  ]);
}

export function implementationCommand(agent: AgentName, prompt: string): string[] {
  if (agent === AGENT_CLAUDE) {
    return ["claude", ...claudeFlags(), "-p", prompt];
  }
  if (agent === AGENT_CODEX) {
    return ["codex", "exec", ...codexFlags(), prompt];
  }
  throw new Error(`unknown agent: ${agent}`);
}

export function spawnBackground(input: {
  cmd: string[];
  cwd: string;
  logPath: string;
  exitPath: string;
}): number {
  mkdirSync(dirname(input.logPath), { recursive: true });
  const scriptPath = `${input.logPath}.runner.sh`;
  const cmdLine = input.cmd.map(shellWord).join(" ");
  const script = [
    "#!/usr/bin/env bash",
    "set +e",
    `printf '$ %s\\n' ${shellWord(cmdLine)} > ${shellWord(input.logPath)}`,
    `cd ${shellWord(input.cwd)} || exit 127`,
    `${cmdLine} >> ${shellWord(input.logPath)} 2>&1`,
    "rc=$?",
    `printf '%s\\n' "$rc" > ${shellWord(input.exitPath)}`,
    "exit \"$rc\"",
    "",
  ].join("\n");
  writeFileSync(scriptPath, script, "utf8");
  chmodSync(scriptPath, 0o755);
  const proc = spawn(scriptPath, {
    detached: true,
    stdio: "ignore",
    env: process.env,
  });
  proc.unref();
  return proc.pid ?? 0;
}

export function pidAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    return code === "EPERM";
  }
}

export async function runForeground(input: {
  cmd: string[];
  cwd: string;
  logPath?: string;
  timeoutMs?: number;
}): Promise<number> {
  if (input.logPath) {
    mkdirSync(dirname(input.logPath), { recursive: true });
    writeFileSync(
      input.logPath,
      `$ ${input.cmd.map(shellWord).join(" ")}\n`,
      { flag: "a" },
    );
  }
  return new Promise((resolve) => {
    const proc = spawn(input.cmd[0] ?? "", input.cmd.slice(1), {
      cwd: input.cwd,
      stdio: ["ignore", "pipe", "pipe"],
      env: process.env,
    });
    let timer: NodeJS.Timeout | null = null;
    const append = (data: Buffer) => {
      if (input.logPath) {
        writeFileSync(input.logPath, data, { flag: "a" });
      }
    };
    proc.stdout?.on("data", append);
    proc.stderr?.on("data", append);
    if (input.timeoutMs) {
      timer = setTimeout(() => {
        proc.kill("SIGTERM");
      }, input.timeoutMs);
    }
    proc.on("close", (code) => {
      if (timer) {
        clearTimeout(timer);
      }
      resolve(code ?? 1);
    });
    proc.on("error", () => {
      if (timer) {
        clearTimeout(timer);
      }
      resolve(127);
    });
  });
}

export function readExitCode(exitPath: string, logPath: string): number {
  if (existsSync(exitPath)) {
    const raw = readFileSync(exitPath, "utf8").trim();
    const parsed = Number(raw);
    return Number.isInteger(parsed) ? parsed : 1;
  }
  if (!existsSync(logPath)) {
    return 1;
  }
  const tail = readFileSync(logPath, "utf8").slice(-8192).toLowerCase();
  const markers = ["traceback", "fatal", "error: unauthorized", "panic:", "command not found"];
  return markers.some((marker) => tail.includes(marker)) ? 1 : 0;
}

export function commandVersion(cmd: string): string {
  const proc = spawnSync(cmd, ["--version"], { encoding: "utf8" });
  return `${proc.stdout ?? ""}${proc.stderr ?? ""}`.trim();
}
