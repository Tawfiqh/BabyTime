#!/usr/bin/env bash
# Idempotent dependency installer for BabyTime.
# Safe to run multiple times — skips steps that are already done.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"

# ── 1. Ensure uv is available ─────────────────────────────────────────────────

if ! command -v uv &>/dev/null; then
  echo "uv not found — installing..."
  if command -v brew &>/dev/null; then
    brew install uv
  else
    curl -LsSf https://astral.sh/uv/install.sh | sh
    # The installer puts uv in ~/.local/bin; add it to PATH for this session.
    export PATH="$HOME/.local/bin:$PATH"
  fi
else
  echo "uv already installed ($(uv --version))"
fi

# ── 2. Create virtual environment if absent ───────────────────────────────────

if [ ! -d ".venv" ]; then
  echo "Creating virtual environment..."
  uv venv .venv
else
  echo ".venv already exists"
fi

# ── 3. Install / sync dependencies ───────────────────────────────────────────
# uv skips packages that are already installed at the right version, so this
# is fast and safe to re-run.

echo "Syncing dependencies from requirements.txt..."
uv pip install --python .venv/bin/python -r requirements.txt

# ── 4. TLS certs (mkcert if available, else OpenSSL; do not fail whole install) ─
if ! bash "$SCRIPT_DIR/scripts/ensure-certs.sh"; then
  echo "Could not create TLS certs (need openssl or mkcert). Run: bash scripts/ensure-certs.sh after installing openssl."
fi

echo "Done."
