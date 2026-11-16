#!/usr/bin/env bash
# Start a workflow on main and wait for its verdict (#66, 16 Nov). A push made with the workflow's own token starts no
# other workflow, so the promotion starts the checks and the walk itself: `workflow_dispatch` is the one event that
# token may raise. The run lands on main at the promoted commit, so its checks show on that commit and in
# `actions/runs?branch=main`. Exit 0 only for a run that finished green; anything else raises an annotation.
#   bash scripts/ci-dispatch.sh <workflow file> <sha> <title> <minutes> [-f key=value ...]
# Needs GH_TOKEN (actions: write) and GITHUB_REPOSITORY.
set -u
wf=$1 sha=$2 title=$3 mins=$4; shift 4
R=${GITHUB_REPOSITORY:?}
say() { echo "$*"; [ -n "${GITHUB_STEP_SUMMARY:-}" ] && echo "$*" >> "$GITHUB_STEP_SUMMARY"; return 0; }
fail() { echo "::error title=promote ($title)::$1"; say "**$title**: $1"; exit 1; }

since=$(date -u -d '-2 min' +%Y-%m-%dT%H:%M:%SZ)
gh api -X POST "repos/$R/actions/workflows/$wf/dispatches" -f ref=main "$@" >/dev/null || fail "GitHub refused to start $wf on main (does it list workflow_dispatch, and has the job actions: write?)."

id=""
for i in $(seq 1 30); do
  id=$(gh api "repos/$R/actions/workflows/$wf/runs?event=workflow_dispatch&branch=main&head_sha=$sha&per_page=10" \
    --jq "[.workflow_runs[] | select(.created_at >= \"$since\")] | sort_by(.created_at) | last | .id // empty" 2>/dev/null)
  [ -n "$id" ] && break
  sleep 10
done
[ -n "$id" ] || fail "$wf was asked to run on main at ${sha:0:8} and no run appeared in five minutes (main may have moved under it)."
url="https://github.com/$R/actions/runs/$id"
echo "$wf on ${sha:0:8}: $url"

st="" c=""
for i in $(seq 1 $((mins * 2))); do
  read -r st c < <(gh api "repos/$R/actions/runs/$id" --jq '"\(.status) \(.conclusion // "-")"' 2>/dev/null || echo "unknown -")
  [ "$st" = "completed" ] && break
  sleep 30
done
[ "$st" = "completed" ] || fail "$wf on main at ${sha:0:8} had not finished after $mins minutes: $url"
if [ "$c" != "success" ]; then
  bad=$(gh api "repos/$R/actions/runs/$id/jobs?filter=latest&per_page=50" --jq '[.jobs[] | select(.conclusion != "success") | "\(.name) \(.conclusion)"] | join(", ")' 2>/dev/null)
  fail "$wf on main at ${sha:0:8} is $c${bad:+ ($bad)}. The live house runs this commit: read the run's annotations, and roll back (scripts/rollback.sh) if the house is hurt. $url"
fi
say "**$title**: green on ${sha:0:8} ($url)"
