#!/bin/sh
# Make room before the build, not after it.
#
# The prunes ran after `docker compose up --build`, which is the wrong order
# when the build is the thing running out of room: it fails, the cleanup it
# needed never happens, and the next deploy starts from the same full disk.
# Three deploys in a row reported success this way and none of them shipped.
#
# Escalates only as far as it has to, so an ordinary deploy keeps its layer
# cache and does not pay for a pip install and an npm install it could reuse.
set -e

need=${1:-4}

free_gb() {
  df -BG --output=avail / 2>/dev/null | tail -1 | tr -dc '0-9' \
    || df -g / | tail -1 | awk '{print $4}'
}

enough() { [ "$(free_gb)" -ge "$need" ]; }

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

# Out of things that are safe to delete. Say so rather than letting the build
# fail with a message about a layer.
echo "Only $(free_gb)G free after clearing everything reclaimable; the build needs about ${need}G."
exit 1
