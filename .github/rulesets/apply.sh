#!/usr/bin/env bash
# Applies the repository's governance settings from the files in this directory, so the settings are
# reviewed in a PR like code and can be re-applied after a drift. Idempotent: rulesets are matched by name
# and replaced; toggles are set, not toggled.
#
# Requires an authenticated `gh` (an admin of the repository). Run from anywhere:
#   .github/rulesets/apply.sh
set -euo pipefail

REPO="onix-labs/onixlabs-studio"
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

echo "== rulesets"
existing="$(gh api "repos/$REPO/rulesets" --paginate)"
for file in "$HERE"/*.json; do
  name="$(jq -r .name "$file")"
  id="$(jq -r --arg n "$name" '.[] | select(.name == $n) | .id' <<<"$existing")"
  if [[ -n "$id" ]]; then
    gh api -X PUT "repos/$REPO/rulesets/$id" --input "$file" --jq '"updated  \(.name) (#\(.id))"'
  else
    gh api -X POST "repos/$REPO/rulesets" --input "$file" --jq '"created  \(.name) (#\(.id))"'
  fi
done

echo "== merge settings"
gh api -X PATCH "repos/$REPO" \
  -F allow_rebase_merge=false \
  -F delete_branch_on_merge=true \
  -F has_discussions=true \
  --jq '"rebase-merge=\(.allow_rebase_merge) delete-branch-on-merge=\(.delete_branch_on_merge) discussions=\(.has_discussions)"'

echo "== security features"
gh api -X PUT "repos/$REPO/vulnerability-alerts" && echo "dependabot alerts: on"
gh api -X PUT "repos/$REPO/automated-security-fixes" && echo "dependabot security updates: on"
gh api -X PUT "repos/$REPO/private-vulnerability-reporting" && echo "private vulnerability reporting: on"
gh api -X PATCH "repos/$REPO" --input - <<'EOF' --jq '"secret scanning=\(.security_and_analysis.secret_scanning.status) push protection=\(.security_and_analysis.secret_scanning_push_protection.status)"'
{
  "security_and_analysis": {
    "secret_scanning": { "status": "enabled" },
    "secret_scanning_push_protection": { "status": "enabled" }
  }
}
EOF

echo "== release branch"
if gh api "repos/$REPO/git/ref/heads/release" >/dev/null 2>&1; then
  echo "release: exists"
else
  sha="$(gh api "repos/$REPO/git/ref/heads/main" --jq .object.sha)"
  gh api -X POST "repos/$REPO/git/refs" -f ref=refs/heads/release -f sha="$sha" --jq '"release: created at \(.object.sha[0:8])"'
fi
