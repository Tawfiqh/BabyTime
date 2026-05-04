#!/usr/bin/env bash
# BabyTime — build (deps), optional global symlink + PATH hint, then run the server.
# Best practice: install the launcher in ~/.local/bin (no sudo, matches XDG user paths).
# /usr/local/bin is optional for multi-user Macs when you accept sudo once.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
LAUNCHER="$ROOT/bin/babytime"
# XDG-style user bin (no sudo); matches pip/uv/cargo defaults on many distros.
USER_BIN="$HOME/.local/bin"
SYSTEM_LOCAL="/usr/local/bin"
LINK_NAME="babytime"

# ── simple TUI helpers ───────────────────────────────────────────────────────-------------------

if [[ -t 1 ]]; then
  BOLD=$'\033[1m'
  DIM=$'\033[2m'
  GRN=$'\033[32m'
  YLW=$'\033[33m'
  RST=$'\033[0m'
else
  BOLD= DIM= GRN= YLW= RST=
fi

hr() { printf '%s\n' "${DIM}────────────────────────────────────────────────────────${RST}"; }
title() { printf '\n%s%s%s\n' "$BOLD" "$1" "$RST"; }
info() { printf '  %s\n' "$1"; }
warn() { printf '%s! %s%s\n' "$YLW" "$1" "$RST"; }


# ── Symlink helpers ───────────────────────────────────────────────────────-------------------

resolve_link() {
  local p="$1"
  if [[ ! -e "$p" && ! -L "$p" ]]; then
    echo ""
    return
  fi
  # Portable canonical path (readlink -f is not on macOS BSD readlink).
  python3 -c "import os,sys; print(os.path.realpath(sys.argv[1]))" "$p" 2>/dev/null \
    || realpath "$p" 2>/dev/null \
    || echo ""
}

launcher_resolved() {
  resolve_link "$LAUNCHER"
}

symlink_points_here() {
  local install_dir="$1"
  local link_path="$install_dir/$LINK_NAME"
  local want
  want="$(launcher_resolved)"
  [[ -z "$want" ]] && return 1
  if [[ -L "$link_path" ]]; then
    local got
    got="$(resolve_link "$link_path")"
    [[ "$got" == "$want" ]]
  elif [[ -f "$link_path" ]]; then
    warn "$link_path exists but is not a symlink — not overwriting."
    return 1
  else
    return 1
  fi
}

any_symlink_ok() {
  symlink_points_here "$USER_BIN" && return 0
  symlink_points_here "$SYSTEM_LOCAL" && return 0
  return 1
}

ensure_launcher_executable() {
  if [[ ! -f "$LAUNCHER" ]]; then
    echo "Missing $LAUNCHER — repository layout may be broken." >&2
    exit 1
  fi
  chmod +x "$LAUNCHER" 2>/dev/null || true
}

install_symlink() {
  local install_dir="$1"
  mkdir -p "$install_dir"
  ln -sf "$LAUNCHER" "$install_dir/$LINK_NAME"
  chmod +x "$LAUNCHER"
}

# ── Path helpers ───────────────────────────────────────────────────────────────────----------
path_has_dir() {
  local d="$1"
  case ":${PATH}:" in
    *":$d:"*) return 0 ;;
    *) return 1 ;;
  esac
}

path_has_user_bin() { path_has_dir "$USER_BIN"; }
path_has_system_local() { path_has_dir "$SYSTEM_LOCAL"; }

