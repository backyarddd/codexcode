import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { CHALLENGER, HOST } from "./constants.js";
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

const REVIEW_PROMPT_TEMPLATE = `You are reviewing another coding agent's implementation of a task.

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

function prepareReviewWorkspace(workspace: string, prompt: string, diffText: string): void {
  mkdirSync(workspace, { recursive: true });
  writeFileSync(join(workspace, "PROMPT.md"), prompt, "utf8");
  writeFileSync(join(workspace, "OTHER_DIFF.patch"), diffText, "utf8");
  writeFileSync(
    join(workspace, "REVIEW.md"),
    "<!-- write your review here; replace this placeholder -->\n",
    "utf8",
  );
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

export async function runCrossReviews(sessionId: string): Promise<{
  host_of_challenger: string;
  challenger_of_host: string;
}> {
  const meta = loadMeta(sessionId);
  const prompt = readText(promptPath(sessionId)) ?? "";
  const hostDiff = readText(diffPath(sessionId, HOST)) ?? "";
  const challengerDiff = readText(diffPath(sessionId, CHALLENGER)) ?? "";
  const root = sessionPath(sessionId);
  const reviewsRoot = join(root, "reviews");
  mkdirSync(reviewsRoot, { recursive: true });

  const hostWorkspace = join(reviewsRoot, "host_workspace");
  const challengerWorkspace = join(reviewsRoot, "challenger_workspace");
  rmSync(hostWorkspace, { recursive: true, force: true });
  rmSync(challengerWorkspace, { recursive: true, force: true });

  const hostLog = join(root, "logs", "host_review.log");
  const challengerLog = join(root, "logs", "challenger_review.log");

  const hostReviewPromise = runOneReview({
    agent: meta.host_agent,
    prompt,
    diffText: challengerDiff,
    workspace: hostWorkspace,
    logPath: hostLog,
  }).catch((error: unknown): [number, string] => [
    1,
    `_review failed to run: ${String(error)}_\n`,
  ]);

  const challengerReviewPromise = runOneReview({
    agent: meta.challenger_agent,
    prompt,
    diffText: hostDiff,
    workspace: challengerWorkspace,
    logPath: challengerLog,
  }).catch((error: unknown): [number, string] => [
    1,
    `_review failed to run: ${String(error)}_\n`,
  ]);

  const [[hostRc, hostReview], [challengerRc, challengerReview]] = await Promise.all([
    hostReviewPromise,
    challengerReviewPromise,
  ]);

  writeText(reviewPath(sessionId, HOST), hostReview);
  writeText(reviewPath(sessionId, CHALLENGER), challengerReview);
  updateMeta(sessionId, {
    reviews: {
      host_of_challenger: { exit_code: hostRc, log: hostLog },
      challenger_of_host: { exit_code: challengerRc, log: challengerLog },
    },
    phase: "reviewed",
  });

  return {
    host_of_challenger: hostReview,
    challenger_of_host: challengerReview,
  };
}
