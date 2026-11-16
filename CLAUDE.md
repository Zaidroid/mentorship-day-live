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

## Version

* Version 1 (`main`, commit `c423a9a`) was deployed to Netlify on 12 November 2026 with Zaid's go.
* Version 2 is built on branch `v2`. It is not deployed at the time of writing (16 November 2026). Until it is, the live address serves version 1.
* `docs/PLAN.md` is the version 2 plan and holds Zaid's decisions. `docs/API.md` is the API as built; where the two differ, `docs/API.md` is right.

## What is in the repo

| Path | What it is |
| --- | --- |
| `public/index.html` | Phone page (QR target): sign in, then the tabs My Day, Live, People, Photos. After the event: Keepsake, People, Photos |
| `public/screen/index.html` | The wall. Self contained HTML, CSS and JS |
| `public/remote/index.html` | Team remote, PIN protected: Status, People, Screen, Approve, Polls, Export, Log |
| `public/assets/day.js` | The schedule, written once: date, rooms, blocks, advisors, sessions, one to ones, program, speakers, videos, poll plan, reaction windows, topic map. The wall and the phone load it with a script tag; the server imports it through `netlify/lib/day.mjs` |
| `public/assets/` | Also logos, advisor photos, Source Sans 3 and Noto Sans Arabic fonts, the QR library |
| `public/manifest.json`, `public/icons/` | Web manifest and icons for the phone page |
| `public/videos/` | Videos the wall plays. The mp4 files are kept out of git (too large for GitHub) and go up with `scripts/deploy.sh` from this machine. `gsg.mp4` is the Gaza Sky Geeks film Zaid sent on 16 November, encoded for streaming; the original is in `dev/video-in/` |
| `netlify/functions/*.mjs` | The API, one route per file (table below) |
| `netlify/lib/store.mjs` | Storage helpers, default config, feature switches (`FLAGS`), public config fields (`PUBLIC_CFG`), polls, networking tags, word filter, CDN headers, Repair and Wipe |
| `netlify/lib/` (others) | `day.mjs` clock, phase and rehearsal; `ids.mjs` public ids; `people.mjs` people list, picks, stars and the `me` answer; `signin.mjs`; `rules.mjs` what runs by the clock; `board.mjs` cards, meet codes, connections; `tk.mjs` takeaways; `rx.mjs` reactions; `alert.mjs` Telegram alerts |
| `server/index.mjs` | Self hosted server that runs the same functions on a local Blobs store |
| `scripts/` | Seed data, tests, wall probes, crowd simulator, screenshot tools (see Testing) |
| `docs/PLAN.md` | Version 2 build plan, decisions, open items |
| `docs/API.md` | The API contract as built |
| `docs/SPEC.md` | What the screen does: version 1 decisions and a version 2 summary |
| `docs/OPERATIONS.md` | Day of runbook for the team |
| `docs/TEAM-CARD.md` | One page for the floor team |
| `Dockerfile`, `docker-compose.yml` | Self hosting |

## API

The full contract, with bodies, answers and refusals, is `docs/API.md`. Phone routes take the device id in `x-dev`; it never appears in any answer. Errors are `{error: "plain sentence"}`.

| Route | Use |
| --- | --- |
| `GET /api/state` | Public live state: clock `t`, `phase`, public config and flags, poll with tally, reactions, counts `n`, `interest` per session, hellos, `snapV`. CDN 2 s, 1 s while reactions are on |
| `GET /api/snap?v=` | Approved photos, cards, connections and takeaways. Clients fetch it only when `snapV` changes |
| `GET /api/sheet/:tab` | Proxy for the Screen Feed sheet tabs `sessions`, `slots`, `stats`. CDN 15 s |
| `GET /api/photo/:id` | Approved photos are public; pending ones need `x-pin` |
| `GET /api/ics?s=` | Calendar file with those sessions, or the day |
| `GET /api/rx` | Reactions only, for the wall if the call budget needs it |
| `GET /api/cdn-probe` | Cache experiments only |
| `GET /api/who?q=` | Name search for sign in: 3 letters minimum, 5 names at most |
| `POST /api/claim` | Sign in as a person with the last 4 digits. Locks after 5 wrong tries on one phone or 10 in total |
| `POST /api/guest` | Continue as a guest |
| `POST /api/signout` | Sign out this phone |
| `GET /api/me` | This phone's person, stars, card, meet code, connections, takeaways, feedback |
| `POST /api/star` | My session in a block |
| `POST /api/answer` | Poll answer. One per phone per poll, only for the poll open now |
| `POST /api/react` | A batch of reactions, while reactions are on |
| `GET/POST /api/profile` | Networking Board card |
| `POST /api/meet` | Record a connection with a 3 digit meet code |
| `POST /api/takeaway` | Rating and one line for a session, in its window |
| `POST /api/feedback` | Feedback after the event |
| `POST /api/forget` | Remove my card, connections, stars, takeaway text and name |
| `POST /api/photo` | Photo upload. With a valid `x-pin` it is a team upload, approved at once |
| `POST /api/beat` | Wall heartbeat, every 60 seconds |
| `GET/POST /api/op` | Remote. Needs `x-pin` (env `REMOTE_PIN`) and `x-who`. Every action is logged |
| `GET /api/export/:what` | CSV with names, needs `x-pin`: `takeaways`, `ratings`, `polls`, `board`, `links`, `feedback`, `signins` |

