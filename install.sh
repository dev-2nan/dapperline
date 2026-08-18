#!/usr/bin/env bash
# dapperline installer — macOS, Linux, and Git Bash on Windows.
#
#   git clone https://github.com/dev-2nan/dapperline.git ~/.dapperline
#   ~/.dapperline/install.sh
#
# or, without cloning first:
#
#   curl -fsSL https://raw.githubusercontent.com/dev-2nan/dapperline/main/install.sh | bash
#
# Set DAPPERLINE_DIR to install somewhere other than ~/.dapperline.

set -euo pipefail

REPO="${DAPPERLINE_REPO:-https://github.com/dev-2nan/dapperline.git}"
DEST="${DAPPERLINE_DIR:-$HOME/.dapperline}"

die() { printf '\nerror: %s\n' "$1" >&2; exit 1; }

command -v node >/dev/null 2>&1 || die "node not found. dapperline needs Node.js 18 or newer."

NODE_MAJOR="$(node -p 'process.versions.node.split(".")[0]')"
[ "$NODE_MAJOR" -ge 18 ] || die "node $(node -v) is too old. dapperline needs 18 or newer."

# Run from a clone? Install that clone in place. Otherwise fetch one.
SRC=""
if [ -n "${BASH_SOURCE[0]:-}" ] && [ -f "$(dirname "${BASH_SOURCE[0]}")/dapperline.js" ]; then
  SRC="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
fi

if [ -n "$SRC" ]; then
  echo "dapperline: using this checkout"
  echo "  source     $SRC"
else
  command -v git >/dev/null 2>&1 || die "git not found, and no local checkout to install from."
  if [ -d "$DEST/.git" ]; then
    echo "dapperline: updating existing install"
    git -C "$DEST" pull --ff-only --quiet || die "could not update $DEST — pull manually and re-run."
  else
    [ -e "$DEST" ] && die "$DEST exists but is not a git checkout. Move it aside and re-run."
    echo "dapperline: cloning"
    git clone --quiet --depth 1 "$REPO" "$DEST" || die "clone failed. Private repo? Set up SSH or a token first."
  fi
  SRC="$DEST"
  echo "  source     $SRC"
fi

node "$SRC/scripts/patch-settings.js" "$SRC/dapperline.js"

# Prove it renders before declaring success — a status line that errors just
# shows up blank, with nothing to tell you why.
echo ""
echo "dapperline: test render"
printf '%s' '{"model":{"display_name":"Opus 5"},"workspace":{"current_dir":"."},"cwd":".","context_window":{"used_percentage":42,"total_input_tokens":420000,"context_window_size":1000000},"effort":{"level":"high"},"thinking":{"enabled":true},"rate_limits":{"five_hour":{"used_percentage":14},"seven_day":{"used_percentage":61}}}' \
  | node "$SRC/dapperline.js" | sed 's/^/  /' || die "dapperline.js failed to run."

echo ""
echo "Done. Restart Claude Code, or wait for the next update, to see it."
