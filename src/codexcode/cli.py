"""Command line entry point.

Subcommands map cleanly onto the workflow phases:

    start       prepare isolation and kick off the challenger
    status      show current phase and challenger liveness
    wait        block until the challenger finishes
    submit      snapshot a worktree's diff into session state
    review      run both cross-reviews in parallel
    artifact    render the comparison artifact to stdout
    show        print a file from either worktree
    apply       copy a side (or specific files) into the original tree
    cleanup     remove worktrees, branches, session dir
    abandon     cleanup without applying anything
    list        list active sessions
    verify      run prerequisite checks only

Every subcommand prints JSON to stdout by default so the host agent can parse
it programmatically. Pass `--human` to subcommands that support it for a
prettier rendering.
"""
from __future__ import annotations

import argparse
import json
import os
import pathlib
import sys
import time
from typing import Any, Dict, List

from . import __version__, accept, agents, artifact, isolation, review, state, verify


def _emit(payload: Any) -> None:
    sys.stdout.write(json.dumps(payload, indent=2) + "\n")
    sys.stdout.flush()


def _die(msg: str, code: int = 1) -> int:
    sys.stderr.write(msg.rstrip() + "\n")
    return code


def _read_prompt(args) -> str:
    if args.prompt_file:
        return pathlib.Path(args.prompt_file).read_text(encoding="utf-8")
    if args.prompt:
        return args.prompt
    text = sys.stdin.read()
    if not text.strip():
        raise SystemExit("no prompt provided (use --prompt, --prompt-file, or stdin)")
    return text


def cmd_verify(args) -> int:
    repo = args.repo or os.getcwd()
    try:
        repo_root = isolation.repo_root(repo)
    except isolation.GitError as exc:
        return _die(str(exc))
    problems = verify.verify_all(repo_root)
    if problems:
        for p in problems:
            sys.stderr.write("- " + p.replace("\n", "\n  ") + "\n")
        return 1
    _emit({"ok": True, "repo_root": repo_root})
    return 0


def cmd_start(args) -> int:
    repo = args.repo or os.getcwd()
    try:
        repo_root = isolation.repo_root(repo)
    except isolation.GitError as exc:
        return _die(str(exc))
    problems = verify.verify_all(repo_root)
    if problems:
        sys.stderr.write("CodexCode preflight failed:\n")
        for p in problems:
            sys.stderr.write("- " + p.replace("\n", "\n  ") + "\n")
        return 1

    host = args.host
    if host not in state.AGENTS:
        return _die(f"--host must be one of {state.AGENTS}")
    challenger = state.AGENT_CODEX if host == state.AGENT_CLAUDE else state.AGENT_CLAUDE

    prompt = _read_prompt(args)
    if not prompt.strip():
        return _die("prompt is empty")

    session_id = state.new_session_id()
    base_branch = isolation.current_branch(repo_root)
    base_commit = isolation.head_commit(repo_root)

    meta = state.init_session(
        session_id=session_id,
        host_agent=host,
        challenger_agent=challenger,
        prompt=prompt,
        repo_root=repo_root,
        base_branch=base_branch,
        base_commit=base_commit,
    )

    host_wt = meta["host"]["worktree"]
    chall_wt = meta["challenger"]["worktree"]
    isolation.create_worktree(repo_root, host_wt, meta["host"]["branch"], base_commit)
    isolation.create_worktree(
        repo_root, chall_wt, meta["challenger"]["branch"], base_commit
    )

    chall_cmd = agents.implementation_command(challenger, prompt)
    pid = agents.spawn_background(
        chall_cmd, cwd=chall_wt, log_path=meta["challenger"]["log"]
    )
    meta["challenger"]["pid"] = pid
    meta["challenger"]["started"] = time.time()
    meta["phase"] = "implementing"
    state.save_meta(session_id, meta)

    _emit(
        {
            "session_id": session_id,
            "host_agent": host,
            "challenger_agent": challenger,
            "host_worktree": host_wt,
            "challenger_worktree": chall_wt,
            "challenger_pid": pid,
            "challenger_log": meta["challenger"]["log"],
            "base_branch": base_branch,
            "base_commit": base_commit,
            "repo_root": repo_root,
            "prompt_file": str(state.prompt_path(session_id)),
        }
    )
    return 0


