import { AGENT_CLAUDE, AGENT_CODEX, CHALLENGER, HOST, type AgentName } from "./constants.js";
import {
  diffPath,
  loadMeta,
  promptPath,
  readText,
  reviewPath,
} from "./state.js";

function nameFor(agent: AgentName): string {
  if (agent === AGENT_CLAUDE) {
    return "Claude Code";
  }
  if (agent === AGENT_CODEX) {
    return "Codex";
  }
  return agent;
}

function fileList(diffText: string): string[] {
  const files: string[] = [];
  for (const line of diffText.split(/\r?\n/)) {
    const match = /^diff --git a\/(.+?) b\/(.+?)$/.exec(line);
    if (match) {
      files.push(match[2] ?? "");
    }
  }
  return files;
}

function changedLineCounts(diffText: string): { added: number; removed: number } {
  let added = 0;
  let removed = 0;
  for (const line of diffText.split(/\r?\n/)) {
    if (line.startsWith("+") && !line.startsWith("+++")) {
      added += 1;
    }
    if (line.startsWith("-") && !line.startsWith("---")) {
      removed += 1;
    }
  }
  return { added, removed };
}

function bulletList(items: string[]): string {
  return items.length === 0 ? "_(none)_" : items.map((item) => `- \`${item}\``).join("\n");
}

function structuralSummary(hostDiff: string, challengerDiff: string): string {
  const hostFiles = fileList(hostDiff);
  const challengerFiles = fileList(challengerDiff);
  const hostCounts = changedLineCounts(hostDiff);
  const challengerCounts = changedLineCounts(challengerDiff);
  const hostSet = new Set(hostFiles);
  const challengerSet = new Set(challengerFiles);
  const shared = [...hostSet].filter((file) => challengerSet.has(file)).sort();
  const onlyHost = [...hostSet].filter((file) => !challengerSet.has(file)).sort();
  const onlyChallenger = [...challengerSet].filter((file) => !hostSet.has(file)).sort();

  return [
    "| Aspect | Host | Challenger |",
    "| --- | --- | --- |",
    `| Files changed | ${hostFiles.length} | ${challengerFiles.length} |`,
    `| Lines added | ${hostCounts.added} | ${challengerCounts.added} |`,
    `| Lines removed | ${hostCounts.removed} | ${challengerCounts.removed} |`,
    "",
    "**Touched by both attempts:**",
    bulletList(shared),
    "",
    "**Touched only by host:**",
    bulletList(onlyHost),
    "",
    "**Touched only by challenger:**",
    bulletList(onlyChallenger),
    "",
  ].join("\n");
}

function diffSection(title: string, diffText: string): string {
  const body = diffText.trim() || "_(no changes produced)_";
  return `### ${title}\n\n\`\`\`diff\n${body}\n\`\`\`\n`;
}

export function renderArtifact(sessionId: string): string {
  const meta = loadMeta(sessionId);
  const prompt = readText(promptPath(sessionId)) ?? "";
  const hostDiff = readText(diffPath(sessionId, HOST)) ?? "";
  const challengerDiff = readText(diffPath(sessionId, CHALLENGER)) ?? "";
  const hostReview = readText(reviewPath(sessionId, HOST)) ?? "_(review unavailable)_";
  const challengerReview = readText(reviewPath(sessionId, CHALLENGER)) ?? "_(review unavailable)_";
  const hostName = nameFor(meta.host_agent);
  const challengerName = nameFor(meta.challenger_agent);

  return [
    `# CodexCode comparison \`${sessionId}\`\n`,
    `Host: **${hostName}**   Challenger: **${challengerName}**   Base: \`${meta.base_branch}\` @ \`${meta.base_commit.slice(0, 12)}\`\n`,
    "## Original prompt\n",
    `\`\`\`\n${prompt.trimEnd()}\n\`\`\`\n`,
    "## Cross-reviews\n",
    "The two agents reviewed each other's work independently. Neither saw its own diff while reviewing, and neither saw the other review.\n",
    `### ${hostName} reviewing ${challengerName}\n\n${hostReview.trimEnd()}\n`,
    `### ${challengerName} reviewing ${hostName}\n\n${challengerReview.trimEnd()}\n`,
    "## Structural summary\n",
    structuralSummary(hostDiff, challengerDiff),
    "## Diffs\n",
    diffSection(`${hostName} (host) diff`, hostDiff),
    diffSection(`${challengerName} (challenger) diff`, challengerDiff),
    "## Next step\n",
    "Tell the host agent in plain English what you want to do: accept either attempt in full, take specific files from each side, compose a hybrid, retry with a tweaked prompt, or just inspect a file. The agent will figure out the rest.\n",
  ].join("\n");
}
