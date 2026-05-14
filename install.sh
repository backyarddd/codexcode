#!/usr/bin/env bash
# Idempotent installer for CodexCode.
#
# What this does:
#   1. Verifies Node.js 20+ and npm (and offers install hints if missing).
#   2. Symlinks bin/codexcode into a directory on PATH (default ~/.local/bin).
#   3. Optionally installs the Claude Code skill to ~/.claude/skills.
#   4. Optionally installs the Codex skill to ~/.codex/skills.
#
# Re-running the script overwrites existing symlinks safely. Use --dry-run to
# preview without changing anything.
set -e

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" >/dev/null 2>&1 && pwd)"
BIN_DEST="${CODEXCODE_BIN_DEST:-$HOME/.local/bin}"
DRY_RUN=0
SKIP_PLUGIN=0
SKIP_SKILL=0

usage() {
    cat <<EOF
Usage: ./install.sh [options]

  --bin-dest DIR       symlink codexcode into DIR (default: ~/.local/bin)
  --skip-plugin        do not install the Claude Code skill
  --skip-skill         do not install the Codex skill
  --dry-run            show what would happen, change nothing
  -h, --help           print this message

Environment overrides:
  CODEXCODE_BIN_DEST   same as --bin-dest

EOF
}

while [ $# -gt 0 ]; do
    case "$1" in
        --bin-dest) BIN_DEST="$2"; shift 2 ;;
        --skip-plugin) SKIP_PLUGIN=1; shift ;;
        --skip-skill) SKIP_SKILL=1; shift ;;
        --dry-run) DRY_RUN=1; shift ;;
        -h|--help) usage; exit 0 ;;
        *) echo "unknown option: $1" >&2; usage >&2; exit 2 ;;
    esac
done

say() { echo "[codexcode] $*"; }
do_cmd() {
    if [ "$DRY_RUN" = 1 ]; then
        echo "+ $*"
    else
        eval "$*"
    fi
}

MIN_NODE_MAJOR=20

if ! command -v node >/dev/null 2>&1; then
    cat >&2 <<EOF
CodexCode needs Node.js ${MIN_NODE_MAJOR} or newer.

Install it with one of:
  macOS (Homebrew):    brew install node
  Debian / Ubuntu:     sudo apt-get install -y nodejs npm
  Fedora / RHEL:       sudo dnf install -y nodejs npm
  Arch Linux:          sudo pacman -S nodejs npm
  Windows (winget):    winget install OpenJS.NodeJS

Then re-run ./install.sh.

EOF
    exit 1
fi
NODE_MAJOR="$(node -p 'process.versions.node.split(".")[0]')"
if [ "$NODE_MAJOR" -lt "$MIN_NODE_MAJOR" ]; then
    echo "CodexCode needs Node.js ${MIN_NODE_MAJOR} or newer, found $(node --version)." >&2
    exit 1
fi
if ! command -v npm >/dev/null 2>&1; then
    echo "CodexCode needs npm on PATH. Install npm and re-run ./install.sh." >&2
    exit 1
fi
say "found node: $(command -v node) ($(node --version))"
say "found npm: $(command -v npm) ($(npm --version))"

if ! command -v claude >/dev/null 2>&1; then
    say "warning: 'claude' CLI not found on PATH"
    say "  install: https://docs.claude.com/en/docs/claude-code"
fi
if ! command -v codex >/dev/null 2>&1; then
    say "warning: 'codex' CLI not found on PATH"
    say "  install: npm install -g @openai/codex (or see https://github.com/openai/codex)"
fi

say "installing dependencies and building TypeScript"
do_cmd "cd '$ROOT' && npm install"
do_cmd "cd '$ROOT' && npm run build"

say "symlinking $ROOT/bin/codexcode into $BIN_DEST"
do_cmd "mkdir -p '$BIN_DEST'"
do_cmd "ln -sf '$ROOT/bin/codexcode' '$BIN_DEST/codexcode'"
do_cmd "chmod +x '$ROOT/bin/codexcode'"

case ":$PATH:" in
    *":$BIN_DEST:"*) ;;
    *) say "note: $BIN_DEST is not on your PATH; add it to your shell profile" ;;
esac

if [ "$SKIP_PLUGIN" != 1 ]; then
    CLAUDE_SKILL_DEST="$HOME/.claude/skills/codexcode"
    say "installing Claude Code skill to $CLAUDE_SKILL_DEST (invoked as /codexcode)"
    do_cmd "mkdir -p '$HOME/.claude/skills'"
    do_cmd "rm -rf '$CLAUDE_SKILL_DEST'"
    do_cmd "cp -R '$ROOT/claude-plugin/skills/codexcode' '$CLAUDE_SKILL_DEST'"
fi

if [ "$SKIP_SKILL" != 1 ]; then
    CODEX_SKILL_DEST="$HOME/.codex/skills/codexcode"
    say "installing Codex skill to $CODEX_SKILL_DEST (invoked as /codexcode)"
    do_cmd "mkdir -p '$HOME/.codex/skills'"
    do_cmd "rm -rf '$CODEX_SKILL_DEST'"
    do_cmd "cp -R '$ROOT/codex-plugin/skills/codexcode' '$CODEX_SKILL_DEST'"
fi

say "done. Try:  codexcode verify"
say "if /codexcode is missing in an already-open Claude Code session, restart Claude Code"