def cmd_status(args) -> int:
    meta = state.load_meta(args.session_id)
    alive = meta["challenger"]["pid"] and agents.pid_alive(meta["challenger"]["pid"])
    log_path = meta["challenger"]["log"]
    log_tail = ""
    if log_path and os.path.exists(log_path):
        with open(log_path, "rb") as fp:
            fp.seek(0, os.SEEK_END)
            size = fp.tell()
            fp.seek(max(0, size - 4096), os.SEEK_SET)
            log_tail = fp.read().decode("utf-8", errors="replace")
    _emit(
        {
            "session_id": meta["session_id"],
            "phase": meta["phase"],
            "challenger_alive": bool(alive),
            "challenger_pid": meta["challenger"]["pid"],
            "challenger_started": meta["challenger"]["started"],
            "challenger_finished": meta["challenger"]["finished"],
            "challenger_exit_code": meta["challenger"]["exit_code"],
            "challenger_log_tail": log_tail,
        }
    )
    return 0


def cmd_wait(args) -> int:
    meta = state.load_meta(args.session_id)
    pid = meta["challenger"]["pid"]
    if not pid:
        return _die("no challenger pid recorded")
    poll_seconds = max(0.5, float(args.poll))
    deadline = None
    if args.timeout:
        deadline = time.time() + float(args.timeout)
    while agents.pid_alive(pid):
        if deadline is not None and time.time() > deadline:
            return _die(f"timeout waiting for challenger pid {pid}", code=2)
        time.sleep(poll_seconds)
    rc = _reap_exit_code(meta["challenger"]["log"])
    meta["challenger"]["finished"] = time.time()
    meta["challenger"]["exit_code"] = rc
    meta["phase"] = "waiting_for_host_submit"
    state.save_meta(meta["session_id"], meta)
    _emit(
        {
            "session_id": meta["session_id"],
            "challenger_exit_code": rc,
            "log_path": meta["challenger"]["log"],
        }
    )
    return 0


def _reap_exit_code(log_path: str) -> int:
    """We do not have the Popen handle after spawning detached. We treat the
    challenger as done when its PID is gone. The actual exit code is not
    recoverable cross-session without a wrapper; we return 0 if no obvious
    error markers appear in the log tail, otherwise 1.
    """
    if not log_path or not os.path.exists(log_path):
        return 1
    try:
        with open(log_path, "rb") as fp:
            fp.seek(0, os.SEEK_END)
            size = fp.tell()
            fp.seek(max(0, size - 8192), os.SEEK_SET)
            tail = fp.read().decode("utf-8", errors="replace").lower()
    except OSError:
        return 1
    markers = ("traceback", "fatal", "error: unauthorized", "panic:", "command not found")
    if any(m in tail for m in markers):
        return 1
    return 0


def cmd_submit(args) -> int:
    meta = state.load_meta(args.session_id)
    side = args.side
    if side not in state.SIDES:
        return _die(f"--side must be one of {state.SIDES}")
    wt = meta["host"]["worktree"] if side == state.HOST else meta["challenger"]["worktree"]
    diff = isolation.diff_against(wt, meta["base_commit"])
    state.write_text(state.diff_path(meta["session_id"], side), diff)
    if side == state.HOST:
        meta["host"]["submitted"] = time.time()
    if (
        state.diff_path(meta["session_id"], state.HOST).exists()
        and state.diff_path(meta["session_id"], state.CHALLENGER).exists()
    ):
        meta["phase"] = "implementations_complete"
    state.save_meta(meta["session_id"], meta)
    _emit(
        {
            "session_id": meta["session_id"],
            "side": side,
            "diff_path": str(state.diff_path(meta["session_id"], side)),
            "diff_bytes": len(diff.encode("utf-8")),
        }
    )
    return 0


