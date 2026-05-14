"""Applying a result back to the original working tree.

We support three apply modes:

  - `--from host`         copy every host-touched file into the original tree
  - `--from challenger`   same for the challenger
  - `--files SPEC,SPEC..` per-file selection, e.g. `host:src/a.py,challenger:src/b.py`

Apply only mutates the working tree; the host agent is expected to commit
afterwards (or invoke `codexcode commit`). Cleanup is a separate step so the
caller can inspect or amend before tearing down.
"""
from __future__ import annotations

import os
import pathlib
import shutil
from typing import Dict, List, Tuple

from . import state
from .isolation import changed_files, remove_worktree


def _side_worktree(meta: dict, side: str) -> str:
    if side == state.HOST:
        return meta["host"]["worktree"]
    if side == state.CHALLENGER:
        return meta["challenger"]["worktree"]
    raise ValueError(f"unknown side: {side}")


def _all_changed(meta: dict, side: str) -> List[Tuple[str, str]]:
    return changed_files(_side_worktree(meta, side), meta["base_commit"])


def _copy_file(src_root: str, dst_root: str, rel_path: str) -> None:
    src = pathlib.Path(src_root) / rel_path
    dst = pathlib.Path(dst_root) / rel_path
    dst.parent.mkdir(parents=True, exist_ok=True)
    if src.exists():
        shutil.copy2(src, dst)
    else:
        if dst.exists():
            dst.unlink()


def _delete_file(dst_root: str, rel_path: str) -> None:
    dst = pathlib.Path(dst_root) / rel_path
    if dst.exists():
        dst.unlink()


def apply_side(meta: dict, side: str) -> Dict[str, List[str]]:
    repo = meta["repo_root"]
    wt = _side_worktree(meta, side)
    touched = _all_changed(meta, side)
    applied = []
    deleted = []
    for status, rel_path in touched:
        if status.startswith("D"):
            _delete_file(repo, rel_path)
            deleted.append(rel_path)
        else:
            _copy_file(wt, repo, rel_path)
            applied.append(rel_path)
    return {"applied": applied, "deleted": deleted}


def parse_files_spec(spec: str) -> List[Tuple[str, str]]:
    """`host:a.py,challenger:b.py` -> [('host','a.py'), ('challenger','b.py')]"""
    out: List[Tuple[str, str]] = []
    for chunk in spec.split(","):
        chunk = chunk.strip()
        if not chunk:
            continue
        if ":" not in chunk:
            raise ValueError(
                f"bad --files entry {chunk!r}; expected SIDE:PATH"
            )
        side, _, path = chunk.partition(":")
        side = side.strip().lower()
        path = path.strip()
        if side not in (state.HOST, state.CHALLENGER):
            raise ValueError(
                f"unknown side {side!r} in {chunk!r}; want host or challenger"
            )
        if not path:
            raise ValueError(f"empty path in {chunk!r}")
        out.append((side, path))
    return out


def apply_files(
    meta: dict, picks: List[Tuple[str, str]]
) -> Dict[str, List[str]]:
    repo = meta["repo_root"]
    applied: List[str] = []
    deleted: List[str] = []
    for side, rel_path in picks:
        wt = _side_worktree(meta, side)
        src = pathlib.Path(wt) / rel_path
        if src.exists():
            _copy_file(wt, repo, rel_path)
            applied.append(f"{side}:{rel_path}")
        else:
            _delete_file(repo, rel_path)
            deleted.append(f"{side}:{rel_path}")
    return {"applied": applied, "deleted": deleted}


def cleanup_session(session_id: str) -> Dict[str, List[str]]:
    """Remove both worktrees, both ephemeral branches, and the session dir."""
    meta = state.load_meta(session_id)
    repo = meta["repo_root"]
    removed: List[str] = []
    for side in (state.HOST, state.CHALLENGER):
        side_meta = meta[side if side == state.HOST else "challenger"]
        wt = side_meta["worktree"]
        branch = side_meta["branch"]
        remove_worktree(repo, wt, branch)
        removed.append(wt)
    state.remove_session(session_id)
    return {"removed": removed}
