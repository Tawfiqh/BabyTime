#!/usr/bin/env bash
# Start the BabyTime server.
# Runs install.sh first if the virtual environment is missing.
# TLS: scripts/ensure-certs.sh (mkcert if available, else OpenSSL — no root).
# --skip-mkcert: never use mkcert; use OpenSSL self-signed when certs missing.
# --http: plain HTTP on port 8442 (local testing; camera on localhost only).
# By default runs git pull --ff-only when .git exists; use --skip-git-pull to skip.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"

SKIP_MKCERT=0
SKIP_GIT_PULL=0
USE_HTTP=0
PY_ARGS=()
while [[ $# -gt 0 ]]; do
  case "$1" in
    --skip-mkcert) SKIP_MKCERT=1; shift ;;
    --skip-git-pull) SKIP_GIT_PULL=1; shift ;;
    --http) USE_HTTP=1; shift ;;
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
uv sync


# ── 2. TLS certificates (skip entirely in --http mode) ───────────────────────

if (( USE_HTTP )); then
  echo ""
  echo "  HTTP mode (--http): not generating TLS certs."
  echo ""
elif [ ! -f "certs/cert.pem" ] || [ ! -f "certs/key.pem" ]; then
  if (( SKIP_MKCERT )); then
    BABYTIME_NO_MKCERT=1 bash "$SCRIPT_DIR/scripts/ensure-certs.sh"
  else
    bash "$SCRIPT_DIR/scripts/ensure-certs.sh"
  fi
fi

# ── 3. Start the server ───────────────────────────────────────────────────────

# The shell already ate --http in the option parser; forward it to server.py explicitly.
(( USE_HTTP )) && PY_ARGS=(--http "${PY_ARGS[@]}")

# Pass through any extra CLI args to server.py, or call it with no extras if none remain.
[[ ${#PY_ARGS[@]} -gt 0 ]] \
  && exec .venv/bin/python server.py "${PY_ARGS[@]}" \
  || exec .venv/bin/python server.py
