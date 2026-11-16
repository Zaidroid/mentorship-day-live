# Mentorship Day Live

The big screen, phone page and team remote for Mentorship Day 2026 at the Palestine Innovation Summit, by Gaza Sky Geeks, a program of Mercy Corps, with Palestine TechnoPark and the support of Sweden.

Version 2 is on branch `v2` and is not deployed at the time of writing. Version 1 was deployed to Netlify on 12 November 2026.

| Page | Path | Who uses it |
| --- | --- | --- |
| Phone page | `/` | Attendees, from the QR code: sign in with their name and the last 4 digits of their mobile number, then My Day (sessions, picks, one to ones), Live (poll and reactions), People (Networking Board, meet codes, connections), Photos. After the event: Keepsake |
| Big screen | `/screen/` | The wall in the Main Hall |
| Team remote | `/remote/` | The GSG team, with the team PIN: Status, People (import and Unlock), Screen, Approve, Polls, Export, Log |

## Quick start

```
npm ci
npx playwright install chromium   # once, for the browser tests
npm run dev        # http://localhost:8897, PIN 123456, local data in dev/blobs
npm run seed       # sample people and data for the local server
npm test           # end to end test against npm run dev
npm run test:api   # API test, starts its own server
npm run sim -- --from 09:25 --speed 30   # a simulated day, watch /screen/?quiet
```

More scripts: `test:phone`, `test:remote`, `probe`, `wall-check`, `baseline`, `load`. They work against the local server; see Testing in `CLAUDE.md`.

Deploy to Netlify with `npx netlify-cli deploy --prod` after linking the project, or self host with `docker compose up -d --build` or `REMOTE_PIN=<pin> npm start`. Details, data sources, storage keys and open items are in `CLAUDE.md`. The API is `docs/API.md`. What the screen does is in `docs/SPEC.md`. The day of runbook is `docs/OPERATIONS.md`, and the floor team's page is `docs/TEAM-CARD.md`.
