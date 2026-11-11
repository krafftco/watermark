#!/usr/bin/env bash
# CI's system packages, installed so that a failure can be read: the cloud shell cannot open CI's logs, so the last
# lines of a failed try are raised as an annotation. Each try is bounded; nothing here may wait for a person.
set -u
export DEBIAN_FRONTEND=noninteractive NEEDRESTART_MODE=a NEEDRESTART_SUSPEND=1
APT="sudo -E apt-get -o Acquire::Retries=2 -o Acquire::http::Timeout=20 -o Acquire::ForceIPv4=true -o DPkg::Lock::Timeout=60 -o Dpkg::Options::=--force-confold"
note() { tail -c 1400 "$1" | tr '\n' ' ' | sed 's/%/%25/g' | awk -v k="$2" '{print "::" k "::" $0}'; }
# (11 Nov: the runners' own mirror, azure.archive.ubuntu.com, stopped resolving for hours; every run died here.) The
# runner takes its mirrors from /etc/apt/apt-mirrors.txt: when Azure's does not resolve, use Ubuntu's own archive.
# Later the same morning archive.ubuntu.com stopped resolving from the runners too: the list falls through to mirrors
# outside ubuntu.com (kernel.org, then two universities), whichever resolves first leading.
plain() {
  : > /tmp/mirrors.txt; n=1
  for m in http://archive.ubuntu.com/ubuntu/ https://mirrors.edge.kernel.org/ubuntu/ https://mirror.math.princeton.edu/pub/ubuntu/ https://mirrors.mit.edu/ubuntu/; do
    h=$(echo "$m" | sed -E 's|https?://([^/]+)/.*|\1|'); if getent hosts "$h" > /dev/null 2>&1; then printf '%s\tpriority:%s\n' "$m" "$n" >> /tmp/mirrors.txt; n=$((n+1)); fi
  done
  [ -s /tmp/mirrors.txt ] || printf 'https://mirrors.edge.kernel.org/ubuntu/\tpriority:1\n' > /tmp/mirrors.txt
  sudo cp /tmp/mirrors.txt /etc/apt/apt-mirrors.txt; echo "::warning::apt mirrors now: $(tr '\n' ' ' < /tmp/mirrors.txt)"
  # the security pocket is listed by its own host: send it through the mirror list as well
  sudo sed -i -E 's#https?://(azure\.archive|archive|security)\.ubuntu\.com/ubuntu/?#mirror+file:/etc/apt/apt-mirrors.txt#g' /etc/apt/sources.list.d/*.sources /etc/apt/sources.list 2>/dev/null || true
}
getent hosts azure.archive.ubuntu.com > /dev/null 2>&1 || { echo "::warning::azure.archive.ubuntu.com does not resolve"; plain; }
for i in 1 2 3; do
  timeout 120 $APT update > /tmp/apt-update.log 2>&1 || note /tmp/apt-update.log warning
  if timeout 300 $APT install -y --no-install-recommends "$@" > /tmp/apt-install.log 2>&1; then exit 0; fi
  echo "try $i ended with $?" >> /tmp/apt-install.log; note /tmp/apt-install.log warning
  plain
  sleep 10
done
note /tmp/apt-install.log error; exit 1
