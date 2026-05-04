#!/usr/bin/env bash
# Create certs/cert.pem and certs/key.pem when missing.
# Order: mkcert (locally trusted CA) if available, else OpenSSL self-signed (no root).
# Idempotent: exits 0 immediately if both cert files already exist.
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
  echo "certs/cert.pem or certs/key.pem missing (cert step skipped)." >&2
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

certs_via_mkcert() {
  echo ""
  echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
  echo "  TLS certificates not found — using mkcert"
  echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
  echo ""

  mkcert -install

  local LAN_IP
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

  rm -f certs/ca.pem
  echo ""
  echo "  Certificates installed in certs/ (mkcert)"
  echo ""
}

certs_via_openssl() {
  echo ""
  echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
  echo "  TLS certificates not found — using OpenSSL (self-signed)"
  echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
  echo "  No mkcert and no root for CA install — browsers will warn until you"
  echo "  trust the cert (e.g. download from /setup/ca.pem on each device)."
  echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
  echo ""

  if ! command -v openssl &>/dev/null; then
    echo "openssl not found on PATH. Cannot create certs." >&2
    exit 1
  fi

  mkdir -p certs
  local LAN_IP
  LAN_IP="$(guess_lan_ip || true)"

  # Not `local`: Bash 3.2 + set -u can leave trap's rm seeing an unbound local.
  _bt_openssl_cnf="$(mktemp "${TMPDIR:-/tmp}/babytime-openssl-XXXXXX.cnf")"
  trap 'rm -f "${_bt_openssl_cnf:-}"' EXIT

  {
    echo "[req]"
    echo "distinguished_name = req_distinguished_name"
    echo "x509_extensions = v3_req"
    echo "prompt = no"
    echo "[req_distinguished_name]"
    echo "CN = BabyTime local"
    echo "[v3_req]"
    echo "subjectAltName = @alt_names"
    echo "[alt_names]"
    echo "DNS.1 = localhost"
    echo "IP.1 = 127.0.0.1"
    if [[ -n "${LAN_IP:-}" ]]; then
      echo "IP.2 = $LAN_IP"
    fi
  } >"$_bt_openssl_cnf"

  openssl req -newkey rsa:2048 -nodes \
    -keyout certs/key.pem \
    -x509 -days 825 \
    -out certs/cert.pem \
    -config "$_bt_openssl_cnf" -extensions v3_req

  # Same PEM as leaf; iOS setup can install this for trust (self-signed root).
  cp -f certs/cert.pem certs/ca.pem

  echo ""
  echo "  Self-signed certificates in certs/ (OpenSSL)"
  echo ""
}

if [[ -n "${BABYTIME_NO_MKCERT:-}" ]] && command -v mkcert &>/dev/null; then
  echo "  (BABYTIME_NO_MKCERT: skipping mkcert — using OpenSSL self-signed)" >&2
  certs_via_openssl
elif command -v mkcert &>/dev/null; then
  certs_via_mkcert
elif command -v openssl &>/dev/null; then
  certs_via_openssl
else
  echo "Neither mkcert nor openssl found on PATH. Install one of them, then:" >&2
  echo "  bash install.sh   or   bash scripts/ensure-certs.sh" >&2
  exit 1
fi
