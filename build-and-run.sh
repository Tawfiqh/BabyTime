#!/usr/bin/env bash
# BabyTime — build (deps) and run. Optionally install a global `babytime` symlink.
# Prefer ~/.local/bin (no sudo). /usr/local/bin is optional for shared machines.
# With a TTY and no flags: short numbered list (no clear / full-screen UI).
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
LAUNCHER="$ROOT/bin/babytime"
USER_BIN="$HOME/.local/bin"
SYSTEM_LOCAL="/usr/local/bin"
LINK_NAME="babytime"

if [[ -t 1 ]]; then
  BOLD=$'\033[1m' DIM=$'\033[2m' GRN=$'\033[32m' YLW=$'\033[33m' RST=$'\033[0m'
else
  BOLD= DIM= GRN= YLW= RST=
fi

# --- symlinks ----------------------------------------------------------------

resolve_link() {
  local p="$1"
  if [[ ! -e "$p" && ! -L "$p" ]]; then
    echo ""
    return
  fi
  python3 -c "import os,sys; print(os.path.realpath(sys.argv[1]))" "$p" 2>/dev/null \
    || realpath "$p" 2>/dev/null \
    || echo ""
}

launcher_resolved() { resolve_link "$LAUNCHER"; }

symlink_points_here() {
  # Bash 3.2 + set -u: one `local` line cannot reference another local on the same line.
  local install_dir="$1"
  local link_path="$install_dir/$LINK_NAME"
  local want got
  want="$(launcher_resolved)"
  [[ -z "$want" ]] && return 1
  if [[ -L "$link_path" ]]; then
    got="$(resolve_link "$link_path")"
    [[ "$got" == "$want" ]]
  elif [[ -f "$link_path" ]]; then
    printf '%s! %s exists but is not a symlink — not overwriting.%s\n' "$YLW" "$link_path" "$RST" >&2
    return 1
  else
    return 1
  fi
}

any_symlink_ok() {
  symlink_points_here "$USER_BIN" || symlink_points_here "$SYSTEM_LOCAL"
}

ensure_launcher_executable() {
  [[ -f "$LAUNCHER" ]] || { echo "Missing $LAUNCHER — repository layout may be broken." >&2; exit 1; }
  chmod +x "$LAUNCHER" 2>/dev/null || true
}

install_symlink() {
  local dir="$1"
  mkdir -p "$dir"
  ln -sf "$LAUNCHER" "$dir/$LINK_NAME"
  chmod +x "$LAUNCHER"
}

install_user_symlink() {
  install_symlink "$USER_BIN"
  printf '%sInstalled %s -> %s%s\n' "$GRN" "$USER_BIN/$LINK_NAME" "$LAUNCHER" "$RST"
}

install_system_symlink() {
  if [[ -w "$SYSTEM_LOCAL" ]] 2>/dev/null; then
    install_symlink "$SYSTEM_LOCAL"
  else
    printf '%sInstalling to %s (sudo)...%s\n' "$DIM" "$SYSTEM_LOCAL" "$RST"
    sudo mkdir -p "$SYSTEM_LOCAL"
    sudo ln -sf "$LAUNCHER" "$SYSTEM_LOCAL/$LINK_NAME"
    sudo chmod +x "$LAUNCHER" 2>/dev/null || true
  fi
  printf '%sInstalled %s -> %s%s\n' "$GRN" "$SYSTEM_LOCAL/$LINK_NAME" "$LAUNCHER" "$RST"
}

hint_path_if_system_local_missing() {
  path_has_system_local && return 0
  printf '%s%s is not on PATH for this shell.%s\n' "$YLW" "$SYSTEM_LOCAL" "$RST"
  printf '  Try: %sexport PATH="%s:$PATH"%s\n' "$BOLD" "$SYSTEM_LOCAL" "$RST"
}

# --- PATH --------------------------------------------------------------------

path_has_dir() {
  local d="$1"
  case ":${PATH}:" in *":$d:"*) return 0 ;; *) return 1 ;; esac
}

path_has_user_bin() { path_has_dir "$USER_BIN"; }
path_has_system_local() { path_has_dir "$SYSTEM_LOCAL"; }

default_shell_rc() {
  if [[ -n "${ZSH_VERSION:-}" ]] || [[ "${SHELL:-}" == *zsh ]]; then
    echo "${ZDOTDIR:-$HOME}/.zshrc"
  elif [[ -f "$HOME/.bash_profile" ]] && [[ ! -f "$HOME/.bashrc" ]]; then
    echo "$HOME/.bash_profile"
  else
    echo "$HOME/.bashrc"
  fi
}

append_path_block() {
  local shell_rc="${1:-$(default_shell_rc)}" block_start="# >>> BabyTime PATH" block_end="# <<< BabyTime PATH"
  local snippet="export PATH=\"$USER_BIN:\$PATH\""

  if [[ -f "$shell_rc" ]] && grep -qF "$block_start" "$shell_rc" 2>/dev/null; then
    printf '%sBabyTime PATH block already in %s — skipped.%s\n' "$DIM" "$shell_rc" "$RST"
    return 0
  fi
  mkdir -p "$(dirname "$shell_rc")" 2>/dev/null || true
  {
    echo ""
    echo "$block_start"
    echo "$snippet"
    echo "$block_end"
  } >>"$shell_rc"
  printf '%sAppended PATH snippet to %s%s\n' "$GRN" "$shell_rc" "$RST"
  printf '  Open a new terminal or: %ssource %s%s\n' "$BOLD" "$shell_rc" "$RST"
}

