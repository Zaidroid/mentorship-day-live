# Mentorship Day Live

Live system for Mentorship Day 2026: the big screen in the Main Hall, the phone page attendees open from the QR code, and the team remote. Owner: Zaid Salem, Market Access Lead, Gaza Sky Geeks (a program of Mercy Corps). Design and printables contact: Zara, GSG comms team.

The event: Tuesday 17 November 2026, 09:30 to 15:00, Palestine TechnoPark, Birzeit, inside the Palestine Innovation Summit. About 100 working professionals, local and international advisors, sessions in Rooms A, B and C, one to ones in small rooms, lunch and networking at the end.

## Rules for everything you write here

* Never use em dashes or en dashes, in code comments, UI text, docs, commits or messages. Avoid hyphens in visible text too (write "one to one", "WiFi", "self hosted").
* No emojis. American English. Short, plain, specific wording.
* Titles, session topics and place names in Title Case: "One to Ones", "Main Hall", "Small Room 1", "Sales Tactics for Startups and Scaleups". Descriptions under them stay in sentence case.
* Only correct facts. Never invent names, titles, times or numbers. When something is missing, ask Zaid and leave it out until he answers.
* External text mentions Mercy Corps with Gaza Sky Geeks. Internal team text needs no introduction to GSG.
* Asem does not want his photo published. Never add one.
* Design follows the Palestine Innovation Summit look Zara finalized:
  * light gray gradient `#E3E3E3` to `#F6F6F6`, white network lines with soft glow nodes
  * titles orange `#DF6236`, Source Sans 3 weight 700; rules and accents blue `#2F9CC3`; text navy `#1F2E33`
  * leaf shaped pills: small radius top left, large radius top right and bottom left, square bottom right
  * blue honeycomb flowers on a triple blue band, orange leaf zigzag border at the bottom
  * logo order: Mercy Corps, Gaza Sky Geeks, Sweden Sverige (Sida), Palestine TechnoPark, Palestine Innovation Summit

## What is in the repo

| Path | What it is |
| --- | --- |
| `public/index.html` | Phone page (QR target): Today, Poll, Photo, Meet (Networking Board) |
| `public/screen/index.html` | Big screen app. Self contained HTML, CSS and JS |
| `public/remote/index.html` | Team remote, PIN protected |
| `public/assets/` | Logos, advisor photos, Source Sans 3 fonts, QR library |
| `public/videos/` | Opening videos go here (not in the repo yet) |
| `netlify/functions/*.mjs` | API: `state`, `sheet`, `answer`, `photo`, `profile`, `op` |
| `netlify/lib/store.mjs` | Shared storage helpers, default polls, networking tags, word filter |
| `server/index.mjs` | Self hosted server that runs the same functions on a local Blobs store |
| `scripts/` | Local seed data, end to end test, screenshot tool |
| `docs/SPEC.md` | What the screen does and why (decisions from the interview with Zaid) |
| `docs/OPERATIONS.md` | Day of runbook for the team |

## API

| Route | Use |
| --- | --- |
| `GET /api/state` | Public live state: screen controls, active poll with tally, approved photos and profiles. CDN cached 2 s on Netlify |
| `GET /api/sheet/:tab` | Proxy for the Screen Feed sheet tabs `sessions`, `slots`, `stats`. Cached 15 s |
| `POST /api/answer` | Poll answer `{pid, dev, text}`. One answer per phone per poll, a new one replaces it |
| `POST /api/photo` | Photo upload, raw JPEG body, headers `x-dev`, `x-name`, `x-caption`. Waits for approval |
| `GET /api/photo/:id` | Approved photos are public; pending ones need the `x-pin` header |
| `GET/POST /api/profile` | Networking Board profile per phone. New or edited profiles wait for approval |
| `GET/POST /api/op` | Remote. Needs `x-pin` (env `REMOTE_PIN`) and `x-who`. Every action is logged |

Storage is one Netlify Blobs store `md26` with strong consistency. Keys: `cfg`, `polls`, `snap` (approved photos and profiles), `ans/<poll>/<device>/<word>` (one key per answer so phones never overwrite each other), `ph/<id>` with `q/ph/` and `ok/ph/` markers, `pr/<device>` with `q/pr/` and `ok/pr/`, `byd/<device>/<id>` (photo limit per phone), `log/<time>~<who>~<what>`.

