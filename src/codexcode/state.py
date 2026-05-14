"""Session state on disk.

Each invocation produces a session directory under ~/.codexcode/sessions/<id>/
containing the prompt, both worktrees, captured diffs, reviews, and metadata.

Sessions are removed when work is accepted or abandoned. They are not designed
to survive shell reboots cleanly; agents listing them after a crash should treat
them as recoverable scratch space.
"""
from __future__ import annotations

import json
import os
import pathlib
import secrets
import shutil
import time
from typing import Any, Dict, Optional

STATE_ROOT = pathlib.Path(os.path.expanduser("~/.codexcode"))
SESSIONS_DIR = STATE_ROOT / "sessions"

HOST = "host"
CHALLENGER = "challenger"
SIDES = (HOST, CHALLENGER)

AGENT_CLAUDE = "claude-code"
AGENT_CODEX = "codex"
AGENTS = (AGENT_CLAUDE, AGENT_CODEX)


def new_session_id() -> str:
    return secrets.token_hex(5)


def session_path(session_id: str) -> pathlib.Path:
    return SESSIONS_DIR / session_id


def meta_path(session_id: str) -> pathlib.Path:
    return session_path(session_id) / "meta.json"


def init_session(
    session_id: str,
    host_agent: str,
    challenger_agent: str,
    prompt: str,
    repo_root: str,
    base_branch: str,
    base_commit: str,
) -> Dict[str, Any]:
    if host_agent not in AGENTS or challenger_agent not in AGENTS:
        raise ValueError(f"unknown agent name in {host_agent!r}, {challenger_agent!r}")
    if host_agent == challenger_agent:
        raise ValueError("host and challenger must differ")
    sp = session_path(session_id)
    sp.mkdir(parents=True, exist_ok=False)
    (sp / "work").mkdir()
    (sp / "logs").mkdir()
    (sp / "reviews").mkdir()
    (sp / "prompt.txt").write_text(prompt, encoding="utf-8")
    meta: Dict[str, Any] = {
        "session_id": session_id,
        "version": 1,
        "created": time.time(),
        "host_agent": host_agent,
        "challenger_agent": challenger_agent,
        "repo_root": repo_root,
        "base_branch": base_branch,
        "base_commit": base_commit,
        "phase": "started",
        "challenger": {
            "pid": None,
            "branch": f"codexcode-{session_id}-{challenger_agent}",
            "worktree": str(sp / "work" / "challenger"),
            "started": None,
            "finished": None,
            "exit_code": None,
            "log": str(sp / "logs" / "challenger.log"),
        },
        "host": {
            "branch": f"codexcode-{session_id}-{host_agent}",
            "worktree": str(sp / "work" / "host"),
            "submitted": None,
        },
        "reviews": {
            "host_of_challenger": None,
            "challenger_of_host": None,
        },
    }
    save_meta(session_id, meta)
    return meta


def save_meta(session_id: str, meta: Dict[str, Any]) -> None:
    path = meta_path(session_id)
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp = path.with_suffix(".tmp")
    tmp.write_text(json.dumps(meta, indent=2), encoding="utf-8")
    tmp.replace(path)


def load_meta(session_id: str) -> Dict[str, Any]:
    path = meta_path(session_id)
    if not path.exists():
        raise FileNotFoundError(f"session not found: {session_id}")
    return json.loads(path.read_text(encoding="utf-8"))


def update_meta(session_id: str, **changes: Any) -> Dict[str, Any]:
    meta = load_meta(session_id)
    for k, v in changes.items():
        meta[k] = v
    save_meta(session_id, meta)
    return meta


def list_sessions() -> list:
    if not SESSIONS_DIR.exists():
        return []
    out = []
    for child in sorted(SESSIONS_DIR.iterdir()):
        if (child / "meta.json").exists():
            out.append(child.name)
    return out


def remove_session(session_id: str) -> None:
    sp = session_path(session_id)
    if sp.exists():
        shutil.rmtree(sp, ignore_errors=True)


def diff_path(session_id: str, side: str) -> pathlib.Path:
    if side not in SIDES:
        raise ValueError(f"unknown side: {side}")
    return session_path(session_id) / f"{side}.diff"


def review_path(session_id: str, reviewer_side: str) -> pathlib.Path:
    if reviewer_side not in SIDES:
        raise ValueError(f"unknown reviewer side: {reviewer_side}")
    return session_path(session_id) / "reviews" / f"by_{reviewer_side}.md"


def prompt_path(session_id: str) -> pathlib.Path:
    return session_path(session_id) / "prompt.txt"


def write_text(path: pathlib.Path, content: str) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(content, encoding="utf-8")


def read_text(path: pathlib.Path) -> Optional[str]:
    if not path.exists():
        return None
    return path.read_text(encoding="utf-8")