offer_path_prompt() {
  local shell_rc ans ans_lc
  shell_rc="$(default_shell_rc)"
  printf '\n'
  if [[ ! -t 0 ]]; then
    printf '%s(non-interactive: not editing shell rc; add PATH yourself if needed)%s\n' "$DIM" "$RST"
    return 0
  fi
  read -r -p "Append ~/.local/bin to PATH in ${shell_rc}? [y/N] " ans
  ans_lc="$(printf '%s' "$ans" | tr '[:upper:]' '[:lower:]')"
  if [[ "$ans_lc" == "y" || "$ans_lc" == "yes" ]]; then
    append_path_block "$shell_rc"
  else
    printf '%sSkipped. You can add later: export PATH="$HOME/.local/bin:$PATH"%s\n' "$DIM" "$RST"
  fi
}

print_status() {
  printf '\n%sBabyTime%s  repo: %s\n' "$BOLD" "$RST" "$ROOT"
  if any_symlink_ok; then
    printf '  %s%s is symlinked to this repo.%s\n' "$GRN" "$LINK_NAME" "$RST"
    if symlink_points_here "$USER_BIN" && ! path_has_user_bin; then
      printf '  %sNote:%s ~/.local/bin is not on PATH for this shell.\n' "$YLW" "$RST"
      printf '        Add once: %sexport PATH="$HOME/.local/bin:$PATH"%s\n' "$BOLD" "$RST"
    elif symlink_points_here "$SYSTEM_LOCAL" && ! path_has_system_local; then
      printf '  %sNote:%s %s is not on PATH for this shell.\n' "$YLW" "$RST" "$SYSTEM_LOCAL"
      printf '        Add once: %sexport PATH="%s:$PATH"%s\n' "$BOLD" "$SYSTEM_LOCAL" "$RST"
    fi
  else
    printf '  %sNo %s symlink yet in ~/.local/bin or /usr/local/bin.%s\n' "$YLW" "$LINK_NAME" "$RST"
    printf '  %sOr use flags:%s ./build-and-run.sh --install-user [--add-to-path]%s\n' "$DIM" "$BOLD" "$RST"
    if ! path_has_user_bin && ! path_has_system_local; then
      printf '  %sNote:%s ~/.local/bin and /usr/local/bin are not on PATH for this shell.\n' "$YLW" "$RST"
      printf '        Add once: %sexport PATH="$HOME/.local/bin:$PATH"%s\n' "$BOLD" "$RST"
    fi
  fi
}

interactive_menu() {
  print_status
  printf '\n%sChoose:%s\n' "$BOLD" "$RST"
  printf '  1) Symlink to ~/.local/bin, then run (asks about PATH)\n'
  printf '  2) Symlink to /usr/local/bin (sudo), then run\n'
  printf '  3) Run from this clone (install deps if needed)\n'
  printf '  4) Exit\n\n'
  local choice
  read -r -p "Enter 1-4 [default: 3]: " choice
  choice="${choice:-3}"
  case "$choice" in
    1) install_user_symlink; offer_path_prompt ;;
    2) install_system_symlink; hint_path_if_system_local_missing ;;
    3) ;;
    4) exit 0 ;;
    *) printf '%sUnknown choice — running from this clone.%s\n' "$YLW" "$RST" ;;
  esac
}

usage() {
  cat >&2 <<'EOF'
BabyTime — build (deps) and run. Optionally install a global `babytime` symlink.

Usage: ./build-and-run.sh [options]

  With a TTY and no options: short numbered menu, then start (see script header).

  --install-user        Symlink babytime -> ~/.local/bin (no sudo)
  --install-system      Symlink babytime -> /usr/local/bin (sudo if needed)
  --add-to-path [FILE]  Append ~/.local/bin to PATH in shell rc (default: auto-detect)
  -h, --help            Show this help

Examples:
  ./build-and-run.sh
  ./build-and-run.sh --install-user --add-to-path
EOF
}

INSTALL_USER=0
INSTALL_SYSTEM=0
ADD_TO_PATH=0
PATH_RC=""
RUN_ARGS=()

while [[ $# -gt 0 ]]; do
  case "$1" in
    -h|--help) usage; exit 0 ;;
    --install-user) INSTALL_USER=1; shift ;;
    --install-system) INSTALL_SYSTEM=1; shift ;;
    --add-to-path)
      ADD_TO_PATH=1
      shift
      if [[ $# -gt 0 && "$1" != --* ]]; then PATH_RC="$1"; shift; fi
      ;;
    --) shift; RUN_ARGS+=("$@"); break ;;
    *) RUN_ARGS+=("$1"); shift ;;
  esac
done

ensure_launcher_executable

FLAG_MODE=0
(( INSTALL_USER || INSTALL_SYSTEM || ADD_TO_PATH )) && FLAG_MODE=1

if (( FLAG_MODE )); then
  (( INSTALL_USER && INSTALL_SYSTEM )) && { echo "Use only one of --install-user or --install-system." >&2; exit 1; }
  (( INSTALL_USER )) && install_user_symlink
  (( INSTALL_SYSTEM )) && { install_system_symlink; hint_path_if_system_local_missing; }
  (( ADD_TO_PATH )) && append_path_block "${PATH_RC:-}"
  print_status
elif [[ -t 0 ]]; then
  interactive_menu
else
  print_status
fi

printf '\n%sStarting…%s\n\n' "$BOLD" "$RST"
# Bash 3.2 + set -u: "${RUN_ARGS[@]}" errors when the array is empty.
if [[ ${#RUN_ARGS[@]} -gt 0 ]]; then
  exec bash "$ROOT/run.sh" "${RUN_ARGS[@]}"
else
  exec bash "$ROOT/run.sh"
fi
