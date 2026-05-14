"""Git worktree isolation primitives.

We create a worktree per side, anchored to the repo's current HEAD. Each agent
operates strictly inside its worktree and never touches the original. After
acceptance or abandonment, worktrees and their branches are removed entirely.
"""
from __future__ import annotations

import pathlib
import shlex
import subprocess
from typing import List, Optional, Tuple


class GitError(RuntimeError):
    pass


def run_git(
    args: List[str],
    cwd: Optional[str] = None,
    check: bool = True,
    capture: bool = True,
) -> subprocess.CompletedProcess:
    cmd = ["git", *args]
    proc = subprocess.run(
        cmd,
        cwd=cwd,
        capture_output=capture,
        text=True,
    )
    if check and proc.returncode != 0:
        raise GitError(
            f"git {' '.join(shlex.quote(a) for a in args)} failed in {cwd}:\n"
            f"{proc.stderr.strip()}"
        )
    return proc


def repo_root(start: Optional[str] = None) -> str:
    proc = run_git(["rev-parse", "--show-toplevel"], cwd=start)
    return proc.stdout.strip()


def current_branch(repo: str) -> str:
    proc = run_git(["branch", "--show-current"], cwd=repo)
    name = proc.stdout.strip()
    if not name:
        proc = run_git(["rev-parse", "HEAD"], cwd=repo)
        return proc.stdout.strip()
    return name


def head_commit(repo: str) -> str:
    proc = run_git(["rev-parse", "HEAD"], cwd=repo)
    return proc.stdout.strip()


def working_tree_clean(repo: str) -> Tuple[bool, str]:
    proc = run_git(["status", "--porcelain"], cwd=repo)
    output = proc.stdout
    return (output.strip() == ""), output


def create_worktree(repo: str, worktree_path: str, branch: str, base: str) -> None:
    pathlib.Path(worktree_path).parent.mkdir(parents=True, exist_ok=True)
    run_git(["worktree", "add", "-b", branch, worktree_path, base], cwd=repo)


def remove_worktree(repo: str, worktree_path: str, branch: str) -> None:
    run_git(["worktree", "remove", "--force", worktree_path], cwd=repo, check=False)
    run_git(["branch", "-D", branch], cwd=repo, check=False)
    run_git(["worktree", "prune"], cwd=repo, check=False)


def stage_all(worktree: str) -> None:
    run_git(["add", "-A"], cwd=worktree)


def unstage_all(worktree: str) -> None:
    run_git(["reset"], cwd=worktree, check=False)


def diff_against(worktree: str, base: str, paths: Optional[List[str]] = None) -> str:
    """Return a unified diff of the worktree state vs base, including untracked.

    We temporarily stage every change (tracked or new) so untracked files appear
    in the diff, then unstage. The diff is computed against the supplied base
    commit so renames or relocations against the original tree are correctly
    rendered.
    """
    stage_all(worktree)
    try:
        args = ["diff", "--cached", "--binary", base]
        if paths:
            args.append("--")
            args.extend(paths)
        proc = run_git(args, cwd=worktree)
        return proc.stdout
    finally:
        unstage_all(worktree)


def changed_files(worktree: str, base: str) -> List[Tuple[str, str]]:
    """Return list of (status, path) tuples for changes vs base."""
    stage_all(worktree)
    try:
        proc = run_git(["diff", "--cached", "--name-status", base], cwd=worktree)
    finally:
        unstage_all(worktree)
    out = []
    for line in proc.stdout.splitlines():
        if not line.strip():
            continue
        parts = line.split("\t")
        if len(parts) >= 2:
            out.append((parts[0], parts[-1]))
    return out


def commit_all(
    repo: str,
    message: str,
    author_name: Optional[str] = None,
    author_email: Optional[str] = None,
) -> str:
    run_git(["add", "-A"], cwd=repo)
    env_args: List[str] = []
    if author_name:
        env_args += ["-c", f"user.name={author_name}"]
    if author_email:
        env_args += ["-c", f"user.email={author_email}"]
    run_git([*env_args, "commit", "-m", message], cwd=repo)
    return head_commit(repo)
