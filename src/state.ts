import { randomBytes } from "node:crypto";
import {
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  renameSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { AGENTS, type AgentName, type Side, SIDES } from "./constants.js";

export interface SideMeta {
  branch: string;
  worktree: string;
}

export interface ChallengerMeta extends SideMeta {
  pid: number | null;
  started: number | null;
  finished: number | null;
  exitCode: number | null;
  log: string;
  exitFile: string;
}

export interface SessionMeta {
  session_id: string;
  version: number;
  created: number;
  host_agent: AgentName;
  challenger_agent: AgentName;
  repo_root: string;
  base_branch: string;
  base_commit: string;
  phase: string;
  host: SideMeta & { submitted: number | null };
  challenger: ChallengerMeta;
  reviews: Record<string, unknown>;
}

export const stateRoot = process.env.CODEXCODE_STATE_ROOT ?? join(homedir(), ".codexcode");
export const sessionsDir = join(stateRoot, "sessions");

export function newSessionId(): string {
  return randomBytes(5).toString("hex");
}

export function sessionPath(sessionId: string): string {
  return join(sessionsDir, sessionId);
}

export function metaPath(sessionId: string): string {
  return join(sessionPath(sessionId), "meta.json");
}

export function initSession(input: {
  sessionId: string;
  hostAgent: AgentName;
  challengerAgent: AgentName;
  prompt: string;
  repoRoot: string;
  baseBranch: string;
  baseCommit: string;
}): SessionMeta {
  if (!AGENTS.includes(input.hostAgent) || !AGENTS.includes(input.challengerAgent)) {
    throw new Error(`unknown agent name in ${input.hostAgent}, ${input.challengerAgent}`);
  }
  if (input.hostAgent === input.challengerAgent) {
    throw new Error("host and challenger must differ");
  }
  const root = sessionPath(input.sessionId);
  mkdirSync(join(root, "work"), { recursive: true });
  mkdirSync(join(root, "logs"), { recursive: true });
  mkdirSync(join(root, "reviews"), { recursive: true });
  writeFileSync(join(root, "prompt.txt"), input.prompt, "utf8");

  const meta: SessionMeta = {
    session_id: input.sessionId,
    version: 2,
    created: Date.now() / 1000,
    host_agent: input.hostAgent,
    challenger_agent: input.challengerAgent,
    repo_root: input.repoRoot,
    base_branch: input.baseBranch,
    base_commit: input.baseCommit,
    phase: "started",
    challenger: {
      pid: null,
      branch: `codexcode-${input.sessionId}-${input.challengerAgent}`,
      worktree: join(root, "work", "challenger"),
      started: null,
      finished: null,
      exitCode: null,
      log: join(root, "logs", "challenger.log"),
      exitFile: join(root, "logs", "challenger.exit"),
    },
    host: {
      branch: `codexcode-${input.sessionId}-${input.hostAgent}`,
      worktree: join(root, "work", "host"),
      submitted: null,
    },
    reviews: {
      host_of_challenger: null,
      challenger_of_host: null,
    },
  };
  saveMeta(input.sessionId, meta);
  return meta;
}

export function saveMeta(sessionId: string, meta: SessionMeta): void {
  const path = metaPath(sessionId);
  mkdirSync(sessionPath(sessionId), { recursive: true });
  const tmp = `${path}.tmp`;
  writeFileSync(tmp, `${JSON.stringify(meta, null, 2)}\n`, "utf8");
  renameSync(tmp, path);
}

export function loadMeta(sessionId: string): SessionMeta {
  const path = metaPath(sessionId);
  if (!existsSync(path)) {
    throw new Error(`session not found: ${sessionId}`);
  }
  return JSON.parse(readFileSync(path, "utf8")) as SessionMeta;
}

export function updateMeta(sessionId: string, changes: Partial<SessionMeta>): SessionMeta {
  const meta = loadMeta(sessionId);
  const next = { ...meta, ...changes };
  saveMeta(sessionId, next);
  return next;
}

export function listSessions(): string[] {
  if (!existsSync(sessionsDir)) {
    return [];
  }
  return readdirSync(sessionsDir).filter((name) => existsSync(metaPath(name)));
}

export function removeSession(sessionId: string): void {
  rmSync(sessionPath(sessionId), { recursive: true, force: true });
}

export function diffPath(sessionId: string, side: Side): string {
  if (!SIDES.includes(side)) {
    throw new Error(`unknown side: ${side}`);
  }
  return join(sessionPath(sessionId), `${side}.diff`);
}

export function reviewPath(sessionId: string, reviewerSide: Side): string {
  if (!SIDES.includes(reviewerSide)) {
    throw new Error(`unknown reviewer side: ${reviewerSide}`);
  }
  return join(sessionPath(sessionId), "reviews", `by_${reviewerSide}.md`);
}

export function promptPath(sessionId: string): string {
  return join(sessionPath(sessionId), "prompt.txt");
}

export function artifactPath(sessionId: string): string {
  return join(sessionPath(sessionId), "artifact.md");
}

export function writeText(path: string, content: string): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, content, "utf8");
}

export function readText(path: string): string | null {
  if (!existsSync(path)) {
    return null;
  }
  return readFileSync(path, "utf8");
}
