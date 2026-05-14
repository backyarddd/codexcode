#!/usr/bin/env node
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import {
  AGENT_CLAUDE,
  AGENT_CODEX,
  CHALLENGER,
  HOST,
  isAgent,
  isSide,
  type AgentName,
  type Side,
} from "./constants.js";
import { GitError } from "./git.js";
import {
  changedFiles,
  currentBranch,
  createWorktree,
  diffAgainst,
  headCommit,
  repoRoot,
} from "./isolation.js";
import {
  diffPath,
  artifactPath,
  initSession,
  listSessions,
  loadMeta,
  newSessionId,
  promptPath,
  reviewPath,
  saveMeta,
  writeText,
} from "./state.js";
import { verifyAll } from "./verify.js";
import {
  applyFiles,
  applySide,
  cleanupSession,
  parseFilesSpec,
  validateRelativePath,
} from "./accept.js";
import {
  implementationCommand,
  pidAlive,
  readExitCode,
  spawnBackground,
} from "./agents.js";
import {
  prepareReview,
  runCrossReviews,
  runHeadlessReview,
  savePreparedReview,
} from "./review.js";
import { renderArtifact } from "./artifact.js";

const VERSION = "0.1.0";

interface ParsedArgs {
  cmd: string | null;
  positionals: string[];
  flags: Map<string, string | boolean>;
}

function emit(payload: unknown): void {
  process.stdout.write(`${JSON.stringify(payload, null, 2)}\n`);
}

function die(message: string, code = 1): number {
  process.stderr.write(`${message.trimEnd()}\n`);
  return code;
}

function parseArgs(argv: string[]): ParsedArgs {
  const flags = new Map<string, string | boolean>();
  const positionals: string[] = [];
  let cmd: string | null = null;
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i] ?? "";
    if (arg.startsWith("--")) {
      const [rawKey, inlineValue] = arg.split("=", 2);
      const key = rawKey.slice(2);
      if (inlineValue !== undefined) {
        flags.set(key, inlineValue);
      } else if (i + 1 < argv.length && !(argv[i + 1] ?? "").startsWith("--")) {
        flags.set(key, argv[i + 1] ?? "");
        i += 1;
      } else {
        flags.set(key, true);
      }
    } else if (!cmd) {
      cmd = arg;
    } else {
      positionals.push(arg);
    }
  }
  return { cmd, positionals, flags };
}

function flagString(args: ParsedArgs, name: string): string | null {
  const value = args.flags.get(name);
  if (typeof value === "string") {
    return value;
  }
  return null;
}

function hasFlag(args: ParsedArgs, name: string): boolean {
  return args.flags.has(name);
}

function readPrompt(args: ParsedArgs): string {
  const promptFile = flagString(args, "prompt-file");
  if (promptFile) {
    return readFileSync(promptFile, "utf8");
  }
  const prompt = flagString(args, "prompt");
  if (prompt) {
    return prompt;
  }
  const stdin = readFileSync(0, "utf8");
  if (!stdin.trim()) {
    throw new Error("no prompt provided (use --prompt, --prompt-file, or stdin)");
  }
  return stdin;
}

function cmdVerify(args: ParsedArgs): number {
  const repo = flagString(args, "repo") ?? process.cwd();
  const root = repoRoot(repo);
  const problems = verifyAll(root);
  if (problems.length > 0) {
    for (const problem of problems) {
      process.stderr.write(`- ${problem.replace(/\n/g, "\n  ")}\n`);
    }
    return 1;
  }
  emit({ ok: true, repo_root: root });
  return 0;
}

