#!/bin/bash
# Deploys the checked out commit to the Netlify project, then checks that the site answers as version 2.
#   scripts/deploy.sh            deploy to production (https://mentorship-day-live.netlify.app)
#   scripts/deploy.sh rollback   put the version 1 deploy of 12 November back
#   scripts/deploy.sh unlock     let pushes to GitHub main go live again (the live deploy is kept locked)
# Only Zaid runs this, or Claude after his go in that session (docs/PLAN.md section 1.3).
set -euo pipefail
cd "$(dirname "$0")/.."
SITE=735074f3-356c-4013-be49-6b660c8f482a
URL=https://mentorship-day-live.netlify.app
V1_DEPLOY=6af5d9a1070e88ae668bcb5c
if [ "${1:-}" = "unlock" ]; then
  PUB=$(npx netlify-cli api getSite --data "{\"site_id\":\"$SITE\"}" 2>/dev/null | python3 -c "import json,sys; print(json.load(sys.stdin)['published_deploy']['id'])")
  npx netlify-cli api unlockDeploy --data "{\"deploy_id\":\"$PUB\"}" > /dev/null
  echo "Unlocked. The next push to GitHub main goes live."; exit 0
fi
if [ "${1:-}" = "rollback" ]; then
  npx netlify-cli api restoreSiteDeploy --data "{\"site_id\":\"$SITE\",\"deploy_id\":\"$V1_DEPLOY\"}" > /dev/null
  echo "Version 1 is back at $URL"; exit 0
fi
if [ -n "$(git status --porcelain -- public netlify netlify.toml package.json)" ]; then echo "There are changes that are not committed in public or netlify. Commit first."; exit 1; fi
SHA=$(git rev-parse --short HEAD)
echo "Deploying $SHA to $URL"
# The live deploy is kept locked (see below). The lock is lifted for the length of this deploy only.
PUB0=$(npx netlify-cli api getSite --data "{\"site_id\":\"$SITE\"}" 2>/dev/null | python3 -c "import json,sys; print(json.load(sys.stdin)['published_deploy']['id'])")
npx netlify-cli api unlockDeploy --data "{\"deploy_id\":\"$PUB0\"}" > /dev/null 2>&1 || true
npx netlify-cli deploy --prod --site "$SITE" --dir public --functions netlify/functions --message "Version 2 ($SHA)"
# The live deploy is locked, so a push to GitHub main (which Netlify builds by itself) cannot replace it.
# A locked site does not publish a new deploy on its own: publish the newest deploy made here, then lock it.
#   scripts/deploy.sh unlock   lets pushes to GitHub main go live again
NEW=$(npx netlify-cli api listSiteDeploys --data "{\"site_id\":\"$SITE\",\"per_page\":8}" 2>/dev/null | python3 -c "import json,sys; d=[x for x in json.load(sys.stdin) if (x.get('title') or '').startswith('Version 2 ($SHA)') and x.get('state')=='ready']; print(d[0]['id'] if d else '')")
PUB=$(npx netlify-cli api getSite --data "{\"site_id\":\"$SITE\"}" 2>/dev/null | python3 -c "import json,sys; print(json.load(sys.stdin)['published_deploy']['id'])")
if [ -n "$NEW" ] && [ "$NEW" != "$PUB" ]; then npx netlify-cli api restoreSiteDeploy --data "{\"site_id\":\"$SITE\",\"deploy_id\":\"$NEW\"}" > /dev/null; echo "Published $NEW (the site was locked on $PUB)"; fi
if [ -n "$NEW" ]; then npx netlify-cli api lockDeploy --data "{\"deploy_id\":\"$NEW\"}" > /dev/null && echo "Locked on $NEW: pushes to GitHub main will not replace it"; fi
echo
echo "Checks"
code() { curl -s -m 20 -o /dev/null -w '%{http_code}' "$1"; }
for p in / /screen/ /screen/fit.html /remote/ /assets/day.js /api/state; do echo "  $p  $(code "$URL$p")"; done
curl -s -m 20 "$URL/api/state" | head -c 200; echo
echo "Remote without a PIN (must be 401 or 403): $(code "$URL/api/op")"
