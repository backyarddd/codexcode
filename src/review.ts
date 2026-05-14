import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { CHALLENGER, HOST, type Side } from "./constants.js";
import { implementationCommand, runForeground } from "./agents.js";
import {
  diffPath,
  loadMeta,
  promptPath,
  readText,
  reviewPath,
  sessionPath,
  updateMeta,
  writeText,
} from "./state.js";

export const REVIEW_PROMPT_TEMPLATE = `You are reviewing another coding agent's implementation of a task.

Read the original task description in PROMPT.md and the proposed change in
OTHER_DIFF.patch (both files are in your current working directory).

Write a candid, substantive review to the file REVIEW.md in your current
working directory. The review must cover, at minimum:

  1. Correctness: does the diff actually accomplish the task in PROMPT.md?
  2. Design choices: are the architectural decisions sound? Call out anything
     you disagree with and explain why.
  3. Edge cases: list specific scenarios that would break this implementation
     or that the author did not handle.
  4. Code quality: naming, structure, readability, error handling, choice of
     dependencies, idiomatic use of the language and framework.
  5. What you would have done differently: be concrete. If you would take a
     materially different approach, sketch it.

Reference specific files and line numbers in OTHER_DIFF.patch wherever you can.
Use plain markdown. Do not write or modify any other files. Do not modify
OTHER_DIFF.patch or PROMPT.md. Do not produce code beyond small inline
snippets in the review itself. When REVIEW.md is complete you are done.
`;

export function prepareReviewWorkspace(
  workspace: string,
  prompt: string,
  diffText: string,
): void {
  mkdirSync(workspace, { recursive: true });
  writeFileSync(join(workspace, "PROMPT.md"), prompt, "utf8");
  writeFileSync(join(workspace, "OTHER_DIFF.patch"), diffText, "utf8");
  writeFileSync(
    join(workspace, "REVIEW.md"),
    "<!-- write your review here; replace this placeholder -->\n",
    "utf8",
  );
}

function reviewWorkspace(sessionId: string, reviewer: Side): string {
  return join(
    sessionPath(sessionId),
    "reviews",
    reviewer === HOST ? "host_workspace" : "challenger_workspace",
  );
}

function reviewLogPath(sessionId: string, reviewer: Side): string {
  return join(
    sessionPath(sessionId),
    "logs",
    reviewer === HOST ? "host_review.log" : "challenger_review.log",
  );
}

function diffForReviewer(sessionId: string, reviewer: Side): string {
  return readText(diffPath(sessionId, reviewer === HOST ? CHALLENGER : HOST)) ?? "";
}

function reviewKey(reviewer: Side): string {
  return reviewer === HOST ? "host_of_challenger" : "challenger_of_host";
}

function setReviewMeta(
  sessionId: string,
  reviewer: Side,
  value: Record<string, unknown>,
): void {
  const meta = loadMeta(sessionId);
  const reviews = { ...meta.reviews, [reviewKey(reviewer)]: value };
  const phase =
    existsSync(reviewPath(sessionId, HOST)) && existsSync(reviewPath(sessionId, CHALLENGER))
      ? "reviewed"
      : "reviewing";
  updateMeta(sessionId, { reviews, phase });
}

export function prepareReview(sessionId: string, reviewer: Side): {
  workspace: string;
  prompt_file: string;
  diff_file: string;
  review_file: string;
  review_prompt: string;
} {
  const workspace = reviewWorkspace(sessionId, reviewer);
  rmSync(workspace, { recursive: true, force: true });
  prepareReviewWorkspace(
    workspace,
    readText(promptPath(sessionId)) ?? "",
    diffForReviewer(sessionId, reviewer),
  );
  return {
    workspace,
    prompt_file: join(workspace, "PROMPT.md"),
    diff_file: join(workspace, "OTHER_DIFF.patch"),
    review_file: join(workspace, "REVIEW.md"),
    review_prompt: REVIEW_PROMPT_TEMPLATE,
  };
}

export function savePreparedReview(sessionId: string, reviewer: Side): string {
  const reviewFile = join(reviewWorkspace(sessionId, reviewer), "REVIEW.md");
  if (!existsSync(reviewFile)) {
    throw new Error(`review file not found: ${reviewFile}`);
  }
  const review = readFileSync(reviewFile, "utf8");
  writeText(reviewPath(sessionId, reviewer), review);
  setReviewMeta(sessionId, reviewer, {
    exit_code: 0,
    log: null,
    mode: "live",
  });
  return review;
}

async function runOneReview(input: {
  agent: ReturnType<typeof loadMeta>["host_agent"];
  prompt: string;
  diffText: string;
  workspace: string;
  logPath: string;
}): Promise<[number, string]> {
  prepareReviewWorkspace(input.workspace, input.prompt, input.diffText);
  const cmd = implementationCommand(input.agent, REVIEW_PROMPT_TEMPLATE);
  const rc = await runForeground({ cmd, cwd: input.workspace, logPath: input.logPath });
  const reviewFile = join(input.workspace, "REVIEW.md");
  const review = existsSync(reviewFile) ? readFileSync(reviewFile, "utf8") : "";
  return [rc, review];
}

export async function runHeadlessReview(
  sessionId: string,
  reviewer: Side,
): Promise<{ exit_code: number; review: string; log: string; review_path: string }> {
  const meta = loadMeta(sessionId);
  const workspace = reviewWorkspace(sessionId, reviewer);
  const logPath = reviewLogPath(sessionId, reviewer);
  rmSync(workspace, { recursive: true, force: true });
  const [rc, review] = await runOneReview({
    agent: reviewer === HOST ? meta.host_agent : meta.challenger_agent,
    prompt: readText(promptPath(sessionId)) ?? "",
    diffText: diffForReviewer(sessionId, reviewer),
    workspace,
    logPath,
  }).catch((error: unknown): [number, string] => [
    1,
    `_review failed to run: ${String(error)}_\n`,
  ]);

  writeText(reviewPath(sessionId, reviewer), review);
  setReviewMeta(sessionId, reviewer, {
    exit_code: rc,
    log: logPath,
    mode: "headless",
  });
  return {
    exit_code: rc,
    review,
    log: logPath,
    review_path: reviewPath(sessionId, reviewer),
  };
}

export async function runCrossReviews(sessionId: string): Promise<{
  host_of_challenger: string;
  challenger_of_host: string;
}> {
  const [hostResult, challengerResult] = await Promise.all([
    runHeadlessReview(sessionId, HOST),
    runHeadlessReview(sessionId, CHALLENGER),
  ]);

  updateMeta(sessionId, {
    reviews: {
      host_of_challenger: {
        exit_code: hostResult.exit_code,
        log: hostResult.log,
        mode: "headless",
      },
      challenger_of_host: {
        exit_code: challengerResult.exit_code,
        log: challengerResult.log,
        mode: "headless",
      },
    },
    phase: "reviewed",
  });

  return {
    host_of_challenger: hostResult.review,
    challenger_of_host: challengerResult.review,
  };
}
