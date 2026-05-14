"""Headless invocations of Claude Code and the Codex CLI.

For implementations: the agent is asked to do real work inside its worktree.
For reviews: the agent is asked to write to a single REVIEW.md file inside a
disposable scratch directory and modify nothing else.

We use the documented permission-bypass flags so the CLIs do not pause for
approval. These flags can be overridden via env vars for users who want to
swap in their own runner: CODEXCODE_CLAUDE_FLAGS, CODEXCODE_CODEX_FLAGS.
"""
from __future__ import annotations

import os
import shlex
import subprocess
from typing import List, Optional


def _flag_list(env_name: str, default: List[str]) -> List[str]:
    override = os.environ.get(env_name)
    if override is None:
        return list(default)
    return shlex.split(override)


def claude_flags() -> List[str]:
    return _flag_list(
        "CODEXCODE_CLAUDE_FLAGS",
        ["--dangerously-skip-permissions"],
    )


def codex_flags() -> List[str]:
    return _flag_list(
        "CODEXCODE_CODEX_FLAGS",
        ["--dangerously-bypass-approvals-and-sandbox"],
    )


def build_claude_implementation_cmd(prompt: str) -> List[str]:
    return ["claude", *claude_flags(), "-p", prompt]


def build_codex_implementation_cmd(prompt: str) -> List[str]:
    return ["codex", "exec", *codex_flags(), prompt]


def implementation_command(agent: str, prompt: str) -> List[str]:
    if agent == "claude-code":
        return build_claude_implementation_cmd(prompt)
    if agent == "codex":
        return build_codex_implementation_cmd(prompt)
    raise ValueError(f"unknown agent: {agent}")


def review_command(agent: str, prompt: str) -> List[str]:
    return implementation_command(agent, prompt)


def spawn_background(
    cmd: List[str],
    cwd: str,
    log_path: str,
    extra_env: Optional[dict] = None,
) -> int:
    """Launch cmd detached, writing combined output to log_path. Returns PID."""
    env = os.environ.copy()
    if extra_env:
        env.update(extra_env)
    log_fp = open(log_path, "wb")
    log_fp.write(
        ("$ " + " ".join(shlex.quote(p) for p in cmd) + "\n").encode("utf-8")
    )
    log_fp.flush()
    proc = subprocess.Popen(
        cmd,
        cwd=cwd,
        stdout=log_fp,
        stderr=subprocess.STDOUT,
        stdin=subprocess.DEVNULL,
        env=env,
        start_new_session=True,
    )
    return proc.pid


def pid_alive(pid: int) -> bool:
    try:
        os.kill(pid, 0)
    except ProcessLookupError:
        return False
    except PermissionError:
        return True
    return True


def run_foreground(
    cmd: List[str],
    cwd: str,
    log_path: Optional[str] = None,
    timeout: Optional[float] = None,
) -> int:
    """Run cmd in the foreground, optionally tee-ing combined output to log_path."""
    if log_path:
        with open(log_path, "ab") as log_fp:
            log_fp.write(
                (
                    "$ " + " ".join(shlex.quote(p) for p in cmd) + "\n"
                ).encode("utf-8")
            )
            proc = subprocess.run(
                cmd,
                cwd=cwd,
                stdout=log_fp,
                stderr=subprocess.STDOUT,
                stdin=subprocess.DEVNULL,
                timeout=timeout,
            )
            return proc.returncode
    proc = subprocess.run(
        cmd, cwd=cwd, stdin=subprocess.DEVNULL, timeout=timeout
    )
    return proc.returncode
