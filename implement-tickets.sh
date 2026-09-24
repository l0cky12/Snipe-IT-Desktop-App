#!/usr/bin/env bash
# Run /implement on each ticket in .scratch/snipe-it-desktop/issues/, one fresh
# Claude session per ticket, in number order (number order satisfies all blockers).
# Stops at the first ticket that fails, so later tickets never build on broken work.
#
#   ./implement-tickets.sh            run every ticket not yet marked done
#   DRY_RUN=1 ./implement-tickets.sh  show what would run, change nothing
#
# Each session runs unattended with permission checks bypassed. Only run this in this repo.
set -euo pipefail
cd "$(dirname "$0")"

DIR=.scratch/snipe-it-desktop
LOGS=$DIR/logs
mkdir -p "$LOGS"

if [[ -z "${DRY_RUN:-}" ]]; then
  # tickets must be tracked so each can be marked done in its own commit
  git add .gitignore implement-tickets.sh "$DIR/spec.md" "$DIR/issues"
  git diff --cached --quiet || git commit -q -m "Add v1 spec and tickets"
fi

for ticket in "$DIR"/issues/[0-9][0-9]-*.md; do
  name=$(basename "$ticket" .md)
  if grep -q '^\*\*Status:\*\* done' "$ticket"; then
    echo "skip  $name (done)"
    continue
  fi
  if [[ -n "${DRY_RUN:-}" ]]; then
    echo "would run  $name"
    continue
  fi
  if [[ -n "$(git status --porcelain)" ]]; then
    echo "STOP: working tree not clean before $name. Commit or stash, then re-run." >&2
    exit 1
  fi

  echo "run   $name  (log: $LOGS/$name.log)"
  before=$(git rev-parse HEAD)
  prompt="/implement $ticket
The spec is $DIR/spec.md. Only build this one ticket; do not start other tickets.
Work fully autonomously: no one is available to answer questions, so make the reasonable call and note it in the commit message.
Never commit config.json. Do not push."

  if ! claude -p "$prompt" --permission-mode bypassPermissions >"$LOGS/$name.log" 2>&1; then
    echo "STOP: $name session failed. See $LOGS/$name.log" >&2
    exit 1
  fi
  if [[ "$(git rev-parse HEAD)" == "$before" ]]; then
    echo "STOP: $name made no commit. See $LOGS/$name.log" >&2
    exit 1
  fi
  if [[ -n "$(git status --porcelain)" ]]; then
    echo "STOP: $name left uncommitted changes. See $LOGS/$name.log" >&2
    exit 1
  fi

  sed -i 's/^\*\*Status:\*\* .*/**Status:** done/' "$ticket"
  git add "$ticket"
  git commit -q -m "Mark ticket $name done"
  echo "done  $name"
done
echo "All tickets done."