Storage is one Netlify Blobs store `md26` with strong consistency. Shared JSON blobs change only through `update()` in `store.mjs`. Counts come from listing key names. Keys:

| Key | Holds |
| --- | --- |
| `cfg`, `polls`, `snap`, `people`, `beat` | Config, polls, the public snapshot, the private people list, the last wall heartbeat |
| `who/<dev>` | Who a phone is signed in as |
| `sig/<pub>` | Signed in at least once |
| `dv/<pub>/<dev>` | Phones per person, 3 at most |
| `here/<pub>` | First seen on the event day (`n.here`) |
| `hi/<time>~<pub>~<first name>` | Hello for the wall, only with consent |
| `fail/<pid>/<dev>~<time>` | Wrong last 4 digits |
| `star/<block>/<pub>/<sid>~<by>` | One session per block; `by` is `own`, `auto` or `team` |
| `ans/<poll>/<dev>/<word>` | One key per answer, so phones never overwrite each other |
| `ph/<id>`, `q/ph/<id>`, `ok/ph/<id>`, `byd/<dev>/<id>` | Photo with its metadata, waiting and approved markers, 12 photos per phone |
| `pr/<pub>`, `q/pr/<pub>`, `ok/pr/<pub>` | Card, waiting and approved markers |
| `code/<nnn>` | Meet code, value is the `pub` |
| `cx/<a>~<b>~<time>` | A connection |
| `tk/<sid>/<pub>`, `q/tk/<sid>~<pub>`, `ok/tk/<sid>~<pub>` | Takeaway, waiting and approved markers |
| `fb/<pub>` | Feedback after the event |
| `rx/<minute>/<window>/<dev>~<clap>~<heart>~<bloom>~<rand>`, `rx/s<minute>~...`, `rx/l<minute>~...`, `rxd/<dev>` | Reaction batches, minute sums, late marks, batches per phone |
| `lim/<name>/<bucket>/<id>/...` | Rate limits for name search and meet codes |
| `alert/<kind>/<bucket>`, `pinfail/<bucket>/<rand>` | Alert spacing, wrong PIN counter |
| `log/<time>~<who>~<what>` | Remote action log |

`dev` is the device id, `pub` the public id (`p` plus 10 hex for a person, `g` plus 10 hex for a guest), `pid` the person id. Ids are keyed with a secret made from `REMOTE_PIN`: if the PIN changes after the people import, import again. Wipe Test Data deletes everything above except `cfg` (reset to defaults, This Way directions kept), `polls` and `people`.

## Data sources

* Source of truth for the schedule: tracker sheet "Mentorship Day 17 Nov, Team Tracker", id `1h_AzXmNXmaP33rXwnxoloiejqcwvom83E8YsdOXlYnc`, tabs Advisors, Sessions, One to ones, Participants, Program.
* In the repo the schedule lives once, in `public/assets/day.js`. When a session, title or time changes, update the tracker and that file.
* Screen Feed sheet, id `1xOXRmAqi5NqVaLL-IkoEKC7H9eguoc5-idOxpNcbiAY`, readable by anyone with the link. It imports from the tracker: Sessions, Slots, and Stats. The wall reads it every 60 s through `/api/sheet`. Sessions and Slots replace the built in ones. From Stats the wall uses Checked in, Announcement, Scene, Theme, WiFi name and WiFi password. Scene holds a mode unless the remote holds one, and Theme wins over the remote's theme.
* People: the registration response sheet. The remote reads its CSV in the browser and sends only name, company, job title, LinkedIn, topics, advisor preference, photo consent, rooms, slot and the last 4 digits. Never copy rows from it into the repo, a test, a log, a commit or a screenshot.

