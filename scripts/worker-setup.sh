#!/usr/bin/env bash
# A worker's first minute, the same every time (agents/NOTES.md says why each line is here).
#   bash scripts/worker-setup.sh <issue-number> <short-name>     e.g.  bash scripts/worker-setup.sh 45 bars-and-width
# Run it from the shared clone (/home/claude/watermark); it never changes that clone's checkout.
set -euo pipefail
n="${1:?issue number}"; name="${2:?short name}"
root="$(git rev-parse --show-toplevel)"; wt="$(dirname "$root")/wt/$n"; br="w/$n-$name"
git -C "$root" fetch -q origin
mkdir -p "$(dirname "$wt")"
if [ -d "$wt" ]; then echo "worktree $wt exists already: using it"; else git -C "$root" worktree add "$wt" -b "$br" origin/next; fi
cd "$wt"
# The machine cannot build native modules from source (nodejs.org headers are blocked): install without scripts;
# the prebuilt binaries inside the packages load.
npm ci --no-audit --no-fund --ignore-scripts >/dev/null 2>&1 || npm install --no-audit --no-fund --ignore-scripts >/dev/null 2>&1
node -e "require('better-sqlite3');require('sharp');console.log('native modules: ok')"
echo "worktree: $wt"; echo "branch:   $br"; echo "next:     $(git rev-parse --short origin/next)"
echo "read now: CLAUDE.md, docs/WORKERS.md, agents/README.md, agents/NOTES.md, your seat's charter in agents/"
