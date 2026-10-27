#!/bin/sh
# Roll the live house back one commit (27 Oct): a revert of the last commit on main, pushed. Render deploys it as any
# push; the walk (live.yml) reads the doors after. Usage: scripts/rollback.sh [sha]  (defaults to HEAD)
set -e
cd "$(dirname "$0")/.."
git revert --no-edit "${1:-HEAD}"
git push origin main
echo "reverted ${1:-HEAD}; Render deploys it in ten minutes"
