#!/bin/sh
# Apply every migration, in order.
#
# Tables come from SQLAlchemy's create_all when the backend starts, so a new
# table appears by itself. A new *column* on an existing table does not:
# create_all never alters what is already there. Those live in migrations/,
# which Postgres only runs out of /docker-entrypoint-initdb.d when it first
# creates the data directory — that is, never again after the first deploy.
#
# So they are applied here, on every deploy, which is safe because each one is
# written to be repeatable. Ordering matters: this runs after the stack is up,
# so create_all has made the tables the ALTERs expect.
set -e

cd "$(dirname "$0")/.."

echo "Waiting for the backend to have created its tables…"
i=0
while [ $i -lt 40 ]; do
  if curl -fsS http://localhost:8000/health >/dev/null 2>&1; then break; fi
  i=$((i + 1)); sleep 3
done

# The files are read from the checkout and fed in on stdin. Globbing the
# container's mount point instead expands on the host, where that path does
# not exist — the loop then runs once with the pattern itself as a filename.
for f in migrations/*.sql; do
  echo "── $(basename "$f")"
  docker compose exec -T postgres psql -v ON_ERROR_STOP=1 -U jlpt -d jlpt -q < "$f"
done
echo "Migrations applied."