## Data sources

* Source of truth for the schedule: tracker sheet "Mentorship Day 17 Nov, Team Tracker", id `1h_AzXmNXmaP33rXwnxoloiejqcwvom83E8YsdOXlYnc`, tabs Advisors, Sessions, One to ones, Participants, Program.
* Screen Feed sheet, id `1xOXRmAqi5NqVaLL-IkoEKC7H9eguoc5-idOxpNcbiAY`, readable by anyone with the link. It imports from the tracker: Sessions, Slots, and Stats (Checked in, Announcement, Scene, Theme, Speaker, WiFi name, WiFi password). The screen reads it every 30 s through `/api/sheet`.
* The schedule is also built into `public/screen/index.html` (`ADVISORS`, `SESSIONS`, `SLOTS`, `PROGRAM`, `SPEAKERS`) and `public/index.html` (`SESSIONS`, `ONES`, `PROGRAM`) so both work offline. When a session, title or time changes, update the tracker and both files.

## Deploy

* Netlify project `mentorship-day-live`, site id `735074f3-356c-4013-be49-6b660c8f482a`, on Zaid's Netlify account (GitHub login Zaidroid). URL https://mentorship-day-live.netlify.app. Not deployed yet as of 12 November 2026.
* `REMOTE_PIN` is already set on the Netlify project. Ask Zaid for the value; never commit it.
* There is no build step: publish directory `public`, functions in `netlify/functions` bundled with esbuild (`netlify.toml`).
* CLI deploy: `npm ci`, `npx netlify-cli login`, `npx netlify-cli link --id 735074f3-356c-4013-be49-6b660c8f482a`, `npx netlify-cli deploy --prod`. Or link this GitHub repo to the project in the Netlify UI so every push to `main` deploys.
* Self hosted: `cp .env.example .env`, set `REMOTE_PIN`, then `docker compose up -d --build` (or `npm ci && npm start`). Data persists in `./data`. Phones on mobile data need a public HTTPS address in front of it (a reverse proxy or a tunnel). The screen builds its QR code from its own address, and falls back to the Netlify URL when opened on localhost (`CONFIG.join` in the screen).
* A laptop running `npm start` at the venue is also the fallback if the hall internet fails: the screen keeps working from local data, though phones only reach it on the same network.

## Testing

* `npm run dev` starts the server on port 8897 with PIN `123456` and data in `dev/blobs`.
* `npm run seed` fills that local server with sample answers, profiles and photos. It refuses any address that is not localhost. Never seed the live site.
* `npm test` runs the end to end test (Playwright: `npm i -D playwright && npx playwright install chromium` first): phone answer, photo upload, profile, remote approval, announcement, scene hold, screen render.
* `node scripts/shoot.cjs 3840x1920 "/screen/?t=11:20&quiet&scene=meet" out.png` takes a screenshot. Check 3840x1920 (the wall, 2:1), 1920x1080 and 3840x1080.
* Screen URL options: `t=HH:MM[:SS]` fake time, `scene=<id>` hold a scene, `mode=<mode>`, `demo`, `quiet` (no hint toast), `offline`, `theme=dark`.
* Scene ids: `rooms`, `choose`, `board`, `meet`, `photos`, `poll`, `pulse`, `way`, `spotlight`, `advisors`, `welcome`, `speaker`, `video`, `recap`, `thanks`, `survey`.

## Open items (12 November 2026)

* Deploy to Netlify, then test from a real phone, the remote, and the screen together.
* Opening videos: add `public/videos/tareq-azza.mp4` and `public/videos/kassimlegal.mp4` once Zaid sends them.
* This Way directions: set in the remote once directions from the Main Hall to the rooms are known. The scene stays hidden until then.
* Speaker card titles for Rand Safi and Alaa Alaaedein, and Alan's title. Zaid's card reads "Market Access Lead, Gaza Sky Geeks".
* Screen signal and resolution from Rose at TechnoPark. The layout adapts; confirm with the screen check on site.
* Poll questions and networking tags are drafts for Zaid to approve: `DEFAULT_POLLS` and `TAGS` in `netlify/lib/store.mjs`.
* Later: grow the phone page into the full participant app (booking sessions and one to ones, follow ups), same design.
