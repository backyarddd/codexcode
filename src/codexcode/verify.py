"""Prerequisite checks.

We fail loud and early on missing tools and dirty trees. We do not try to
guess at authentication state, since both CLIs manage that themselves and the
credential paths drift between releases. If a CLI is logged out, the headless
invocation will say so clearly enough at run time.

Each check returns either None on success or a string describing what is
wrong. The CLI front-end aggregates and prints them.
"""
from __future__ import annotations

import shutil
import subprocess
from typing import List, Optional, Tuple


def _which(name: str) -> Optional[str]:
    return shutil.which(name)


def _run(cmd: List[str], timeout: float = 10.0) -> Tuple[int, str, str]:
    try:
        proc = subprocess.run(
            cmd, capture_output=True, text=True, timeout=timeout
        )
        return proc.returncode, proc.stdout, proc.stderr
    except (subprocess.TimeoutExpired, FileNotFoundError) as exc:
        return 127, "", str(exc)


def check_git() -> Optional[str]:
    if not _which("git"):
        return "git is not on PATH. Install git and try again."
    return None


def check_python() -> Optional[str]:
    import sys

    if sys.version_info < (3, 8):
        return (
            f"Python 3.8+ required, found {sys.version_info.major}."
            f"{sys.version_info.minor}."
        )
    return None


def check_claude_code() -> Optional[str]:
    if not _which("claude"):
        return (
            "Claude Code CLI not found on PATH. Install it from "
            "https://docs.claude.com/en/docs/claude-code and ensure `claude` "
            "is on your PATH."
        )
    rc, out, err = _run(["claude", "--version"])
    if rc != 0:
        return (
            "`claude --version` failed. Output:\n"
            f"{(out + err).strip() or '(no output)'}\n"
            "If this is an authentication error, run `claude` once "
            "interactively to log in."
        )
    return None


def check_codex() -> Optional[str]:
    if not _which("codex"):
        return (
            "Codex CLI not found on PATH. Install it (`npm i -g @openai/codex` "
            "or follow https://github.com/openai/codex) and ensure `codex` is "
            "on your PATH."
        )
    rc, out, err = _run(["codex", "--version"])
    if rc != 0:
        return (
            "`codex --version` failed. Output:\n"
            f"{(out + err).strip() or '(no output)'}\n"
            "If this is an authentication error, run `codex login` to log in."
        )
    return None


def check_clean_tree(repo: str) -> Optional[str]:
    from .isolation import working_tree_clean

    clean, output = working_tree_clean(repo)
    if not clean:
        return (
            "Working tree is not clean. CodexCode refuses to run with "
            "uncommitted changes so it can give each agent a faithful base.\n"
            "Commit, stash, or revert these changes and try again:\n"
            f"{output.rstrip()}"
        )
    return None


def verify_all(repo: str) -> List[str]:
    """Return a list of human-readable problems. Empty means good to go."""
    problems: List[str] = []
    for fn in (check_python, check_git, check_claude_code, check_codex):
        msg = fn()
        if msg:
            problems.append(msg)
    msg = check_clean_tree(repo)
    if msg:
        problems.append(msg)
    return problems
