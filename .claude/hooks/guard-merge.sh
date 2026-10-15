#!/usr/bin/env bash
# PreToolUse hook: blocks `gh pr merge` until the PR meets the merge rule in AGENTS.md ("The review loop").
# Exit 2 blocks; any other failure is turned into exit 2 too, so a check that can't run never lets a merge through.
set -Eeuo pipefail

deny() { echo "guard-merge: $*" >&2; exit 2; }
trap 'deny "a check failed, so the merge is blocked"' ERR

cmd=$(jq -r '.tool_input.command // ""')
# Only where gh is the command: at the start or after a separator, optionally behind VAR=value prefixes.
merge=$'(^|[;&|\n(])[[:space:]]*([A-Za-z_]+=(\\$\\([^)]*\\)|[^[:space:]]*)[[:space:]]+)*gh[[:space:]]+pr[[:space:]]+merge([[:space:]]+([0-9]+)([[:space:]]|$))?'
[[ $cmd =~ $merge ]] || exit 0

# Only check what can be checked exactly: one PR, by number, in this checkout's repo.
pr=${BASH_REMATCH[5]:-}
[[ -n $pr ]] || deny "name the PR number right after merge: gh pr merge <number> --squash"
rest=${cmd#*"${BASH_REMATCH[0]}"}
[[ $rest =~ pr[[:space:]]+merge ]] && deny "merge one PR per command"
[[ $cmd =~ (^|[[:space:]])(-R|--repo|GH_REPO=) ]] && deny "merge from this checkout, without -R/--repo or GH_REPO"

view=$(gh pr view "$pr" --json headRefOid,labels,comments)
head=$(jq -r .headRefOid <<<"$view")

for label in needs-human-review security-sensitive; do
  if jq -e --arg l "$label" 'any(.labels[]; .name == $l)' <<<"$view" >/dev/null; then deny "PR #$pr is labelled $label: a human merges it"; fi
done

jq -e --arg sha "${head:0:7}" 'any(.comments[]; (.body | startswith("### Codex review")) and (.body | contains($sha)))' <<<"$view" >/dev/null \
  || deny "no '### Codex review' comment names the latest commit ${head:0:7}"

gh pr checks "$pr" >/dev/null 2>&1 || deny "PR #$pr's checks aren't all green"

repo=$(gh repo view --json owner,name -q '.owner.login + " " + .name')
unresolved=$(gh api graphql --paginate -F owner="${repo% *}" -F name="${repo#* }" -F number="$pr" -f query='
  query($owner: String!, $name: String!, $number: Int!, $endCursor: String) {
    repository(owner: $owner, name: $name) { pullRequest(number: $number) {
      reviewThreads(first: 100, after: $endCursor) { nodes { isResolved } pageInfo { hasNextPage endCursor } }
    } }
  }' --jq '.data.repository.pullRequest.reviewThreads.nodes[] | select(.isResolved | not) | 1' | wc -l)
[[ $unresolved == 0 ]] || deny "PR #$pr has $unresolved unresolved review thread(s)"
