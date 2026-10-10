#!/usr/bin/env bash
# PreToolUse hook: blocks `gh pr merge` until the PR meets the merge rule in AGENTS.md ("The review loop").
set -euo pipefail

cmd=$(jq -r '.tool_input.command // ""')
# Only where gh is the command: at the start or after a separator, optionally behind VAR=value prefixes.
merge=$'(^|[;&|\n(])[[:space:]]*([A-Za-z_]+=(\\$\\([^)]*\\)|[^[:space:]]*)[[:space:]]+)*gh[[:space:]]+pr[[:space:]]+merge([[:space:]]+([0-9]+))?'
[[ $cmd =~ $merge ]] || exit 0
pr=${BASH_REMATCH[5]:-}

deny() { echo "guard-merge: $*" >&2; exit 2; }

view=$(gh pr view $pr --json number,headRefOid,labels,comments) || deny "can't read the PR"
number=$(jq -r .number <<<"$view")
head=$(jq -r .headRefOid <<<"$view")

for label in needs-human-review security-sensitive; do
  jq -e --arg l "$label" 'any(.labels[]; .name == $l)' <<<"$view" >/dev/null && deny "PR #$number is labelled $label: a human merges it"
done

jq -e --arg sha "${head:0:7}" 'any(.comments[]; (.body | startswith("### Codex review")) and (.body | contains($sha)))' <<<"$view" >/dev/null \
  || deny "no '### Codex review' comment names the latest commit ${head:0:7}"

gh pr checks "$number" >/dev/null 2>&1 || deny "PR #$number's checks aren't all green"

repo=$(gh repo view --json owner,name -q '.owner.login + " " + .name')
unresolved=$(gh api graphql -F owner="${repo% *}" -F name="${repo#* }" -F number="$number" -f query='
  query($owner: String!, $name: String!, $number: Int!) {
    repository(owner: $owner, name: $name) { pullRequest(number: $number) { reviewThreads(first: 100) { nodes { isResolved } } } }
  }' --jq '[.data.repository.pullRequest.reviewThreads.nodes[] | select(.isResolved | not)] | length')
[[ $unresolved == 0 ]] || deny "PR #$number has $unresolved unresolved review thread(s)"
