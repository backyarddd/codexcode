"""Comparison artifact rendering.

The artifact is a single markdown document with both diffs labeled by author,
a neutral structural summary, both reviews in full, and a short synthesis. The
two reviews are the centerpiece and appear before the diff dump.
"""
from __future__ import annotations

import re
from typing import Dict, List

from . import state


def _name_for(agent_key: str) -> str:
    return {
        "claude-code": "Claude Code",
        "codex": "Codex",
    }.get(agent_key, agent_key)


def _file_list(diff_text: str) -> List[str]:
    files = []
    for line in diff_text.splitlines():
        m = re.match(r"^diff --git a/(.+?) b/(.+?)$", line)
        if m:
            files.append(m.group(2))
    return files


def _changed_line_counts(diff_text: str) -> Dict[str, int]:
    added = sum(
        1
        for line in diff_text.splitlines()
        if line.startswith("+") and not line.startswith("+++")
    )
    removed = sum(
        1
        for line in diff_text.splitlines()
        if line.startswith("-") and not line.startswith("---")
    )
    return {"added": added, "removed": removed}


def _structural_summary(host_diff: str, chall_diff: str) -> str:
    host_files = _file_list(host_diff)
    chall_files = _file_list(chall_diff)
    host_counts = _changed_line_counts(host_diff)
    chall_counts = _changed_line_counts(chall_diff)

    host_set = set(host_files)
    chall_set = set(chall_files)
    shared = sorted(host_set & chall_set)
    only_host = sorted(host_set - chall_set)
    only_chall = sorted(chall_set - host_set)

    lines = []
    lines.append("| Aspect | Host | Challenger |")
    lines.append("| --- | --- | --- |")
    lines.append(
        f"| Files changed | {len(host_files)} | {len(chall_files)} |"
    )
    lines.append(
        f"| Lines added | {host_counts['added']} | {chall_counts['added']} |"
    )
    lines.append(
        f"| Lines removed | {host_counts['removed']} | {chall_counts['removed']} |"
    )
    lines.append("")

    def _bullet_list(items: List[str]) -> str:
        if not items:
            return "_(none)_"
        return "\n".join(f"- `{item}`" for item in items)

    lines.append("**Touched by both attempts:**")
    lines.append(_bullet_list(shared))
    lines.append("")
    lines.append("**Touched only by host:**")
    lines.append(_bullet_list(only_host))
    lines.append("")
    lines.append("**Touched only by challenger:**")
    lines.append(_bullet_list(only_chall))
    lines.append("")
    return "\n".join(lines)


def _diff_section(title: str, diff_text: str) -> str:
    body = diff_text.strip() or "_(no changes produced)_"
    return f"### {title}\n\n```diff\n{body}\n```\n"


def render_artifact(session_id: str) -> str:
    meta = state.load_meta(session_id)
    prompt = state.read_text(state.prompt_path(session_id)) or ""
    host_diff = state.read_text(state.diff_path(session_id, state.HOST)) or ""
    chall_diff = (
        state.read_text(state.diff_path(session_id, state.CHALLENGER)) or ""
    )
    host_review = (
        state.read_text(state.review_path(session_id, state.HOST))
        or "_(review unavailable)_"
    )
    chall_review = (
        state.read_text(state.review_path(session_id, state.CHALLENGER))
        or "_(review unavailable)_"
    )

    host_name = _name_for(meta["host_agent"])
    chall_name = _name_for(meta["challenger_agent"])

    parts: List[str] = []
    parts.append(f"# CodexCode comparison `{session_id}`\n")
    parts.append(
        f"Host: **{host_name}**   Challenger: **{chall_name}**   "
        f"Base: `{meta['base_branch']}` @ `{meta['base_commit'][:12]}`\n"
    )
    parts.append("## Original prompt\n")
    parts.append("```\n" + prompt.rstrip() + "\n```\n")

    parts.append("## Cross-reviews\n")
    parts.append(
        "The two agents reviewed each other's work independently. Neither "
        "saw its own diff while reviewing, and neither saw the other "
        "review.\n"
    )
    parts.append(
        f"### {host_name} reviewing {chall_name}\n\n"
        + host_review.rstrip()
        + "\n"
    )
    parts.append(
        f"### {chall_name} reviewing {host_name}\n\n"
        + chall_review.rstrip()
        + "\n"
    )

    parts.append("## Structural summary\n")
    parts.append(_structural_summary(host_diff, chall_diff))

    parts.append("## Diffs\n")
    parts.append(
        _diff_section(f"{host_name} (host) diff", host_diff)
    )
    parts.append(
        _diff_section(f"{chall_name} (challenger) diff", chall_diff)
    )

    parts.append("## Next step\n")
    parts.append(
        "Tell the host agent in plain English what you want to do: accept "
        "either attempt in full, take specific files from each side, "
        "compose a hybrid, retry with a tweaked prompt, or just inspect a "
        "file. The agent will figure out the rest.\n"
    )
    return "\n".join(parts)