offer_path_snippet() {
  local shell_rc=""
  if [[ -n "${ZSH_VERSION:-}" ]] || [[ "$SHELL" == *zsh ]]; then
    shell_rc="${ZDOTDIR:-$HOME}/.zshrc"
  else
    shell_rc="$HOME/.bashrc"
  fi
  [[ -f "$HOME/.bash_profile" ]] && [[ ! -f "$HOME/.bashrc" ]] && shell_rc="$HOME/.bash_profile"

  local block_start="# >>> BabyTime PATH"
  local block_end="# <<< BabyTime PATH"
  local snippet="export PATH=\"$USER_BIN:\$PATH\""

  hr
  title "PATH (recommended)"
  info "Put user tools in ${BOLD}$USER_BIN${RST} and add that directory once to your shell config."
  info "Many Linux installs already include ~/.local/bin on PATH; macOS often does not."
  hr
  if path_has_user_bin; then
    info "${GRN}~/.local/bin is already on your PATH for this session.${RST}"
  else
    warn "Your PATH does not include $USER_BIN (for this session)."
  fi
  printf '\n'
  local ans=""
  if [[ -t 0 ]]; then
    read -r -p "Append a guarded block to ${shell_rc} now? [y/N] " ans
  fi
  local ans_lc
  ans_lc="$(printf '%s' "$ans" | tr '[:upper:]' '[:lower:]')"
  if [[ "$ans_lc" == "y" || "$ans_lc" == "yes" ]]; then
    if [[ -f "$shell_rc" ]] && grep -qF "$block_start" "$shell_rc" 2>/dev/null; then
      info "BabyTime PATH block already present in $shell_rc — skipped."
    else
      {
        echo ""
        echo "$block_start"
        echo "$snippet"
        echo "$block_end"
      } >>"$shell_rc"
      info "Appended to $shell_rc — open a new terminal or: ${BOLD}source $shell_rc${RST}"
    fi
  else
    info "Add manually: $snippet"
  fi
}


# ── MAIN ─────────────────────────────────────────────────────────────────────────------------
main_menu() {
  ensure_launcher_executable
  if [[ -t 0 && -t 1 ]]; then
    clear 2>/dev/null || true
  fi

  title "BabyTime — build & run"
  hr
  info "Repo: $ROOT"
  info "Launcher: $LAUNCHER"
  hr

  if any_symlink_ok; then
    info "${GRN}$LINK_NAME is already symlinked to this repo.${RST}"
  else
    info "${YLW}No symlink to this repo found in:${RST}"
    info "  • $USER_BIN/$LINK_NAME  (preferred — no sudo)"
    info "  • $SYSTEM_LOCAL/$LINK_NAME  (optional — needs sudo on some systems)"
  fi
  hr
  printf '\n%s\n' "${BOLD}Choose:${RST}"
  printf '  %s Run from this clone (install deps if needed)%s\n' "1)" "$RST"
  printf '  %s Symlink to ~/.local/bin, then run (asks about PATH)%s\n' "2)" "$RST"
  printf '  %s Symlink to /usr/local/bin (sudo), then run%s\n' "3)" "$RST"
  printf '  %s Exit%s\n' "4)" "$RST"
  printf '\n'
  local choice="1"
  if [[ -t 0 ]]; then
    read -r -p "Enter 1-4 [default: 1]: " choice
    choice="${choice:-1}"
  else
    info "${DIM}(non-interactive stdin — running option 1)${RST}"
  fi

  case "$choice" in
    1) ;;
    2)
      install_symlink "$USER_BIN"
      info "Installed: $USER_BIN/$LINK_NAME -> $LAUNCHER"
      offer_path_snippet
      ;;
    3)
      if [[ -w "$SYSTEM_LOCAL" ]] 2>/dev/null; then
        install_symlink "$SYSTEM_LOCAL"
      else
        info "Requesting sudo to write $SYSTEM_LOCAL/$LINK_NAME ..."
        sudo mkdir -p "$SYSTEM_LOCAL"
        sudo ln -sf "$LAUNCHER" "$SYSTEM_LOCAL/$LINK_NAME"
        sudo chmod +x "$LAUNCHER" 2>/dev/null || true
      fi
      info "Installed: $SYSTEM_LOCAL/$LINK_NAME -> $LAUNCHER"
      if ! path_has_user_bin && ! path_has_system_local; then
        warn "Neither $USER_BIN nor $SYSTEM_LOCAL is on PATH for this session."
        info "Either open a new terminal after fixing PATH, or run: export PATH=\"$SYSTEM_LOCAL:\$PATH\""
      fi
      ;;
    4) exit 0 ;;
    *)
      warn "Unknown choice — running local only."
      ;;
  esac

  hr
  title "Starting BabyTime…"
  exec bash "$ROOT/run.sh" "$@"
}

main_menu "$@"
