"""Cross-review orchestration.

Each agent reviews the other's diff. To prevent the reviewing agent from
mutating anything sensitive, we run the review inside a fresh scratch directory
containing only the prompt, the other agent's diff, and a placeholder REVIEW.md
the agent is asked to fill in.

Reviews run independently and in parallel. Neither agent sees the other agent's
review, and neither agent sees its own implementation diff while reviewing.
"""
from __future__ import annotations

import concurrent.futures
import os
import pathlib
import shutil
import tempfile
from typing import Tuple

from . import state
from .agents import implementation_command, run_foreground

REVIEW_PROMPT_TEMPLATE = """\
You are reviewing another coding agent's implementation of a task.

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
"""


def _prepare_review_workspace(
    workspace: pathlib.Path, prompt: str, diff_text: str
) -> None:
    workspace.mkdir(parents=True, exist_ok=True)
    (workspace / "PROMPT.md").write_text(prompt, encoding="utf-8")
    (workspace / "OTHER_DIFF.patch").write_text(diff_text, encoding="utf-8")
    (workspace / "REVIEW.md").write_text(
        "<!-- write your review here; replace this placeholder -->\n",
        encoding="utf-8",
    )


def _run_one_review(
    agent: str,
    prompt: str,
    diff_text: str,
    workspace: pathlib.Path,
    log_path: pathlib.Path,
) -> Tuple[int, str]:
    _prepare_review_workspace(workspace, prompt, diff_text)
    cmd = implementation_command(agent, REVIEW_PROMPT_TEMPLATE)
    rc = run_foreground(cmd, cwd=str(workspace), log_path=str(log_path))
    review = (workspace / "REVIEW.md").read_text(encoding="utf-8")
    return rc, review


def run_cross_reviews(session_id: str) -> dict:
    """Run both cross-reviews in parallel. Returns dict with both review texts.

    On error, the corresponding review text is replaced with an inline failure
    note so the artifact still renders cleanly.
    """
    meta = state.load_meta(session_id)
    prompt = state.read_text(state.prompt_path(session_id)) or ""
    host_diff = state.read_text(state.diff_path(session_id, state.HOST)) or ""
    chall_diff = (
        state.read_text(state.diff_path(session_id, state.CHALLENGER)) or ""
    )

    sp = state.session_path(session_id)
    reviews_root = sp / "reviews"
    reviews_root.mkdir(parents=True, exist_ok=True)

    host_agent = meta["host_agent"]
    chall_agent = meta["challenger_agent"]

    host_ws = reviews_root / "host_workspace"
    chall_ws = reviews_root / "challenger_workspace"

    if host_ws.exists():
        shutil.rmtree(host_ws)
    if chall_ws.exists():
        shutil.rmtree(chall_ws)

    host_log = sp / "logs" / "host_review.log"
    chall_log = sp / "logs" / "challenger_review.log"

    def _host_reviews_challenger():
        try:
            rc, text = _run_one_review(
                host_agent, prompt, chall_diff, host_ws, host_log
            )
            return rc, text
        except Exception as exc:  # noqa: BLE001
            return 1, f"_review failed to run: {exc}_\n"

    def _challenger_reviews_host():
        try:
            rc, text = _run_one_review(
                chall_agent, prompt, host_diff, chall_ws, chall_log
            )
            return rc, text
        except Exception as exc:  # noqa: BLE001
            return 1, f"_review failed to run: {exc}_\n"

    with concurrent.futures.ThreadPoolExecutor(max_workers=2) as pool:
        f_host = pool.submit(_host_reviews_challenger)
        f_chall = pool.submit(_challenger_reviews_host)
        rc_host, text_host = f_host.result()
        rc_chall, text_chall = f_chall.result()

    state.write_text(state.review_path(session_id, state.HOST), text_host)
    state.write_text(state.review_path(session_id, state.CHALLENGER), text_chall)

    state.update_meta(
        session_id,
        reviews={
            "host_of_challenger": {
                "exit_code": rc_host,
                "log": str(host_log),
            },
            "challenger_of_host": {
                "exit_code": rc_chall,
                "log": str(chall_log),
            },
        },
        phase="reviewed",
    )

    return {
        "host_of_challenger": text_host,
        "challenger_of_host": text_chall,
    }
