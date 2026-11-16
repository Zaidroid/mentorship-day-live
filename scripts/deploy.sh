#!/bin/bash
# Deploys the checked out commit to the Netlify project, then checks that the site answers as version 2.
#   scripts/deploy.sh            deploy to production (https://mentorship-day-live.netlify.app)
#   scripts/deploy.sh rollback   put the version 1 deploy of 12 November back
# Only Zaid runs this, or Claude after his go in that session (docs/PLAN.md section 1.3).
set -euo pipefail
cd "$(dirname "$0")/.."
SITE=735074f3-356c-4013-be49-6b660c8f482a
URL=https://mentorship-day-live.netlify.app
V1_DEPLOY=6af5d9a1070e88ae668bcb5c
if [ "${1:-}" = "rollback" ]; then
  npx netlify-cli api restoreSiteDeploy --data "{\"site_id\":\"$SITE\",\"deploy_id\":\"$V1_DEPLOY\"}" > /dev/null
  echo "Version 1 is back at $URL"; exit 0
fi
if [ -n "$(git status --porcelain -- public netlify netlify.toml package.json)" ]; then echo "There are changes that are not committed in public or netlify. Commit first."; exit 1; fi
SHA=$(git rev-parse --short HEAD)
echo "Deploying $SHA to $URL"
npx netlify-cli deploy --prod --site "$SITE" --dir public --functions netlify/functions --message "Version 2 ($SHA)"
echo
echo "Checks"
code() { curl -s -m 20 -o /dev/null -w '%{http_code}' "$1"; }
for p in / /screen/ /screen/fit.html /remote/ /assets/day.js /api/state; do echo "  $p  $(code "$URL$p")"; done
curl -s -m 20 "$URL/api/state" | head -c 200; echo
echo "Remote without a PIN (must be 401 or 403): $(code "$URL/api/op")"
