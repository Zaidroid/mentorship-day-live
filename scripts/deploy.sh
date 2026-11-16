#!/bin/bash
# Deploys the checked out commit to the Netlify project, then checks that the site answers as version 2.
#   scripts/deploy.sh            deploy the committed code to both homes: Netlify and the self hosted copy
#   scripts/deploy.sh netlify    Netlify only (https://mentorship-day-live.netlify.app)
#   scripts/deploy.sh self       the self hosted copy on this server only (https://mentorship.zaidlab.xyz)
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
# Both homes get the committed code, never the working tree: a clean export of HEAD, plus the video files,
# which are kept out of git. Work in progress in the tree is not deployed.
SHA=$(git rev-parse --short HEAD)
WHAT=${1:-both}
BUILD="$PWD/dev/build-ctx"
rm -rf "$BUILD"; mkdir -p "$BUILD"
git archive HEAD | tar -x -C "$BUILD"
mkdir -p "$BUILD/public/videos"; cp public/videos/*.mp4 "$BUILD/public/videos/" 2>/dev/null || true
ln -s "$PWD/node_modules" "$BUILD/node_modules"
if [ -n "$(git status --porcelain -- public netlify server)" ]; then echo "Note: changes in the tree that are not committed are NOT in this deploy."; fi
if [ "$WHAT" = "self" ] || [ "$WHAT" = "both" ]; then
  echo "Self hosted copy: building $SHA"
  rm "$BUILD/node_modules"
  docker compose -f /opt/stacks/mentorship-day/docker-compose.yml up -d --build 2>&1 | tail -3
  ln -s "$PWD/node_modules" "$BUILD/node_modules"
  for i in 1 2 3 4 5 6 7 8 9 10; do curl -s -m 3 -o /dev/null http://127.0.0.1:8493/api/state && break; sleep 1; done
  echo "  local /api/state $(curl -s -m 10 -o /dev/null -w '%{http_code}' http://127.0.0.1:8493/api/state), /videos/gsg.mp4 $(curl -sI -m 10 -o /dev/null -w '%{http_code}' http://127.0.0.1:8493/videos/gsg.mp4), public address $(curl -s -m 10 -o /dev/null -w '%{http_code}' https://mentorship.zaidlab.xyz/api/state || true)"
fi
if [ "$WHAT" = "self" ]; then exit 0; fi
cd "$BUILD"
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
