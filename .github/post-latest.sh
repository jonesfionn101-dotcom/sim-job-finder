#!/usr/bin/env bash
# Usage: post-latest.sh "<list name>" "<summary for the title>" <body file>
# Keeps ONE always-up-to-date issue per search instead of a new one every run.
set -euo pipefail
name="$1"; summary="$2"; body="$3"
title="📋 $name: $summary (updated $(TZ=Europe/Dublin date '+%d %b %H:%M'))"
issue=$(gh issue list --repo "$GITHUB_REPOSITORY" --state open --search "\"📋 $name:\" in:title" --json number,title -q ".[] | select(.title | startswith(\"📋 $name:\")) | .number" | head -1)
if [ -n "$issue" ]; then
  gh issue edit "$issue" --repo "$GITHUB_REPOSITORY" --title "$title" --body-file "$body"
else
  # Search can't see a brand-new issue yet, so take its number from the link gh prints.
  issue=$(gh issue create --repo "$GITHUB_REPOSITORY" --title "$title" --body-file "$body" | grep -o '[0-9]*$')
fi
# Keep every result, not just the newest: each run is also saved as a comment.
# archive.yml moves these comments into findings-archive.md three times a day.
[ -n "$issue" ] && gh issue comment "$issue" --repo "$GITHUB_REPOSITORY" --body-file "$body" >/dev/null || true
