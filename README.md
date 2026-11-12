# Mentorship Day Live

Live system for Mentorship Day 2026 at the Palestine Innovation Summit, Gaza Sky Geeks with Palestine TechnoPark.

| Page | Path | Who uses it |
| --- | --- | --- |
| Phone page (QR code target) | `/` | Attendees: live poll, photo wall uploads, Networking Board, agenda |
| Big screen | `/screen/` | The 5 m by 2.5 m wall in the Main Hall |
| Operator remote | `/remote/` | The GSG team, behind the team PIN |

## How it works
- Static pages in `public/`, Netlify Functions in `netlify/functions/`, storage in Netlify Blobs (store `md26`).
- Sessions, seats, one to one slots and check ins come from the Screen Feed Google Sheet through `/api/sheet/:tab`.
- Poll answers show on screen right away (with a word filter). Photos and Networking Board profiles wait for approval in the remote.
- The remote PIN is the `REMOTE_PIN` environment variable on the Netlify site.
- Videos for the opening go in `public/videos/` as `tareq-azza.mp4` and `kassimlegal.mp4`.

## Screen keys (fallback if the remote is not available)
F full screen, H help, 0 automatic, 1 to 7 modes, N next scene, K screen check, B black, L logos, V stop video.

## Local test
`npm install`, then `node dev/server.mjs 8899` and open http://localhost:8899. `dev/seed.sh` fills local test data. Never run the seed against the live site.
