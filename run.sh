#!/usr/bin/env bash
# Start the BabyTime server.
# Runs install.sh first if the virtual environment is missing.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"

# ── 1. Install dependencies if needed ────────────────────────────────────────
# Always run install on a fresh clone (no .venv).  If everything is up to date
# uv finishes in under a second, so there's no reason to skip it.

if [ ! -d ".venv" ]; then
  echo "Virtual environment not found — running install.sh..."
  bash "$SCRIPT_DIR/install.sh"
elif ! .venv/bin/python -c "import fastapi, uvicorn" &>/dev/null; then
  echo "Dependencies missing from .venv — running install.sh..."
  bash "$SCRIPT_DIR/install.sh"
fi


# Make sure uv-installed uv is on PATH if it was just installed.
export PATH="$HOME/.local/bin:$PATH"

# ── 2. Check SSL certificates ─────────────────────────────────────────────────

if [ ! -f "certs/cert.pem" ] || [ ! -f "certs/key.pem" ]; then
  echo ""
  echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
  echo "  🔐 SSL certificates not found in certs/" - installing with brew install mkcert and mkcert -install
  echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
  echo ""
  echo "  One-time setup (brew install mkcert and mkcert -install):"
  echo ""
  brew install mkcert
  mkcert -install

  LAN_IP=$(ipconfig getifaddr en0 2>/dev/null || ipconfig getifaddr en1 2>/dev/null || echo "YOUR_LAN_IP")
  mkdir -p certs
  mkcert -cert-file certs/cert.pem -key-file certs/key.pem \
    localhost 127.0.0.1 ${LAN_IP}

  echo "  Certificates installed in certs/"
  echo ""
fi

# ── 3. Print access URLs ──────────────────────────────────────────────────────

LAN_IP=$(ipconfig getifaddr en0 2>/dev/null || ipconfig getifaddr en1 2>/dev/null || echo "")

echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "  BabyTime starting on port 8443 (HTTPS)"
echo ""
echo "  This Mac:  https://localhost:8443"
if [ -n "$LAN_IP" ]; then
  echo "  Network:   https://${LAN_IP}:8443"
  echo ""
  echo "  First time on iOS? Visit https://${LAN_IP}:8443/setup.html"
fi
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo ""

# ── 4. Start the server ───────────────────────────────────────────────────────

exec .venv/bin/python server.py
