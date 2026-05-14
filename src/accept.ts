import {
  copyFileSync,
  existsSync,
  mkdirSync,
  rmSync,
  statSync,
  unlinkSync,
  chmodSync,
} from "node:fs";
import { dirname, join, posix } from "node:path";
import { CHALLENGER, HOST, type Side } from "./constants.js";
import { changedFiles, removeWorktree } from "./isolation.js";
import { removeSession, type SessionMeta } from "./state.js";

function sideWorktree(meta: SessionMeta, side: Side): string {
  return side === HOST ? meta.host.worktree : meta.challenger.worktree;
}

export function validateRelativePath(relPath: string): string {
  const normalized = relPath.replace(/\\/g, "/");
  const parsed = posix.normalize(normalized);
  if (
    !normalized ||
    posix.isAbsolute(normalized) ||
    parsed === "." ||
    parsed.startsWith("../") ||
    parsed === ".." ||
    normalized.split("/").some((part) => part === "" || part === "." || part === "..")
  ) {
    throw new Error(`path must be a relative path inside the repo: ${JSON.stringify(relPath)}`);
  }
  return parsed;
}

function copyFile(srcRoot: string, dstRoot: string, relPath: string): void {
  const safePath = validateRelativePath(relPath);
  const src = join(srcRoot, safePath);
  const dst = join(dstRoot, safePath);
  mkdirSync(dirname(dst), { recursive: true });
  if (existsSync(src)) {
    copyFileSync(src, dst);
    chmodSync(dst, statSync(src).mode);
  } else if (existsSync(dst)) {
    unlinkSync(dst);
  }
}

function deleteFile(dstRoot: string, relPath: string): void {
  const safePath = validateRelativePath(relPath);
  const dst = join(dstRoot, safePath);
  if (existsSync(dst)) {
    unlinkSync(dst);
  }
}

export function applySide(meta: SessionMeta, side: Side): { applied: string[]; deleted: string[] } {
  const repo = meta.repo_root;
  const wt = sideWorktree(meta, side);
  const touched = changedFiles(wt, meta.base_commit);
  const applied: string[] = [];
  const deleted: string[] = [];
  for (const [status, relPath] of touched) {
    if (status.startsWith("D")) {
      deleteFile(repo, relPath);
      deleted.push(relPath);
    } else {
      copyFile(wt, repo, relPath);
      applied.push(relPath);
    }
  }
  return { applied, deleted };
}

export function parseFilesSpec(spec: string): Array<[Side, string]> {
  const out: Array<[Side, string]> = [];
  for (const chunkRaw of spec.split(",")) {
    const chunk = chunkRaw.trim();
    if (!chunk) {
      continue;
    }
    if (!chunk.includes(":")) {
      throw new Error(`bad --files entry ${JSON.stringify(chunk)}; expected SIDE:PATH`);
    }
    const [sideRaw, ...pathParts] = chunk.split(":");
    const side = sideRaw.trim().toLowerCase();
    const relPath = pathParts.join(":").trim();
    if (side !== HOST && side !== CHALLENGER) {
      throw new Error(`unknown side ${JSON.stringify(side)} in ${JSON.stringify(chunk)}; want host or challenger`);
    }
    if (!relPath) {
      throw new Error(`empty path in ${JSON.stringify(chunk)}`);
    }
    out.push([side, validateRelativePath(relPath)]);
  }
  return out;
}

export function applyFiles(
  meta: SessionMeta,
  picks: Array<[Side, string]>,
): { applied: string[]; deleted: string[] } {
  const applied: string[] = [];
  const deleted: string[] = [];
  for (const [side, relPath] of picks) {
    const wt = sideWorktree(meta, side);
    const src = join(wt, relPath);
    if (existsSync(src)) {
      copyFile(wt, meta.repo_root, relPath);
      applied.push(`${side}:${relPath}`);
    } else {
      deleteFile(meta.repo_root, relPath);
      deleted.push(`${side}:${relPath}`);
    }
  }
  return { applied, deleted };
}

export function cleanupSession(sessionId: string, meta: SessionMeta): { removed: string[] } {
  const removed: string[] = [];
  for (const side of [HOST, CHALLENGER] as const) {
    const sideMeta = side === HOST ? meta.host : meta.challenger;
    removeWorktree(meta.repo_root, sideMeta.worktree, sideMeta.branch);
    rmSync(sideMeta.worktree, { recursive: true, force: true });
    removed.push(sideMeta.worktree);
  }
  removeSession(sessionId);
  return { removed };
}
