#!/usr/bin/env bash
# Clear-out with nothing lost: copies every saved search result (the comments on
# the 📋 issues) into findings-archive.md, pushes it, and only THEN deletes the
# comments. If the push fails, nothing is deleted.
set -euo pipefail
file=findings-archive.md
[ -f "$file" ] || printf '# Everything the searches have found\n\nNewest clear-out at the bottom. Nothing here is ever deleted.\n' > "$file"
stamp=$(TZ=Europe/Dublin date '+%d %b %Y %H:%M')
ids=()
saved=0
printf '\n---\n\n# Clear-out %s\n' "$stamp" >> "$file"
for issue in $(gh issue list --repo "$GITHUB_REPOSITORY" --state open --search '"📋" in:title' --json number -q '.[].number'); do
  title=$(gh issue view "$issue" --repo "$GITHUB_REPOSITORY" --json title -q .title)
  comments=$(gh api --paginate "repos/$GITHUB_REPOSITORY/issues/$issue/comments" -q '.[] | select(.user.login == "github-actions[bot]") | @base64')
  [ -z "$comments" ] && continue
  printf '\n## %s\n' "${title%% (updated*}" >> "$file"
  for row in $comments; do
    json=$(echo "$row" | base64 -d)
    printf '\n### Run of %s\n\n%s\n' "$(echo "$json" | jq -r '.created_at')" "$(echo "$json" | jq -r '.body')" >> "$file"
    ids+=("$(echo "$json" | jq -r '.id')")
    saved=$((saved + 1))
  done
done
if [ "$saved" -eq 0 ]; then echo "Nothing new to archive."; git checkout -- "$file" 2>/dev/null || rm -f "$file"; exit 0; fi
git config user.name "github-actions[bot]"
git config user.email "41898282+github-actions[bot]@users.noreply.github.com"
git add "$file"
git commit -qm "Clear-out $stamp: $saved results saved to $file"
git push -q
echo "Saved $saved results. Clearing them from the issues now."
for id in "${ids[@]}"; do gh api -X DELETE "repos/$GITHUB_REPOSITORY/issues/comments/$id" >/dev/null; done
