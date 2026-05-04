#!/usr/bin/env bash
# Create certs/cert.pem and certs/key.pem with mkcert when missing.
# Idempotent: skips if both files already exist. Expects mkcert on PATH when not using --skip.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
cd "$ROOT"

SKIP=0
while [[ $# -gt 0 ]]; do
  case "$1" in
    --skip) SKIP=1; shift ;;
    *) echo "Unknown option: $1" >&2; exit 2 ;;
  esac
done

if [[ -f certs/cert.pem && -f certs/key.pem ]]; then
  exit 0
fi

if (( SKIP )); then
  echo "certs/cert.pem or certs/key.pem missing (mkcert step skipped)." >&2
  exit 1
fi

if ! command -v mkcert &>/dev/null; then
  echo "mkcert not found on PATH. Install it (e.g. brew install mkcert), then run:" >&2
  echo "  bash install.sh" >&2
  echo "or run ./run.sh without --skip-mkcert after installing mkcert." >&2
  exit 1
fi

guess_lan_ip() {
  local ip=""
  if command -v ipconfig &>/dev/null; then
    ip=$(ipconfig getifaddr en0 2>/dev/null || ipconfig getifaddr en1 2>/dev/null || true)
    [[ -n "$ip" ]] && echo "$ip" && return 0
  fi
  ip=$(ip -4 route get 8.8.8.8 2>/dev/null | awk '{for (i = 1; i < NF; i++) if ($i == "src") { print $(i + 1); exit }}')
  [[ -n "${ip:-}" ]] && echo "$ip" && return 0
  ip=$(hostname -I 2>/dev/null | awk '{print $1}')
  [[ -n "${ip:-}" ]] && echo "$ip"
}

echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "  TLS certificates not found — running mkcert"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo ""

mkcert -install

LAN_IP="$(guess_lan_ip || true)"
mkdir -p certs
if [[ -n "${LAN_IP:-}" ]]; then
  echo "  Including LAN IP in cert: $LAN_IP"
  mkcert -cert-file certs/cert.pem -key-file certs/key.pem \
    localhost 127.0.0.1 "$LAN_IP"
else
  echo "  (No LAN IP detected — cert covers localhost and 127.0.0.1 only)"
  mkcert -cert-file certs/cert.pem -key-file certs/key.pem \
    localhost 127.0.0.1
fi

echo ""
echo "  Certificates installed in certs/"
echo ""