## Deploy

* Netlify project `mentorship-day-live`, site id `735074f3-356c-4013-be49-6b660c8f482a`, on Zaid's Netlify account (GitHub login Zaidroid). URL https://mentorship-day-live.netlify.app. Deploy only with Zaid's go.
* `REMOTE_PIN` is already set on the Netlify project. Ask Zaid for the value; never commit it. Optional alerts: `ALERT_TELEGRAM_BOT` and `ALERT_TELEGRAM_CHAT` (both, or nothing is sent).
* There is no build step: publish directory `public`, functions in `netlify/functions` bundled with esbuild (`netlify.toml`).
* CLI deploy: `npm ci`, `npx netlify-cli login`, `npx netlify-cli link --id 735074f3-356c-4013-be49-6b660c8f482a`, `npx netlify-cli deploy --prod`. `npm run deploy` runs `netlify deploy --prod` and needs the Netlify CLI on the path.
* The Netlify store is shared by every deploy of the site, so tests on the live address write live data. Run them before real data exists, then Wipe Test Data.
* Function calls: the account is on the Free plan, 125,000 calls a month. Whether the shared CDN cache works for `/api/state` is not verified; `CDN_POLICY` in `store.mjs`, `/api/cdn-probe` and `scripts/cdn-check.sh` test it on the first version 2 deploy. See `docs/PLAN.md` sections 5.12 and 5.14.
* Self hosted: `cp .env.example .env`, set `REMOTE_PIN`, then `docker compose up -d --build`. Or `npm ci`, then `REMOTE_PIN=<pin> npm start` (macOS or Linux; the script uses shell syntax). Both set `LOCAL_CDN=1`, so the server keeps answers that carry a CDN time for that time, as Netlify would. Port 8080, data in `./data`. Phones on mobile data need a public HTTPS address in front of it. The wall builds its QR code from its own address, and falls back to the Netlify URL when opened on localhost (`CONFIG.join` in the wall).
* A laptop running `npm start` at the venue is the fallback if the hall internet or Netlify fails. It starts with empty data, and phones only reach it on the same network. Steps in `docs/OPERATIONS.md`.

## Testing

* `npm run dev` starts the server on port 8897 with PIN `123456` and data in `dev/blobs`. Port 8899 is taken on this machine by another service.
* `npm run seed` fills that server with six sample people (four signed in), answers, cards, photos, stars, two connections and three takeaways. It refuses any address that is not localhost. Never seed the live site.
* Playwright is a dev dependency. Install Chromium once: `npx playwright install chromium`.
* `npm test`: end to end against `npm run dev`: phone answer, photo upload, card, remote approval, scene hold, announcement, wall render.
* `npm run test:api`: the API test (`node:test`). It starts its own server on a free port with a temporary data folder and needs nothing running.
* `npm run test:phone`: deeper checks of the phone page after `npm run seed`. `ENGINE=webkit` for WebKit, `ONLY=signin,myday` for parts.
* `npm run test:remote`: the remote at 420 px wide, from import to wipe. It wipes the data of the server it runs against, so localhost only.
* `npm run probe`: wall checks at three sizes in both themes (errors, overflow, clipped text, text size, background running). About 20 minutes; `-- --quick` or `-- --only <view>` for less. Known version 1 faults go in `scripts/probe-known.json`, never new ones.
* `npm run wall-check`: measured wall behavior through `window.__md`. `npm run baseline`: reference screenshots to `dev/shots/baseline/`.
* `npm run sim -- --from 09:25 --speed 30`: a simulated day with made up people through the real routes, with the wall open at `/screen/?quiet`. `npm run load`: 120 clients polling, prints p50, p95 and errors per route. Both refuse remote addresses unless `--allow-remote`.
* `node scripts/shoot.cjs 3840x1920 "/screen/?t=11:20&quiet&scene=meet" out.png` takes a screenshot. Check 3840x1920 (the wall, 2:1), 1920x1080 and 3840x1080. `node scripts/text-snap.cjs` proves a change kept all visible text the same.
* This machine is busy: open one wall sized page at a time.
* Wall URL options: `t=HH:MM[:SS]` fake time, `speed=N`, `scene=<id>` hold a scene, `mode=<mode>`, `theme=light|dark` (wins over the remote until T is pressed), `lite=1` or `lite=0`, `v=a|b` Welcome look, `demo`, `quiet` (no hint toast), `offline` (no Screen Feed sheet).
* Scene ids: `rooms`, `choose`, `board`, `meet`, `photos`, `poll`, `pulse`, `way`, `spotlight`, `advisors`, `welcome`, `speaker`, `video`, `recap`, `thanks`, `survey`.
* Phone URL options: `t=HH:MM[:SS]` fake time, `v=a|b` sign in and My Day looks, `m=<code>` opens People with a meet code.
* A rehearsal moves every clock: Status tab, Tools in the remote, or `op rehearsal {hhmm}` (see `docs/API.md`).