function cmdStart(args: ParsedArgs): number {
  const repo = flagString(args, "repo") ?? process.cwd();
  const root = repoRoot(repo);
  const problems = verifyAll(root);
  if (problems.length > 0) {
    process.stderr.write("CodexCode preflight failed:\n");
    for (const problem of problems) {
      process.stderr.write(`- ${problem.replace(/\n/g, "\n  ")}\n`);
    }
    return 1;
  }

  const hostRaw = flagString(args, "host");
  if (!hostRaw || !isAgent(hostRaw)) {
    return die(`--host must be one of ${AGENT_CLAUDE}, ${AGENT_CODEX}`);
  }
  const host: AgentName = hostRaw;
  const challenger = host === AGENT_CLAUDE ? AGENT_CODEX : AGENT_CLAUDE;
  const prompt = readPrompt(args);
  if (!prompt.trim()) {
    return die("prompt is empty");
  }

  const sessionId = newSessionId();
  const baseBranch = currentBranch(root);
  const baseCommit = headCommit(root);
  const meta = initSession({
    sessionId,
    hostAgent: host,
    challengerAgent: challenger,
    prompt,
    repoRoot: root,
    baseBranch,
    baseCommit,
  });

  createWorktree(root, meta.host.worktree, meta.host.branch, baseCommit);
  createWorktree(root, meta.challenger.worktree, meta.challenger.branch, baseCommit);
  const challengerCmd = implementationCommand(challenger, prompt);
  const pid = spawnBackground({
    cmd: challengerCmd,
    cwd: meta.challenger.worktree,
    logPath: meta.challenger.log,
    exitPath: meta.challenger.exitFile,
  });
  meta.challenger.pid = pid;
  meta.challenger.started = Date.now() / 1000;
  meta.phase = "implementing";
  saveMeta(sessionId, meta);

  emit({
    session_id: sessionId,
    host_agent: host,
    challenger_agent: challenger,
    host_worktree: meta.host.worktree,
    challenger_worktree: meta.challenger.worktree,
    challenger_pid: pid,
    challenger_log: meta.challenger.log,
    base_branch: baseBranch,
    base_commit: baseCommit,
    repo_root: root,
    prompt_file: promptPath(sessionId),
  });
  return 0;
}

function cmdStatus(args: ParsedArgs): number {
  const sessionId = args.positionals[0];
  if (!sessionId) {
    return die("missing session id");
  }
  const meta = loadMeta(sessionId);
  const alive = meta.challenger.pid ? pidAlive(meta.challenger.pid) : false;
  let logTail = "";
  if (existsSync(meta.challenger.log)) {
    logTail = readFileSync(meta.challenger.log, "utf8").slice(-4096);
  }
  emit({
    session_id: meta.session_id,
    phase: meta.phase,
    challenger_alive: alive,
    challenger_pid: meta.challenger.pid,
    challenger_started: meta.challenger.started,
    challenger_finished: meta.challenger.finished,
    challenger_exit_code: meta.challenger.exitCode,
    challenger_log_tail: logTail,
  });
  return 0;
}

async function cmdWait(args: ParsedArgs): Promise<number> {
  const sessionId = args.positionals[0];
  if (!sessionId) {
    return die("missing session id");
  }
  const meta = loadMeta(sessionId);
  const pid = meta.challenger.pid;
  if (!pid) {
    return die("no challenger pid recorded");
  }
  const pollSeconds = Math.max(0.5, Number(flagString(args, "poll") ?? "1.0"));
  const timeout = flagString(args, "timeout");
  const deadline = timeout ? Date.now() + Number(timeout) * 1000 : null;
  while (pidAlive(pid)) {
    if (deadline !== null && Date.now() > deadline) {
      return die(`timeout waiting for challenger pid ${pid}`, 2);
    }
    await new Promise((resolve) => setTimeout(resolve, pollSeconds * 1000));
  }
  const rc = readExitCode(meta.challenger.exitFile, meta.challenger.log);
  meta.challenger.finished = Date.now() / 1000;
  meta.challenger.exitCode = rc;
  meta.phase = rc === 0 ? "waiting_for_host_submit" : "challenger_failed";
  saveMeta(sessionId, meta);
  emit({
    session_id: meta.session_id,
    challenger_exit_code: rc,
    log_path: meta.challenger.log,
  });
  if (rc !== 0) {
    return die(`challenger failed; inspect log: ${meta.challenger.log}`, rc);
  }
  return 0;
}

function submitSide(sessionId: string, side: Side): { diff_path: string; diff_bytes: number } {
  const meta = loadMeta(sessionId);
  const wt = side === HOST ? meta.host.worktree : meta.challenger.worktree;
  const diff = diffAgainst(wt, meta.base_commit);
  const path = diffPath(sessionId, side);
  writeText(path, diff);
  if (side === HOST) {
    meta.host.submitted = Date.now() / 1000;
  }
  if (existsSync(diffPath(sessionId, HOST)) && existsSync(diffPath(sessionId, CHALLENGER))) {
    meta.phase = "implementations_complete";
  }
  saveMeta(sessionId, meta);
  return { diff_path: path, diff_bytes: Buffer.byteLength(diff, "utf8") };
}

