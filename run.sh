#!/usr/bin/env bash
# Start the BabyTime server.
# Runs install.sh first if the virtual environment is missing.
# TLS: certs are created via scripts/ensure-certs.sh (from install.sh or here)
# unless you pass --skip-mkcert (then missing certs exit with a hint).
# By default runs git pull --ff-only when .git exists; use --skip-git-pull to skip.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"

SKIP_MKCERT=0
SKIP_GIT_PULL=0
PY_ARGS=()
while [[ $# -gt 0 ]]; do
  case "$1" in
    --skip-mkcert) SKIP_MKCERT=1; shift ;;
    --skip-git-pull) SKIP_GIT_PULL=1; shift ;;
    *) PY_ARGS+=("$1"); shift ;;
  esac
done

# ── 0. Sync with remote (fast-forward only) ───────────────────────────────────

if (( ! SKIP_GIT_PULL )) && [[ -d .git ]] && command -v git &>/dev/null; then
  echo ""
  echo "  git pull --ff-only …"
  if ! git pull --ff-only; then
    echo "  Warning: git pull failed (offline, local commits, or non-ff?). Continuing." >&2
  fi
  echo ""
fi

# ── 1. Install dependencies if needed ───────────────────────────────────────────

if [ ! -d ".venv" ]; then
  echo "Virtual environment not found — running install.sh..."
  bash "$SCRIPT_DIR/install.sh"
elif ! .venv/bin/python -c "import fastapi, uvicorn" &>/dev/null; then
  echo "Dependencies missing from .venv — running install.sh..."
  bash "$SCRIPT_DIR/install.sh"
fi

export PATH="$HOME/.local/bin:$PATH"

# ── 2. TLS certificates ───────────────────────────────────────────────────────

if [ ! -f "certs/cert.pem" ] || [ ! -f "certs/key.pem" ]; then
  if (( SKIP_MKCERT )); then
    echo "" >&2
    echo "ERROR: certs/cert.pem or certs/key.pem missing and --skip-mkcert was set." >&2
    echo "  Remove --skip-mkcert to generate certs, or run: bash install.sh (with mkcert installed)" >&2
    echo "" >&2
    exit 1
  fi
  bash "$SCRIPT_DIR/scripts/ensure-certs.sh"
fi

# ── 3. Print access URLs ──────────────────────────────────────────────────────

LAN_IP=""
if command -v ipconfig &>/dev/null; then
  LAN_IP=$(ipconfig getifaddr en0 2>/dev/null || ipconfig getifaddr en1 2>/dev/null || echo "")
fi

echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "  BabyTime starting on port 8443 (HTTPS)"
echo ""
echo "  This machine:  https://localhost:8443"
if [ -n "$LAN_IP" ]; then
  echo "  Network:   https://${LAN_IP}:8443"
  echo ""
  echo "  First time on iOS? Visit https://${LAN_IP}:8443/setup.html"
fi
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo ""

# ── 4. Start the server ───────────────────────────────────────────────────────

if [[ ${#PY_ARGS[@]} -gt 0 ]]; then
  exec .venv/bin/python server.py "${PY_ARGS[@]}"
else
  exec .venv/bin/python server.py
fi
