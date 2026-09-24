#!/bin/sh
# Make room before the build, not after it.
#
# The prunes ran after `docker compose up --build`, which is the wrong order
# when the build is the thing running out of room: it fails, the cleanup it
# needed never happens, and the next deploy starts from the same full disk.
#
# Escalates only as far as it has to, so an ordinary deploy keeps its layer
# cache and does not pay for a pip install and an npm install it could reuse.
set -e

need=${1:-4}

# POSIX df. `-BG --output=avail` is GNU-only, and inside a pipeline its failure
# is hidden by the exit status of the last command — the fallback never runs,
# the function returns nothing, and `[ "" -ge 4 ]` takes the deploy down with
# it. -P is portable and the block size is fixed at 1K.
free_gb() {
  df -Pk / | awk 'NR==2 {printf "%d", $4/1024/1024}'
}

enough() {
  space=$(free_gb)
  case "$space" in ''|*[!0-9]*) return 1 ;; esac
  [ "$space" -ge "$need" ]
}

echo "Free: $(free_gb)G, want ${need}G"
enough && exit 0

echo "Clearing stopped containers and dangling images…"
docker container prune -f >/dev/null 2>&1 || true
docker image prune -f >/dev/null 2>&1 || true
enough && { echo "Free: $(free_gb)G"; exit 0; }

echo "Clearing the build cache…"
docker builder prune -af >/dev/null 2>&1 || true
enough && { echo "Free: $(free_gb)G"; exit 0; }

echo "Clearing images no running container is using…"
docker image prune -af >/dev/null 2>&1 || true
enough && { echo "Free: $(free_gb)G"; exit 0; }

echo "Only $(free_gb)G free after clearing everything reclaimable; the build needs about ${need}G."
exit 1