function cmdSubmit(args: ParsedArgs): number {
  const sessionId = args.positionals[0];
  const sideRaw = flagString(args, "side");
  if (!sessionId) {
    return die("missing session id");
  }
  if (!sideRaw || !isSide(sideRaw)) {
    return die(`--side must be ${HOST} or ${CHALLENGER}`);
  }
  const outcome = submitSide(sessionId, sideRaw);
  emit({ session_id: sessionId, side: sideRaw, ...outcome });
  return 0;
}

function cmdCollectChallenger(args: ParsedArgs): number {
  const sessionId = args.positionals[0];
  if (!sessionId) {
    return die("missing session id");
  }
  const outcome = submitSide(sessionId, CHALLENGER);
  emit({ session_id: sessionId, ...outcome });
  return 0;
}

async function cmdReview(args: ParsedArgs): Promise<number> {
  const sessionId = args.positionals[0];
  if (!sessionId) {
    return die("missing session id");
  }
  const meta = loadMeta(sessionId);
  if (!["implementations_complete", "reviewed"].includes(meta.phase)) {
    process.stderr.write(`warning: session phase is ${JSON.stringify(meta.phase)}, expected 'implementations_complete'\n`);
  }
  const reviewerRaw = flagString(args, "reviewer");
  if (reviewerRaw) {
    if (!isSide(reviewerRaw)) {
      return die(`--reviewer must be ${HOST} or ${CHALLENGER}`);
    }
    const result = await runHeadlessReview(sessionId, reviewerRaw);
    emit({
      session_id: sessionId,
      reviewer: reviewerRaw,
      review_path: result.review_path,
      review_bytes: Buffer.byteLength(result.review, "utf8"),
      exit_code: result.exit_code,
      log_path: result.log,
    });
    return result.exit_code === 0 ? 0 : 1;
  }
  const reviews = await runCrossReviews(sessionId);
  emit({
    session_id: sessionId,
    host_of_challenger_path: reviewPath(sessionId, HOST),
    challenger_of_host_path: reviewPath(sessionId, CHALLENGER),
    host_of_challenger_bytes: Buffer.byteLength(reviews.host_of_challenger, "utf8"),
    challenger_of_host_bytes: Buffer.byteLength(reviews.challenger_of_host, "utf8"),
  });
  return 0;
}

function cmdPrepareReview(args: ParsedArgs): number {
  const sessionId = args.positionals[0];
  const reviewerRaw = flagString(args, "reviewer");
  if (!sessionId) {
    return die("missing session id");
  }
  if (!reviewerRaw || !isSide(reviewerRaw)) {
    return die(`--reviewer must be ${HOST} or ${CHALLENGER}`);
  }
  const result = prepareReview(sessionId, reviewerRaw);
  emit({ session_id: sessionId, reviewer: reviewerRaw, ...result });
  return 0;
}

function cmdSaveReview(args: ParsedArgs): number {
  const sessionId = args.positionals[0];
  const reviewerRaw = flagString(args, "reviewer");
  if (!sessionId) {
    return die("missing session id");
  }
  if (!reviewerRaw || !isSide(reviewerRaw)) {
    return die(`--reviewer must be ${HOST} or ${CHALLENGER}`);
  }
  const text = savePreparedReview(sessionId, reviewerRaw);
  emit({
    session_id: sessionId,
    reviewer: reviewerRaw,
    review_path: reviewPath(sessionId, reviewerRaw),
    review_bytes: Buffer.byteLength(text, "utf8"),
  });
  return 0;
}

function cmdArtifact(args: ParsedArgs): number {
  const sessionId = args.positionals[0];
  if (!sessionId) {
    return die("missing session id");
  }
  const text = renderArtifact(sessionId);
  const savedPath = artifactPath(sessionId);
  writeFileSync(savedPath, text, "utf8");
  const out = flagString(args, "out");
  if (out) {
    writeFileSync(out, text, "utf8");
    emit({ session_id: sessionId, artifact_path: out, session_artifact_path: savedPath });
  } else {
    process.stdout.write(text);
  }
  return 0;
}