def cmd_collect_challenger(args) -> int:
    meta = state.load_meta(args.session_id)
    wt = meta["challenger"]["worktree"]
    diff = isolation.diff_against(wt, meta["base_commit"])
    state.write_text(state.diff_path(meta["session_id"], state.CHALLENGER), diff)
    if (
        state.diff_path(meta["session_id"], state.HOST).exists()
        and state.diff_path(meta["session_id"], state.CHALLENGER).exists()
    ):
        meta["phase"] = "implementations_complete"
    state.save_meta(meta["session_id"], meta)
    _emit(
        {
            "session_id": meta["session_id"],
            "diff_path": str(state.diff_path(meta["session_id"], state.CHALLENGER)),
            "diff_bytes": len(diff.encode("utf-8")),
        }
    )
    return 0


def cmd_review(args) -> int:
    meta = state.load_meta(args.session_id)
    if meta["phase"] not in ("implementations_complete", "reviewed"):
        # Allow re-running but warn loudly.
        sys.stderr.write(
            f"warning: session phase is {meta['phase']!r}, expected "
            f"'implementations_complete'\n"
        )
    reviews = review.run_cross_reviews(meta["session_id"])
    _emit(
        {
            "session_id": meta["session_id"],
            "host_of_challenger_path": str(
                state.review_path(meta["session_id"], state.HOST)
            ),
            "challenger_of_host_path": str(
                state.review_path(meta["session_id"], state.CHALLENGER)
            ),
            "host_of_challenger_bytes": len(reviews["host_of_challenger"]),
            "challenger_of_host_bytes": len(reviews["challenger_of_host"]),
        }
    )
    return 0


def cmd_artifact(args) -> int:
    text = artifact.render_artifact(args.session_id)
    if args.out:
        pathlib.Path(args.out).write_text(text, encoding="utf-8")
        _emit({"session_id": args.session_id, "artifact_path": args.out})
    else:
        sys.stdout.write(text)
        sys.stdout.flush()
    return 0


def cmd_show(args) -> int:
    meta = state.load_meta(args.session_id)
    wt = meta["host"]["worktree"] if args.side == state.HOST else meta["challenger"]["worktree"]
    target = pathlib.Path(wt) / args.path
    if not target.exists():
        return _die(f"file not found in {args.side}: {args.path}")
    sys.stdout.write(target.read_text(encoding="utf-8", errors="replace"))
    return 0


def cmd_files(args) -> int:
    meta = state.load_meta(args.session_id)
    wt = meta["host"]["worktree"] if args.side == state.HOST else meta["challenger"]["worktree"]
    files = isolation.changed_files(wt, meta["base_commit"])
    _emit(
        {
            "session_id": args.session_id,
            "side": args.side,
            "files": [{"status": s, "path": p} for s, p in files],
        }
    )
    return 0


def cmd_apply(args) -> int:
    meta = state.load_meta(args.session_id)
    if args.files:
        try:
            picks = accept.parse_files_spec(args.files)
        except ValueError as exc:
            return _die(str(exc))
        outcome = accept.apply_files(meta, picks)
    elif args.from_:
        if args.from_ not in state.SIDES:
            return _die(f"--from must be host or challenger, got {args.from_!r}")
        outcome = accept.apply_side(meta, args.from_)
    else:
        return _die("specify --from SIDE or --files SPEC")
    meta["phase"] = "applied"
    state.save_meta(meta["session_id"], meta)
    _emit({"session_id": meta["session_id"], **outcome})
    return 0


def cmd_cleanup(args) -> int:
    outcome = accept.cleanup_session(args.session_id)
    _emit({"session_id": args.session_id, **outcome})
    return 0


def cmd_abandon(args) -> int:
    return cmd_cleanup(args)


def cmd_list(args) -> int:
    items: List[Dict[str, Any]] = []
    for sid in state.list_sessions():
        try:
            m = state.load_meta(sid)
            items.append(
                {
                    "session_id": sid,
                    "phase": m.get("phase"),
                    "host_agent": m.get("host_agent"),
                    "challenger_agent": m.get("challenger_agent"),
                    "repo_root": m.get("repo_root"),
                    "base_branch": m.get("base_branch"),
                    "created": m.get("created"),
                }
            )
        except Exception:  # noqa: BLE001
            items.append({"session_id": sid, "phase": "unreadable"})
    _emit({"sessions": items})
    return 0


def cmd_version(args) -> int:
    _emit({"version": __version__})
    return 0


