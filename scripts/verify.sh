#!/bin/sh
# Refuse to call a deploy successful unless the new code is actually serving.
#
# SSM runs the command list as one shell script. Without `set -e` a failure in
# the middle does not stop it, and the exit code is the last command's — which
# was `df -h /`, always zero. Every deploy reported Success while the server
# stayed on the commit before. This checks the thing that matters instead of
# the thing that is easy to check.
set -e

cd "$(dirname "$0")/.."
WANT=$(git rev-parse HEAD)

echo "Waiting for the backend…"
i=0
while [ $i -lt 40 ]; do
  if curl -fsS http://localhost:8000/health >/dev/null 2>&1; then break; fi
  i=$((i + 1)); sleep 3
done
curl -fsS http://localhost:8000/health >/dev/null

# The container is built from the checkout, so what it reports is what shipped.
GOT=$(docker compose exec -T backend sh -c 'cat /app/COMMIT 2>/dev/null' || true)
if [ -n "$GOT" ] && [ "$GOT" != "$WANT" ]; then
  echo "Backend is serving $GOT, expected $WANT — the containers did not pick up the new build."
  exit 1
fi

echo "Serving $WANT."
