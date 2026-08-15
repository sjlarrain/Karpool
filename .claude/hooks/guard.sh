#!/usr/bin/env bash
# PreToolUse guard for Bash commands.
#
# Contract:
#   exit 2  -> BLOCK the command (stderr is shown to Claude as the reason)
#   exit 0  -> explicit allow, SKIPS remaining prompting  (used sparingly)
#   exit 1  -> no opinion, fall through to the normal permission flow
#
# Default is exit 1. This hook only ever *adds* restrictions; it never
# widens what settings.json permits.
#
# Enforces the five standing restrictions:
#   1. no installs without authorization
#   2. no working outside the trusted folder
#   3. no git push / merge / checkout without explicit authorization
#   4. no deletions outside the trusted folder
#   5. no deleting or weakening the rules themselves

set -uo pipefail

TRUST_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
PAYLOAD="$(cat)"

# Extract the command string from the hook JSON payload.
if command -v jq >/dev/null 2>&1; then
  CMD="$(printf '%s' "$PAYLOAD" | jq -r '.tool_input.command // empty')"
else
  CMD="$(printf '%s' "$PAYLOAD" | sed -n 's/.*"command"[[:space:]]*:[[:space:]]*"\(.*\)".*/\1/p')"
fi
[ -z "$CMD" ] && exit 1

block() {
  echo "BLOCKED by .claude/hooks/guard.sh" >&2
  echo "Rule: $1" >&2
  echo "Command: $CMD" >&2
  echo "" >&2
  echo "Ask the developer for explicit authorization, or propose an alternative that stays inside the trusted folder ($TRUST_ROOT)." >&2
  exit 2
}

# --- 5. protect the rules themselves ------------------------------------
case "$CMD" in
  *".claude/settings.json"*|*".claude/hooks"*|*"CLAUDE.md"*)
    case "$CMD" in
      *rm\ *|*mv\ *|*">"*|*sed\ -i*|*truncate*|*"tee "*)
        block "guardrail files (.claude/**, CLAUDE.md) are immutable to the agent; propose the change in chat instead" ;;
    esac ;;
esac
case "$CMD" in
  *"rm "*.gitignore*|*"git config --global"*|*"--dangerously-skip-permissions"*)
    block "attempts to remove or bypass the project's rules" ;;
esac

# --- 2. trust boundary --------------------------------------------------
case "$CMD" in
  *"cd .."*|*"cd ~"*|*"cd /"*|*"pushd .."*)
    block "changing directory outside the trusted folder" ;;
  *"/mnt/"*|*"/etc/"*|*"/usr/"*|*"/var/"*|*"/System/"*|*"C:\\"*)
    block "absolute path outside the trusted folder" ;;
esac
case "$CMD" in
  *"$HOME/.ssh"*|*"$HOME/.aws"*|*"$HOME/.gnupg"*|*"$HOME/.config"*|*"$HOME/.npmrc"*)
    block "reading credentials or config outside the trusted folder" ;;
esac

# --- 4. deletions -------------------------------------------------------
case "$CMD" in
  rm\ *|*"; rm "*|*"&& rm "*|*"| xargs rm"*|*"find "*-delete*)
    case "$CMD" in
      *" /"*|*" ~"*|*" .."*|*"*"*)
        block "deletion targeting a path outside the trusted folder, or a wildcard delete" ;;
    esac
    # in-repo deletes still fall through to the ask rule in settings.json
    ;;
esac

# --- 1. installs --------------------------------------------------------
case "$CMD" in
  *"pnpm add"*|*"pnpm install"*|*"pnpm remove"*|*"npm install"*|*"npm i "*|\
  *"yarn add"*|*"npx "*|*"pnpm dlx"*|*"brew install"*|*"apt-get install"*|\
  *"apt install"*|*"pip install"*|*"pipx install"*|*"cargo install"*|*"go install"*|\
  *"gem install"*|*"curl "*"| sh"*|*"wget "*"| sh"*)
    block "installing software requires explicit developer authorization (see 00_DEV_ENVIRONMENT_SETUP.md, Gate 2)" ;;
esac

# --- 3. git ------------------------------------------------------------
case "$CMD" in
  *"git push"*|*"git merge"*|*"git checkout"*|*"git switch"*|*"git rebase"*|\
  *"git reset --hard"*|*"git remote add"*|*"git remote set-url"*|*"git filter-branch"*|\
  *"git clean"*|*"git branch -D"*|*"git branch -d"*)
    block "git push / merge / checkout / branch and history operations require explicit developer authorization" ;;
esac

# --- secrets ------------------------------------------------------------
case "$CMD" in
  *".env"*)
    case "$CMD" in
      *cat\ *|*less\ *|*more\ *|*head\ *|*tail\ *|*grep\ *|*"echo $"*|*printenv*)
        block "reading .env files; build against variable names, never values" ;;
    esac ;;
  *printenv*|*"env |"*|*"env >"*)
    block "dumping the environment may expose secrets" ;;
esac

exit 1