def _build_parser() -> argparse.ArgumentParser:
    p = argparse.ArgumentParser(
        prog="codexcode",
        description=(
            "Race Claude Code and Codex on the same prompt, have each "
            "critique the other, then accept a result by natural language."
        ),
    )
    p.add_argument("--version", action="store_true", help="print version and exit")
    sub = p.add_subparsers(dest="cmd")

    sp = sub.add_parser("verify", help="check prerequisites")
    sp.add_argument("--repo", default=None, help="repo root (default: cwd)")
    sp.set_defaults(func=cmd_verify)

    sp = sub.add_parser("start", help="set up isolation and launch the challenger")
    sp.add_argument("--host", required=True, choices=list(state.AGENTS))
    sp.add_argument("--repo", default=None)
    sp.add_argument("--prompt", default=None)
    sp.add_argument("--prompt-file", default=None)
    sp.set_defaults(func=cmd_start)

    sp = sub.add_parser("status", help="show session phase and challenger liveness")
    sp.add_argument("session_id")
    sp.set_defaults(func=cmd_status)

    sp = sub.add_parser("wait", help="block until the challenger exits")
    sp.add_argument("session_id")
    sp.add_argument("--poll", default="1.0", help="poll interval seconds")
    sp.add_argument("--timeout", default=None, help="seconds before giving up")
    sp.set_defaults(func=cmd_wait)

    sp = sub.add_parser("submit", help="snapshot a worktree diff into session state")
    sp.add_argument("session_id")
    sp.add_argument("--side", required=True, choices=list(state.SIDES))
    sp.set_defaults(func=cmd_submit)

    sp = sub.add_parser(
        "collect-challenger",
        help="snapshot challenger diff (shortcut for `submit --side challenger`)",
    )
    sp.add_argument("session_id")
    sp.set_defaults(func=cmd_collect_challenger)

    sp = sub.add_parser("review", help="run both cross-reviews in parallel")
    sp.add_argument("session_id")
    sp.set_defaults(func=cmd_review)

    sp = sub.add_parser("artifact", help="render the comparison artifact to stdout")
    sp.add_argument("session_id")
    sp.add_argument("--out", default=None, help="write to file instead of stdout")
    sp.set_defaults(func=cmd_artifact)

    sp = sub.add_parser("show", help="print a file from one worktree")
    sp.add_argument("session_id")
    sp.add_argument("--side", required=True, choices=list(state.SIDES))
    sp.add_argument("--path", required=True)
    sp.set_defaults(func=cmd_show)

    sp = sub.add_parser("files", help="list changed files in a worktree")
    sp.add_argument("session_id")
    sp.add_argument("--side", required=True, choices=list(state.SIDES))
    sp.set_defaults(func=cmd_files)

    sp = sub.add_parser("apply", help="copy a side or specific files into the original tree")
    sp.add_argument("session_id")
    sp.add_argument(
        "--from", dest="from_", default=None, choices=list(state.SIDES) + [None]
    )
    sp.add_argument(
        "--files",
        default=None,
        help='spec like "host:src/a.py,challenger:src/b.py"',
    )
    sp.set_defaults(func=cmd_apply)

    sp = sub.add_parser("cleanup", help="remove worktrees, branches, session dir")
    sp.add_argument("session_id")
    sp.set_defaults(func=cmd_cleanup)

    sp = sub.add_parser("abandon", help="alias for cleanup")
    sp.add_argument("session_id")
    sp.set_defaults(func=cmd_abandon)

    sp = sub.add_parser("list", help="list active sessions")
    sp.set_defaults(func=cmd_list)

    sp = sub.add_parser("version", help="print version")
    sp.set_defaults(func=cmd_version)

    return p


def main(argv: List[str] = None) -> int:
    parser = _build_parser()
    args = parser.parse_args(argv)
    if args.version:
        return cmd_version(args)
    if not getattr(args, "func", None):
        parser.print_help()
        return 1
    try:
        return args.func(args)
    except FileNotFoundError as exc:
        return _die(str(exc))
    except isolation.GitError as exc:
        return _die(str(exc))
    except KeyboardInterrupt:
        return _die("interrupted", code=130)


if __name__ == "__main__":
    sys.exit(main())
