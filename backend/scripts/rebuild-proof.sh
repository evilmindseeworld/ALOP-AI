#!/usr/bin/env bash
#
# DOES `migrations/` BUILD A DATABASE FROM NOTHING?
#
# `check-drift.mjs` asks production what it has. This asks the opposite and
# harder question, and the answer on 2026-08-18 was NO.
#
# Every migration here had been applied to production, where every object it
# touched already existed, so each statement was a no-op that proved the SQL
# parses — not that an empty database ends up matching. Run against a scratch
# Postgres for the first time, 12 of 28 files failed, all cascading from ONE
# root cause: `000_base_schema_lineage.sql` created RLS policies calling
# `current_app_user_id()` (created in 002) and `current_app_is_admin()`
# (created in 012), died at its first policy, and so never created `chats`,
# `audit_logs` or `user_facts` — which eleven later migrations need.
#
# That is the whole argument for this script existing. A no-op is not a test,
# and the only thing that can tell the difference is an empty database.
#
# TWO OBJECTS THIS ENVIRONMENT MUST PROVIDE, because Supabase does and plain
# Postgres does not: the `anon`/`authenticated`/`service_role` roles that
# policies and grants name, and the `vector` and `pgcrypto` extensions. They
# are created below rather than by a migration because they are the platform,
# not the schema — inventing migrations for them would make the rebuilt
# database diverge from the real one.
#
# Requires Docker. Exits non-zero on the first migration that fails, or if the
# rebuilt catalogue is missing anything the code calls.
#
#   bash scripts/rebuild-proof.sh

set -euo pipefail

NAME="${REBUILD_CONTAINER:-alop-rebuild}"
IMAGE="${REBUILD_IMAGE:-pgvector/pgvector:pg16}"
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

cleanup() { docker rm -f "$NAME" >/dev/null 2>&1 || true; }
trap cleanup EXIT
cleanup

echo "==> scratch Postgres ($IMAGE)"
docker run -d --name "$NAME" -e POSTGRES_PASSWORD=proof -e POSTGRES_DB=alop "$IMAGE" >/dev/null

# Poll rather than sleep: the image initialises at whatever speed the machine
# allows, and a fixed sleep is either slow or flaky.
for _ in $(seq 1 60); do
  if docker exec "$NAME" pg_isready -U postgres >/dev/null 2>&1; then break; fi
  sleep 1
done
docker exec "$NAME" pg_isready -U postgres >/dev/null

echo "==> platform baseline (roles + extensions Supabase provides)"
docker exec "$NAME" psql -U postgres -d alop -q -v ON_ERROR_STOP=1 -c "
CREATE EXTENSION IF NOT EXISTS vector;
CREATE EXTENSION IF NOT EXISTS pgcrypto;
CREATE ROLE anon NOLOGIN;
CREATE ROLE authenticated NOLOGIN;
CREATE ROLE service_role NOLOGIN BYPASSRLS;"

echo "==> applying every migration in order"
docker cp "$HERE/migrations" "$NAME:/migrations" >/dev/null
docker exec "$NAME" bash -c '
  failed=0
  for f in $(ls /migrations/*.sql | sort); do
    if out=$(psql -U postgres -d alop -v ON_ERROR_STOP=1 -q -f "$f" 2>&1); then
      echo "  ok   $(basename "$f")"
    else
      echo "  FAIL $(basename "$f")"
      echo "$out" | grep -i "ERROR" | head -3 | sed "s/^/       /"
      failed=1
    fi
  done
  exit $failed'

echo "==> does the rebuilt database hold what the code calls?"
docker exec "$NAME" psql -U postgres -d alop -At -c "
  SELECT tablename FROM pg_tables WHERE schemaname='public'
  UNION SELECT p.proname FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname='public';" > "$HERE/.rebuilt-catalogue"

# A file full of guarded DO blocks would apply cleanly while creating nothing,
# so "0 failures" on its own is not the proof. This is the half that would
# catch that.
node "$HERE/scripts/rebuild-expects.mjs" "$HERE/.rebuilt-catalogue"
rm -f "$HERE/.rebuilt-catalogue"
echo "==> rebuild proven"