## Open items (16 November 2026)

* Deploy version 2 with Zaid's go, then the live checks in `docs/PLAN.md` section 8.4 (CDN cache, a 2 minute load test, a real phone, the remote), then tag `v2-freeze`. There is no tag yet.
* Hosting and the function call budget: a paid Netlify plan for November, or the self hosted server as the main site (`docs/PLAN.md` section 10, item 0).
* Not built on the wall at the time of writing: the Networking Board constellation, Voices of the Day, the Lunch Finale loop, the poll word fly in and the poll result moment, the Photo Wall "New" tag and crossfade, and the growing garden. The remote's Lunch finale controls are hidden. Reactions and the group photo countdown are on the wall since 16 November. `public/screen/fit.html?shape=2` is the wall for a display that stretches a 16 to 9 picture. `scripts/deploy.sh` deploys and rolls back.
* `scripts/e2e.cjs` is still the version 1 story. Plan WP7 task 1 (one story from import to export) is not done.
* Videos: the Gaza Sky Geeks film is in (`gsg`, 2 minutes 19 seconds). Its title on the wall and the remote is "Gaza Sky Geeks" until Zaid gives the real one. Still open: whether the Tareq Azza and KassimLegal messages are coming (`public/videos/tareq-azza.mp4`, `public/videos/kassimlegal.mp4`), or should leave the list in `public/assets/day.js`. To add a video: `ffmpeg -i in.mp4 -c:v libx264 -preset slow -crf 21 -maxrate 6M -bufsize 12M -pix_fmt yuv420p -movflags +faststart -c:a aac -b:a 160k public/videos/<name>.mp4`, add it to `videos` in `day.js`, deploy. The wall fetches each video whole about 20 seconds after it loads, so it plays from memory.
* The live deploy is locked on Netlify, because the project builds GitHub `main` by itself and `main` is still version 1. `scripts/deploy.sh` publishes and locks its own deploy; `scripts/deploy.sh unlock` lets pushes to `main` go live again. Version 2 is not on GitHub yet: the repo is public, so pushing it is Zaid's call.
* This Way directions (16 November, from Zaid): Room A on the right, Room B on the left, Room C upstairs on the 3rd Floor. These are the defaults on the wall, each room with its own arrow. Registration and One to Ones directions are still unknown and stay hidden until set in the remote. Confirm on site that right and left hold from where the wall stands.
* Speaker card titles for Rand Safi and Alaa Alaaedein, and Alan's title.
* Screen signal and resolution from Rose at TechnoPark. Confirm with the screen check on site.
* Drafts for Zaid to approve: the topic to session table (`topicMap` in `day.js`), the networking tags and the suggestions from registration topics (`TAGS` and `TOPIC_TAGS` in `store.mjs`). The poll questions and times are approved.
* Wording check against the Mercy Corps safeguarding policy for three consents: hello on the wall, connections on the wall, takeaways with a first name.
* Team PIN: at least 8 characters with letters. Do not change it after the import.
* Alerts: a team Telegram chat needs a bot and the chat.
* Feedback: the built in three questions, or an official survey link.
* How long the site stays up after the event, and who exports and wipes. No button removes the people list; Wipe Test Data keeps it.
* The tracker lists Brandon as to confirm for Small Room 2, and Rajai's time as to confirm.
* Not in version 2: an Arabic interface, booking seats or one to one slots from the phone, screens in the session rooms (`docs/PLAN.md` section 11).