function cmdShow(args: ParsedArgs): number {
  const sessionId = args.positionals[0];
  const sideRaw = flagString(args, "side");
  const relPathRaw = flagString(args, "path");
  if (!sessionId) {
    return die("missing session id");
  }
  if (!sideRaw || !isSide(sideRaw)) {
    return die(`--side must be ${HOST} or ${CHALLENGER}`);
  }
  if (!relPathRaw) {
    return die("--path is required");
  }
  let relPath: string;
  try {
    relPath = validateRelativePath(relPathRaw);
  } catch (error) {
    return die((error as Error).message);
  }
  const meta = loadMeta(sessionId);
  const wt = sideRaw === HOST ? meta.host.worktree : meta.challenger.worktree;
  const target = join(wt, relPath);
  if (!existsSync(target)) {
    return die(`file not found in ${sideRaw}: ${relPathRaw}`);
  }
  process.stdout.write(readFileSync(target, "utf8"));
  return 0;
}

function cmdFiles(args: ParsedArgs): number {
  const sessionId = args.positionals[0];
  const sideRaw = flagString(args, "side");
  if (!sessionId) {
    return die("missing session id");
  }
  if (!sideRaw || !isSide(sideRaw)) {
    return die(`--side must be ${HOST} or ${CHALLENGER}`);
  }
  const meta = loadMeta(sessionId);
  const wt = sideRaw === HOST ? meta.host.worktree : meta.challenger.worktree;
  const files = changedFiles(wt, meta.base_commit).map(([status, path]) => ({
    status,
    path,
  }));
  emit({ session_id: sessionId, side: sideRaw, files });
  return 0;
}

function cmdApply(args: ParsedArgs): number {
  const sessionId = args.positionals[0];
  if (!sessionId) {
    return die("missing session id");
  }
  const meta = loadMeta(sessionId);
  const filesSpec = flagString(args, "files");
  const fromRaw = flagString(args, "from");
  let outcome: { applied: string[]; deleted: string[] };
  if (filesSpec) {
    outcome = applyFiles(meta, parseFilesSpec(filesSpec));
  } else if (fromRaw && isSide(fromRaw)) {
    outcome = applySide(meta, fromRaw);
  } else {
    return die("specify --from SIDE or --files SPEC");
  }
  meta.phase = "applied";
  saveMeta(sessionId, meta);
  emit({ session_id: sessionId, ...outcome });
  return 0;
}

function cmdCleanup(args: ParsedArgs): number {
  const sessionId = args.positionals[0];
  if (!sessionId) {
    return die("missing session id");
  }
  const meta = loadMeta(sessionId);
  const outcome = cleanupSession(sessionId, meta);
  emit({ session_id: sessionId, ...outcome });
  return 0;
}

function cmdList(): number {
  emit({
    sessions: listSessions().map((sessionId) => {
      try {
        const meta = loadMeta(sessionId);
        return {
          session_id: sessionId,
          phase: meta.phase,
          host_agent: meta.host_agent,
          challenger_agent: meta.challenger_agent,
          repo_root: meta.repo_root,
          base_branch: meta.base_branch,
          created: meta.created,
        };
      } catch {
        return { session_id: sessionId, phase: "unreadable" };
      }
    }),
  });
  return 0;
}

function printHelp(): number {
  process.stdout.write(`Usage: codexcode <command> [options]\n\nCommands:\n  verify, start, status, wait, submit, collect-challenger, prepare-review,\n  save-review, review, artifact, show, files, apply, cleanup, abandon,\n  list, version\n`);
  return 1;
}

export async function main(argv = process.argv.slice(2)): Promise<number> {
  const args = parseArgs(argv);
  if (hasFlag(args, "version") || args.cmd === "version") {
    emit({ version: VERSION });
    return 0;
  }
  try {
    switch (args.cmd) {
      case "verify":
        return cmdVerify(args);
      case "start":
        return cmdStart(args);
      case "status":
        return cmdStatus(args);
      case "wait":
        return cmdWait(args);
      case "submit":
        return cmdSubmit(args);
      case "collect-challenger":
        return cmdCollectChallenger(args);
      case "prepare-review":
        return cmdPrepareReview(args);
      case "save-review":
        return cmdSaveReview(args);
      case "review":
        return cmdReview(args);
      case "artifact":
        return cmdArtifact(args);
      case "show":
        return cmdShow(args);
      case "files":
        return cmdFiles(args);
      case "apply":
        return cmdApply(args);
      case "cleanup":
      case "abandon":
        return cmdCleanup(args);
      case "list":
        return cmdList();
      default:
        return printHelp();
    }
  } catch (error) {
    if (error instanceof GitError || error instanceof Error) {
      return die(error.message);
    }
    return die(String(error));
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().then((code) => {
    process.exitCode = code;
  });
}
