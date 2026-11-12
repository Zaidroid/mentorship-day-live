#!/bin/bash
# Read only check of the Netlify CDN cache for one GET route (docs/PLAN.md section 5.12).
# Makes 10 GET requests on one connection, then 10 GET requests that each open a new connection,
# and counts the cache-status outcome of the Edge layer and the Durable layer for both groups.
#   scripts/cdn-check.sh https://mentorship-day-live.netlify.app
#   scripts/cdn-check.sh https://mentorship-day-live.netlify.app /api/state
#   scripts/cdn-check.sh https://mentorship-day-live.netlify.app "/api/cdn-probe?p=b&s=5"
# Safe on the live site: GET only, no cookies, no PIN, no body, and only routes that never write.
# A request that misses both layers is one function call, so a run costs 20 calls at most.
# HEAD=1 sends HEAD in place of GET, to compare (curl -I sends HEAD, and a cache may treat it differently).
# N=5 changes the number of requests in each group.
set -euo pipefail
BASE=${1:-}
ROUTE=${2:-/api/state}
N=${N:-10}
if [ -z "$BASE" ]; then echo "Give the site address, for example: scripts/cdn-check.sh https://mentorship-day-live.netlify.app /api/state"; exit 1; fi
case "$BASE" in http://*|https://*) ;; *) echo "The address must start with http:// or https://"; exit 1;; esac
case "$ROUTE" in
  /api/state|/api/rx|/api/snap|/api/snap\?*|/api/cdn-probe|/api/cdn-probe\?*|/api/sheet/*|/api/ics|/api/ics\?*) ;;
  /api/*) echo "Refusing $ROUTE: only routes that never write are allowed (state, rx, snap, cdn-probe, sheet, ics)."; exit 1;;
  /*) ;;
  *) echo "The path must start with /"; exit 1;;
esac
case "$N" in ''|*[!0-9]*) echo "N must be a number"; exit 1;; esac
if [ "$N" -lt 1 ] || [ "$N" -gt 30 ]; then echo "N must be between 1 and 30"; exit 1; fi
URL="${BASE%/}$ROUTE"
METHOD=(); [ "${HEAD:-}" = "1" ] && METHOD=(-I)
tmp=$(mktemp -d); trap 'rm -rf "$tmp"' EXIT

# One connection: curl reuses its connection for every URL given in one call.
args=(); for _ in $(seq "$N"); do args+=(-o /dev/null "$URL"); done
curl -s "${METHOD[@]}" -D - --max-time 60 "${args[@]}" > "$tmp/one" || true
# Separate connections: a new curl process for every request.
: > "$tmp/sep"
for _ in $(seq "$N"); do curl -s "${METHOD[@]}" -o /dev/null -D - --max-time 15 "$URL" >> "$tmp/sep" || true; done

# Prints, for one header dump, how many answers had each status, policy, Edge outcome and Durable outcome.
summary() {
  tr -d '\r' < "$1" | awk '
    function flush() {
      if (!seen) return
      if (edge == "") edge = "(none)"; if (dur == "") dur = "(none)"
      e[edge]++; d[dur]++; st[status]++; pol[policy == "" ? "(none)" : policy]++; seen = 0
    }
    function outcome(rest,   n, i, parts, out, p) {
      n = split(rest, parts, ";"); out = ""
      for (i = 1; i <= n; i++) { p = parts[i]; gsub(/^ +| +$/, "", p); if (p == "" || p ~ /^(ttl|stored|key|detail)=/) continue; out = out (out == "" ? "" : "; ") p }
      return out == "" ? "(empty)" : out
    }
    /^HTTP\// { flush(); seen = 1; status = $2; edge = ""; dur = ""; policy = ""; next }
    tolower($0) ~ /^x-md-cache:/ { policy = $2; next }
    tolower($0) ~ /^cache-status:/ {
      line = substr($0, index($0, ":") + 1)
      n = split(line, entries, ",")
      for (i = 1; i <= n; i++) {
        x = entries[i]; gsub(/^ +| +$/, "", x)
        if (x ~ /^"Netlify Edge"/) { sub(/^"Netlify Edge" *;? */, "", x); edge = outcome(x) }
        else if (x ~ /^"Netlify Durable"/) { sub(/^"Netlify Durable" *;? */, "", x); dur = outcome(x) }
      }
      next
    }
    END {
      flush()
      for (k in st) printf "  status %-24s %d\n", k, st[k]
      for (k in pol) printf "  x-md-cache %-20s %d\n", k, pol[k]
      for (k in e) printf "  Edge     %-24s %d\n", k, e[k]
      for (k in d) printf "  Durable  %-24s %d\n", k, d[k]
    }'
}

echo "$([ "${HEAD:-}" = "1" ] && echo HEAD || echo GET) $URL"
echo "$N requests on one connection:"
summary "$tmp/one"
echo "$N requests, each on a new connection:"
summary "$tmp/sep"
