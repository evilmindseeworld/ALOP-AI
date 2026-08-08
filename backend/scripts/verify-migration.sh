#!/usr/bin/env bash
# Did moving to Mumbai actually do anything? Measure, do not assume.
#
# Run BEFORE cutting over DNS and BEFORE shutting Render down, so both hosts are
# alive and the comparison is like-for-like on the same network at the same
# moment. Numbers taken hours apart on a laptop that moved between wifi and
# tethering prove nothing.
#
#   ./scripts/verify-migration.sh
#
# What it does NOT measure: the backend-to-Supabase leg. That one cannot be seen
# from here — it is a hop between two machines you are not sitting on — and the
# honest way to read it is the DIFFERENCE in a database-touching endpoint's TTFB
# versus /health, which does no database work. That difference is the DB leg,
# and it is where most of the win is supposed to be.

set -u

OLD="${OLD_HOST:-https://alop-ai.onrender.com}"
NEW="${NEW_HOST:-https://alop-ai-backend.fly.dev}"
SAMPLES="${SAMPLES:-10}"

probe() { # host path -> prints best and median TTFB in ms
  local host="$1" path="$2" times=()
  for _ in $(seq 1 "$SAMPLES"); do
    local t
    t=$(curl -s -o /dev/null -w '%{time_starttransfer}' --max-time 30 "$host$path" 2>/dev/null)
    # A failed request prints 0; drop it rather than letting it win "best".
    [ -n "$t" ] && [ "$t" != "0.000000" ] && times+=("$t")
  done
  if [ "${#times[@]}" -eq 0 ]; then echo "unreachable"; return; fi
  local sorted best median
  sorted=$(printf '%s\n' "${times[@]}" | sort -n)
  best=$(echo "$sorted" | head -1)
  median=$(echo "$sorted" | awk '{a[NR]=$1} END{print a[int((NR+1)/2)]}')
  awk -v b="$best" -v m="$median" 'BEGIN{printf "best %6.1fms   median %6.1fms", b*1000, m*1000}'
}

echo "samples per figure: $SAMPLES"
echo
printf '%-38s %s\n' "OLD  $OLD/health" "$(probe "$OLD" /health)"
printf '%-38s %s\n' "NEW  $NEW/health" "$(probe "$NEW" /health)"
echo
echo "Reference RTTs measured from this machine (TCP connect, AWS regional endpoints):"
for r in "Mumbai ec2.ap-south-1.amazonaws.com" "Frankfurt ec2.eu-central-1.amazonaws.com" "Singapore ec2.ap-southeast-1.amazonaws.com"; do
  set -- $r
  t=$(for _ in 1 2 3; do curl -s -o /dev/null -w '%{time_connect}\n' --max-time 15 "https://$2/" 2>/dev/null; done | sort -n | head -1)
  awk -v n="$1" -v t="$t" 'BEGIN{printf "  %-10s %6.1fms\n", n, t*1000}'
done

cat <<'NOTE'

HOW TO READ THIS
  /health does no database work, so its TTFB is user->backend and nothing else.
  Expect the NEW host to land near the Mumbai reference above. If it does not,
  the machine is not in bom — check `fly status` before blaming the network.

  The database leg is the other half and needs a signed-in request. Compare an
  authenticated endpoint's TTFB against /health on the SAME host: the gap is
  roughly the database round-trips. That gap should shrink a lot on the new
  host and is the actual point of the move.

  Do not cut DNS on one fast sample. Run this a few times across a day.
NOTE
