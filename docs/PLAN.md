# Version 2 Build Plan

Written on Thursday 12 November 2026 by Claude (Fable 5.2), after reading the whole repo, running it locally with seed data, reading the tracker, and two rounds of questions with Zaid. This file is the brief for the model that builds version 2. It replaces nothing: `docs/SPEC.md` still describes version 1, and `CLAUDE.md` still holds the writing and design rules.

* Freeze: Sunday 15 November 2026, evening.
* On site test and fixes only: Monday 16 November.
* Event: Tuesday 17 November 2026, 09:30 to 15:00.

## 1. How to Use This Plan

### 1.1 Who Builds What

| Package | What | Model | Why |
| --- | --- | --- | --- |
| WP0 | Baseline, ports, probes, first deploy | Sonnet 5.5 (`claude-sonnet-5-5`) | Mechanical, fully specified |
| WP1 | Server foundation: shared day file, ids, clock, state and snap | Opus 5.5 (`claude-opus-5-5`) | Everything else stands on it, and it touches privacy |
| WP2 | Feature API: identity, stars, reactions, connections, takeaways, exports | Opus 5.5 | Abuse limits, races and consent rules need judgment |
| WP3 | Crowd simulator and load test | Sonnet 5.5 | Script work against a written contract |
| WP4 | The wall | Opus 5.5 | One 100 KB file with interlocking timers, motion and visual judgment |
| WP5 | The phone page | Opus 5.5 | The surface every attendee touches, with a state machine per moment of the day |
| WP6 | The team remote | Sonnet 5.5 | Forms and lists against the contract in section 5 |
| WP7 | Integration, rehearsal, docs | Opus 5.5 leads, Sonnet 5.5 writes the docs | Judgment on what to cut, then mechanical doc updates |

Short version: Opus 5.5 is the builder. Sonnet 5.5 takes the three packages that are pure contract work, so they can run in parallel without spending Opus time. Do not give the wall or the phone page to Sonnet: both are judged by eye and by feel, and there is no time for a second attempt.

### 1.2 Order and Lanes

1. WP0, then WP1, then WP2, in that order, on one branch.
2. After WP2 passes its gate, three lanes run in parallel, each in its own git worktree, each touching only its own file:
   * Wall lane: `public/screen/index.html` (WP4)
   * Phone lane: `public/index.html` (WP5)
   * Team lane: `public/remote/index.html`, `scripts/`, `docs/` (WP3, WP6)
3. WP7 merges the lanes and runs the rehearsal.

No lane edits `netlify/` after WP2. If a lane finds a server bug, it stops, reports it, and the fix goes in on the main branch first.

### 1.3 Rules for the Builder

* Read `CLAUDE.md` first. Its writing rules apply to every string, comment, commit and doc: no em dashes or en dashes, no emojis, American English, Title Case for titles, sentence case for descriptions, hyphens avoided in visible text.
* Only correct facts. Names, titles, times and numbers come from `public/assets/day.js` (after WP1) or from Zaid. When something is missing, leave it out and add it to section 10.
* Asem has no photo, anywhere, ever.
* Work on branch `v2`. One commit per finished task, message in plain words. Do not push, deploy, or touch the live Netlify data without Zaid saying so in that session.
* Registration data is private. Never copy rows from the registration response sheet into the repo, a test, a log, a commit or a screenshot. Tests use the sample people that `scripts/seed.sh` already uses.
* Every task has a priority. P0 ships or the release does not. P1 ships if its gate passes on time. P2 is cut first. The cut order is in section 9.
* Every new feature has a switch in `cfg.flags` and must do nothing visible when its data is empty. Version 1 behavior is the fallback for everything.
* No build step, no framework, no new runtime dependency. Vanilla JS in the existing single files. Dev dependencies are fine.
* No service worker. A bad cache on event day cannot be recalled.
* Before any UI work, load the `zaid-design` skill and follow only its ratified parts: the process in its section 3, the phone gate, and the motion rules. Colors, type and shapes come from the Summit look in `CLAUDE.md`, not from that skill.
* Before calling a UI package done, run the `design-review` agent on it and fix what it finds.
* When a library detail matters (Netlify Blobs, Netlify Functions), read the installed package or fetch current docs. Do not trust memory.

### 1.4 Gates

| Gate | When | Passes when |
| --- | --- | --- |
| G1 | End of WP2, target Friday 13 midday | `npm test` and `npm run test:api` green, state and snap match section 5 |
| G2 | Look gate, target Friday 13 evening | Zaid has seen the wall and phone screenshots from section 7.4 and picked the variants |
| G3 | Feature complete, target Saturday 14 evening | All P0 done, P1 done or formally cut, probes green at three wall sizes in both themes |
| G4 | Freeze, Sunday 15 at 18:00 | Full day rehearsal at speed, load test, 2 hour soak, docs updated, tag `v2-freeze` |
| G5 | On site, Monday 16 | Checklist in section 8.5 done on the real wall with real phones |

## 2. Starting Point

Verified on 12 November by running the code:

* Version 1 works end to end locally: wall, phone page, remote, poll, photo wall, Networking Board, announcements, moments, ticker, light and dark themes, three layouts.
* Version 1 (`main`, commit `c423a9a`) was deployed to Netlify on 12 November with Zaid's go. Pages, state, the sheet proxy and the PIN refusal all answer. `REMOTE_PIN` is set on the project.
* Measured on the live site: the CDN cache for `/api/state` works only inside one edge node. Ten requests on one connection gave nine hits. Ten requests on separate connections gave no hits at all, and every response says `"Netlify Durable"; fwd=bypass`, so the shared durable cache is not in use even though the header asks for it. The request headers a browser sends for `cache: 'no-store'` made no difference.
* The Netlify account is on the Free plan: 125,000 function calls a month. One hundred phones polling state every 6 seconds for the day is about 330,000 requests. Without a working shared cache that is over the limit. See section 5.12.
* The schedule is written three times: `public/screen/index.html`, `public/index.html`, and the Screen Feed sheet. The two files use different shapes.
* The wall polls `/api/state` every 3 seconds, the phone every 12. There is no push channel, and Netlify Functions cannot hold one open. Version 2 stays on polling.
* Public profile ids are device ids. A device id is also the only credential a phone has, so anyone reading `/api/state` can edit another person's card. WP1 fixes this.
* `rebuild()` in `netlify/lib/store.mjs` reads every profile and photo on each approval. Fine for one operator, too slow and racy once approvals are automatic.
* Port 8899 is taken on Zaid's main server by another service. Local work uses 8897.
* The tracker's Participants tab has headers only. The real list is the registration response sheet (69 responses on 12 November). It has name, mobile number, company, job title, LinkedIn, topics of interest and a photo consent answer. It has no room assignments.
* Found by WP0: `theme=dark` in the wall URL is replaced by `cfg.theme` on the first state answer, so against a running server the option does nothing. `scripts/wall-urls.cjs` works around it by pressing the T key. WP4 task 1 fixes it.
* Found by WP0: at 3840x1920 before 10:00, the Today's Advisors grid is 19 px taller than its slot. Listed in `scripts/probe-known.json`. WP4 task 1 fixes it and removes the entry.
* Found by WP0: this machine is busy. Chromium crashes with more than one 3840 wide page open, so the baseline and the probe run one page at a time: about 12 minutes for the baseline, about 20 for the full probe.
* Installed `@netlify/blobs` is 11.1.9. Conditional writes work (`onlyIfNew`, `onlyIfMatch`), also on the local server. One catch, tested: on the local server `getWithMetadata` returns no etag, so read the etag from `list({prefix:key})` or from the result of the last `set`.

## 3. Decisions From Zaid, 12 November

| Topic | Decision |
| --- | --- |
| New attendee features | My Day agenda, Live Reactions, Networking Missions, Session Takeaways. All four |
| Who runs the remote | Shared, nobody dedicated. The system runs itself and asks for a human only when it must |
| Language | English only. Arabic names and answers must still display correctly |
| Identity | Match attendees against the registration list |
| Proof of identity | Last 4 digits of the mobile number they registered with |
| Extras | Lunch Finale on the wall. After the Event page on the phone |
| Not chosen | Screens in the session rooms. Sound on the wall |
| Freeze | Sunday 15 November, evening |
| Builder | A plan that Opus or Sonnet can execute. See section 1.1 |
| Who is accepted | For now, everyone in the response sheet |
| Sessions | Free choice. Each person starts with a session picked for them in each block, from the advisor, topic and time they asked for at registration, and can change it. See section 5.11 |
| Poll questions and times | Approved as drafted in `DEFAULT_POLLS` and `pollPlan` |

## 4. The Experience, Moment by Moment

This is what the day should feel like. Every task in section 6 serves one row of this table.

| Time | The Wall | The Phone | The Team |
| --- | --- | --- | --- |
| Before the day | Not running | Sign in works already. Star sessions, add them to the calendar, join the Networking Board. "See you on Tuesday" card | Import the people list. Run a rehearsal. Wipe test data |
| 09:30 Arrival | Welcome. "42 people are here" counts up. "Welcome, Layla" rises on the wall when someone signs in. QR with one clear line. First poll with bars | Scan, find your name, last 4 digits, done. Lands on My Day. One tap first poll | Registration says one sentence: "Scan the screen and find your name" |
| 10:00 Opening | Last 10 seconds counted down. Speaker cards. Applause from phones rises along the blue band | Reaction pad is the home card. Current speaker shown | Next speaker from the remote, or by the clock |
| 10:30 Videos | Full screen video. Hearts drift up one edge, quietly | Reaction pad stays | Play from the remote |
| 10:40 Coffee | Choose Your Sessions with "18 planning to join" per session. Word cloud poll opens by itself. Advisor Spotlight | "Pick your 11:00 session" with the three options. Poll. Join the board prompt | Nothing to do |
| 10:55 | 5 minute call takes the whole wall, with the three rooms and arrows | Banner and vibration: "Room A in 5 minutes" | Nothing to do |
| 11:00 to 11:45 | Rooms On Now with progress bars. Networking Board with live connection lines. Photos. One to Ones | "You are in Room A until 11:45". Quiet. People tab for those in the hall | Approve photos when the alert arrives |
| 11:40 to 12:10 | Takeaways start to appear as quotes | "How was it?" one tap rating and one line takeaway. Then "Pick your 12:00 session" | Nothing to do |
| 12:00 and 13:00 blocks | Same loop. Poll changes by itself at 12:00 and 13:40 | Same loop | Nothing to do |
| 14:00 Lunch | The Finale: day in numbers, final word cloud, photos, voices of the day, connectors, thank you to the advisors. Reactions on | Missions are the home card: "Meet 3 people". My code and QR. Photos | Trigger the group photo countdown |
| 15:00 Close | Thank You. One QR: keep your connections | After the Event page: connections with LinkedIn, gallery, my takeaways, feedback | Export the data |

## 5. Architecture

### 5.1 Principles

* The app is a mirror. Nothing on the day depends on it (tracker, Risks tab, item 6). If it dies, paper and people still run the day.
* The server decides by the clock at read time. There is no cron. "Which poll is open" and "are reactions on" are computed from the time in every `/api/state` call, unless the remote has taken over.
* One fact, one place. The schedule lives in one file. Lists that can be counted from key names are counted from key names.
* Phones are untrusted. Device ids never leave the server. Text reaches the wall only through a filter or a person.

### 5.2 One Schedule File

Create `public/assets/day.js`. It is a plain script that sets `globalThis.MD_DAY`. The wall and the phone load it with a script tag. The server loads it with `import "../../public/assets/day.js"` from a new `netlify/lib/day.mjs`, which esbuild bundles.

```js
globalThis.MD_DAY = {
  date: "2026-11-17", tz: "Asia/Hebron", open: "09:30", close: "15:00",
  rooms: ["Room A", "Room B", "Room C"],
  blocks: [{ n: 1, s: "11:00", e: "11:45", end: "12:00" }, { n: 2, s: "12:00", e: "12:45", end: "13:00" }, { n: 3, s: "13:00", e: "13:45", end: "14:00" }],
  advisors: { gigi: { name: "Gigi Aulsebrook", role: "Founder and Director, Gia", photo: "/assets/p_gigi.jpg" }, asem: { name: "Asem", role: "", photo: null, noPhoto: true } /* and the rest, copied exactly from the wall file */ },
  sessions: [{ id: "1A", b: 1, room: "Room A", title: "Pitching and Outreach to International Clients", who: ["gigi"], mode: "Online", seats: 25 } /* id is block number plus room letter */],
  ones: [{ who: "rand", room: "Small Room 1", s: "11:00", e: "12:00", mode: "In person", focus: "Founder and Career Conversations" } /* three rows */],
  program: [/* the eight rows from the wall file */],
  speakers: [/* the three rows from the wall file */],
  videos: [{ id: "tareq", title: "Tareq Azza", src: "/videos/tareq-azza.mp4" }, { id: "kassim", title: "KassimLegal", src: "/videos/kassimlegal.mp4" }],
  pollPlan: [{ id: "p2", from: "09:00", to: "10:40" }, { id: "p1", from: "10:40", to: "12:00" }, { id: "p3", from: "12:00", to: "13:40" }, { id: "p4", from: "13:40", to: "15:00" }],
  reactionWindows: [{ from: "10:00", to: "10:40" }, { from: "14:00", to: "15:00" }],
  topicMap: { "Business development and international sales": ["1A", "1C"] /* and the rest of the table in 5.11 */ }
};
```

Copy every value from the existing files. Do not retype titles from memory. The wall and the phone keep their internal shapes: add a small adapter at the top of each that builds `ADVISORS`, `SESSIONS`, `SLOTS`, `PROGRAM`, `SPEAKERS` (wall) and `SESSIONS`, `ONES`, `PROGRAM` (phone) from `MD_DAY`, then delete the old literals. The sheet feed still overrides sessions and slots on the wall as today, and must keep the `id`.

`pollPlan` times and the poll questions are drafts until Zaid approves them (section 10).

### 5.3 Identity and Ids

* `dev`: the device id the phone already makes. New endpoints take it in the `x-dev` header. It never appears in any response to another client.
* `secret`: `sha256("md26|" + REMOTE_PIN)`. If the PIN changes after the import, import again.
* Person id `pid`: first 10 hex characters of `hmac(secret, normalizedName + "|" + last4)`. Stable across imports.
* Public id `pub`: `"p" + pid` for a verified person, `"g" + first 10 hex of hmac(secret, dev)` for a guest or an anonymous phone. Every public list uses `pub`. Validation regex: `^[pg][a-f0-9]{10}$`.
* All storage that is "one per person" is keyed by `pub`, so a person on two phones has one card, one set of stars and one set of takeaways. At most 3 phones per person.
* Sign in: search by name (3 letters minimum, 5 results maximum, names only), pick, type the last 4 digits. 5 wrong tries per phone per person, 10 wrong tries per person in total, then that person is locked until someone taps Unlock in the remote. The phone then says "Ask the team at the registration desk."
* Not on the list: "Continue as a guest", type the name once. Guests can do everything, but their card and takeaways wait for approval.
* If a phone made a guest card and then signs in as a person, move `pr/g...` to `pr/p...` once, best effort.

What the server keeps per person, in the private blob `people`: `id, name, first, company, title, linkedin, topics, advisorPref, photoOk, k4, rooms, slot`. `advisorPref` is `remote`, `local` or empty, from the registration question about preferred advisors. `k4` is `hmac(secret, id + ":" + last4)`. Emails and full phone numbers never reach the server: the remote reduces each row in the browser before sending (WP6).

### 5.4 Storage Keys

Existing keys stay as they are, except that profile keys move from device id to `pub`. New keys:

| Key | Holds | Written by |
| --- | --- | --- |
| `people` | JSON array of people | `op peopleImport` |
| `who/<dev>` | `{pub, pid or null, name, at}` | claim, guest |
| `dv/<pub>/<dev>` | marker, counts phones per person | claim |
| `here/<pub>` | marker, first sign in | claim, guest |
| `hi/<time>~<pub>~<first>` | hello for the wall, only with consent | claim, guest |
| `fail/<pid>/<dev>~<time>` | wrong last 4 digits | claim |
| `star/<block>/<pub>/<sid>~<own or auto>` | one session per block. `auto` was picked for the person, `own` was chosen by them | claim, star |
| `rx/<window>/<dev>~<c>~<h>~<b>~<rand>` | one batch of reactions. `window` is server time divided by 4000, floored | react |
| `rxt/<minute>/<n>~<rand>` | running total helper, optional | react |
| `code/<nnn>` | value is `pub`. 3 digit meet code, 100 to 999 | profile approval, with `onlyIfNew` |
| `cx/<a>~<b>~<time>` | a connection, `a` sorts before `b` | meet |
| `tk/<sid>/<pub>` | `{rating, text, first, showName, at, status}` | takeaway |
| `q/tk/<sid>~<pub>`, `ok/tk/<sid>~<pub>` | queue and approved markers | takeaway, op |
| `fb/<pub>` | after the event feedback | feedback |
| `beat` | last wall heartbeat | beat |
| `pinfail/<bucket>/<rand>` | wrong PIN counter for alerts | op |

Rules:

* Counts come from `list()` on a prefix, in parallel. Never read N blobs to build a count.
* Shared JSON blobs (`cfg`, `snap`, `people`, `polls`) change only through one helper, `update(s, key, fn)`: read, apply `fn`, write with `onlyIfMatch`, retry up to 6 times. First write uses `onlyIfNew`. See the etag catch in section 2.
* `rebuild()` stays, as the "Repair lists" action in the remote and as the last step of `wipe`. Normal approvals use `update` on `snap` and touch one item.

### 5.5 Clock and Rehearsal

* `netlify/lib/day.mjs` exports `nowMs(cfg)`, `localMin(ms)`, `localDate(ms)` (both in `Asia/Hebron` through `Intl.DateTimeFormat`), and `phase(ms)`: `before` (before 09:00 on the day), `day`, `after` (from 15:00 on the day).
* Rehearsal: `op rehearsal {hhmm}` stores `cfg.rehearsal = {shift, until}`, where `shift` moves the server clock to that time on 17 November and `until` is 2 hours ahead in real time. `nowMs` adds the shift while it is valid. `op rehearsal {hhmm:null}` clears it. The server refuses to start a rehearsal on the real 17 November.
* `/api/state` returns `t` (shifted server time) and `reh` (true during a rehearsal).
* Clients keep their own clock, with one rule: when `abs(t - Date.now())` is more than 15 seconds on a fresh response, use `Date.now() + skew`. This covers a wrong clock on the wall computer and makes rehearsals move every screen and phone together. The `?t=` option on the wall and phone still wins over everything.
* During a rehearsal the wall shows a small "Rehearsal" tag in the band next to "Live", and the remote shows a banner.

### 5.6 State and Snap

`GET /api/state`, cached 2 seconds at the CDN, 1 second while reactions are on:

```
{ t, reh, phase,
  cfg: { mode, pin, speaker, theme, overlay, ann, video, way, reloadAt, photoAt, finale, flags },
  poll: { id, q, type, options, open, total, words, manual },
  rx: { on, b: [[window, clap, heart, bloom], [window, clap, heart, bloom]], total },
  n: { here, board, links, photos, takeaways, answers },
  interest: { "1A": 18, "1B": 9 },
  hello: [{ f: "Layla", at }],          // newest 12
  snapV: "<snap.at>.<n.links>",
  tags, videos }
```

`GET /api/snap?v=<snapV>`, cached for an hour at the CDN because the URL changes when the content does:

```
{ at,
  photos: [{ id, name, caption, at }],
  profiles: [{ id, name, company, role, looking, offer, linkedin, at }],   // id is pub
  links: [[pubA, pubB, at]],                                               // from the cx/ key names
  takeaways: [{ id, sid, text, first, at }] }
```

Clients fetch the snap only when `snapV` changes, and keep the last one in `localStorage`. The wall today reads `d.photos` and `d.profiles` from state: change it to read them from the snap.

`rx.b` holds the current and the previous 4 second window. Counts in a window only grow, so a client remembers what it has already shown per window and animates the difference. This is safe against a stale CDN copy.

Check after the first deploy: `curl -sI https://<site>/api/state` twice within a second, and confirm the `cache-status` header shows a hit. If the browser's `cache: 'no-store'` request header defeats the CDN cache, switch the clients to a plain `fetch` with a `?_=` value that changes every 2 seconds.

### 5.7 API Contract

All new phone endpoints take `x-dev`. All errors are `{error: "plain sentence"}` with a fitting status.

| Route | Body | Returns | Notes |
| --- | --- | --- | --- |
| `GET /api/who?q=` | | `{list: [{id, name}]}` | 3 letters minimum. Matches the start of any word in the name, Latin or Arabic, case and diacritics ignored. 40 searches per phone per 10 minutes |
| `POST /api/claim` | `{id, last4, hello}` | `{ok, me}` | 401 with `{left}` on a wrong code, 423 when locked. On a person's first sign in, writes their picked sessions, see 5.11 |
| `POST /api/guest` | `{name, hello}` | `{ok, me}` | Name through `clean` and `isBad` |
| `POST /api/signout` | | `{ok}` | Deletes `who/<dev>` only |
| `GET /api/me` | | `{status, me, stars, profile, code, links, takeaways, feedback}` | `status` is `none`, `guest` or `person`. `me` has `pub, name, first, company, title, linkedin, suggest, rooms, slot, photoOk`. `stars` is `{1: {sid, by, why}}` where `by` is `own`, `auto` or `team` and `why` is the registration topic behind an automatic pick. Replaces `GET /api/profile` on the phone |
| `POST /api/star` | `{b, sid}` | `{ok, stars}` | `sid` null removes. One per block. Always stored as `own`, and replaces an automatic pick |
| `POST /api/react` | `{c: {clap, heart, bloom}}` | 204 | Each count capped at 30. One batch per phone per 3 seconds. 409 when reactions are off |
| `POST /api/profile` | as today | `{ok, status}` | Auto approved for a verified person when `flags.trustProfiles` is on. Assigns the meet code on approval |
| `POST /api/meet` | `{code}` | `{ok, person}` | Both must be on the board. Not yourself. Same pair twice is fine and does nothing. 5 wrong codes per phone per 10 minutes, 60 connections per person |
| `POST /api/takeaway` | `{sid, rating, text, showName}` | `{ok, status}` | Rating 1 to 5, required. Text optional, 120 characters, through `clean` and `isBad`, no links, no runs of 7 or more digits. Open only in the session's window, see 5.8 |
| `POST /api/feedback` | `{overall, recommend, text}` | `{ok}` | Only in phase `after` |
| `POST /api/forget` | | `{ok}` | Removes my card, connections, stars, takeaway text and name. Keeps ratings without the name |
| `GET /api/ics?s=1A,2A` | | calendar file | Times converted from `Asia/Hebron`. Alarm 5 minutes before |
| `POST /api/beat` | `{w, h, dpr, layout, mode, scenes, lite, fps, err, at}` | 204 | From the wall every 60 seconds. Body capped at 1 KB |
| `GET /api/export/:what` | | CSV with a UTF 8 byte order mark | Needs `x-pin`. `what` is `takeaways`, `ratings`, `polls`, `board`, `links`, `feedback`, `signins` |
| `POST /api/photo` | as today | as today | With a valid `x-pin` the photo is approved at once (team upload) |

New `op` actions, all logged: `peopleImport {people}`, `peopleUnlock {id}`, `rehearsal {hhmm}`, `wipe {phrase}`, `reload`, `flags {name, on}`, `rx {mode}` (`auto`, `on`, `off`), `pollManual {on}`, `approveTakeaway`, `rejectTakeaway`, `hideTakeaway {sid, id}`, `finale {step}`, `groupPhoto {secs}`, `links {survey}`, `repair`. `GET /api/op` also returns `screen` (the last beat with its age), `people` (count, signed in, locked list), `pending.takeaways`, and `auto` (what the clock rules are doing now and what happens next).

`wipe` needs the phrase `RESET MD26`, deletes every prefix in section 5.4 plus `ans/`, `ph/`, `pr/`, `q/`, `ok/`, `byd/`, `log/`, keeps `people`, `polls` and `cfg.way`, and is refused between 08:00 and 16:00 on the real 17 November.

### 5.8 What Runs by the Clock

| Rule | Detail |
| --- | --- |
| Polls | The open poll is the `pollPlan` row for the current time, unless `cfg.poll.manual` is true. Opening a poll from the remote sets `manual`. "Back to the schedule" clears it. Outside all rows the last poll shows as closed |
| Reactions | On inside `reactionWindows`, unless `cfg.rx` is `on` or `off` |
| Takeaway window | For block b: from 5 minutes before `e` until 20 minutes after `end`. Block 3 stays open until 15:00 |
| Phase | `before`, `day`, `after` |
| Wall mode | As today, by the program, unless held from the remote |

### 5.9 Who Approves What

| Content | Rule |
| --- | --- |
| Poll words | Automatic with the word filter, as today |
| Card of a verified person | Automatic. Name and company come from registration. Switch: `flags.trustProfiles`, on by default |
| Card of a guest | Waits for a person |
| Takeaway from a verified person | Automatic with the filter. Switch: `flags.trustTakeaways`, on by default |
| Takeaway from a guest | Waits for a person |
| Photo from an attendee | Waits for a person. Switch `flags.trustPhotos`, off by default, lets verified people who agreed to photos skip the queue |
| Photo from the team | Automatic |

### 5.10 Alerts

Optional, only when `ALERT_TELEGRAM_BOT` and `ALERT_TELEGRAM_CHAT` are set. One helper `alert(kind, text)`, at most one message per kind per 3 minutes, 2.5 second timeout, never fails the request. Kinds: photos waiting, guest card or takeaway waiting, a person locked out, an error reported by the wall, 50 wrong PINs in 10 minutes. The message carries a count and the remote link, never a name.

### 5.12 Function Call Budget

The Free plan allows 125,000 function calls in the month, and rehearsals and tests on the live address in November count too. What happens at the limit is not confirmed, so the build treats it as a wall: the whole event day must fit in 60,000 calls, leaving the rest for rehearsals and the on site test.

Rules:

1. The shared durable cache must work for `/api/state` and `/api/snap`, or the polling design changes. First step in WP2: find out why the response says `"Netlify Durable"; fwd=bypass`. Read the current Netlify caching docs. Things to try on a deploy, one at a time, with ten requests on separate connections after each: `max-age` in place of `s-maxage` in `Netlify-CDN-Cache-Control`, a longer time (5, 10, 30 seconds), dropping `must-revalidate` from `Cache-Control`. Record what works in this section.
2. If the durable cache cannot be made to work at 2 seconds: state is cached for the longest time that does work, and anything that must feel instant on the wall (reactions) moves to its own small route with its own short cache, polled only by the wall.
3. Phones poll state every 15 seconds by default, every 6 seconds only on the Live and People tabs, never while hidden, and stop after 10 minutes without a touch until the next touch.
4. Reactions: one batch per phone every 3 seconds at most, sent only when there is something to send, and at most 150 batches per phone in the day, enforced on the phone.
5. The remote polls `/api/op` every 8 seconds, only while visible.
6. The wall polls state every 3 seconds, the sheet tabs every 60 seconds, and sends a beat every 60 seconds.
7. The simulator counts every request it makes per route and prints the total a real day would cost. WP7 does not pass unless that total is under 60,000 with the cache hit rate measured on the live site.
8. Live load tests are short: 2 minutes, once per deploy.

If the budget cannot be met, the fallbacks are, in order: a paid Netlify plan for November, or the self hosted server on Zaid's own machine behind a public HTTPS address doing the API work. Both are Zaid's decision (section 10). In both cases the printed QR address stays the Netlify one: with the self hosted fallback, Netlify keeps serving the pages and a `[[redirects]]` rule with status 200 in `netlify.toml` passes `/api/*` through to the self hosted server, which uses no function calls.

### 5.11 Picked for You

Sessions are free choice, but nobody starts from an empty page. On a person's first sign in the server picks one session per block from what they asked for at registration, and stores it as an `auto` star. The person can keep it or change it with one tap.

`day.js` carries the mapping as `topicMap`, keyed by the English part of each registration topic. It is a draft until Zaid approves it (section 10):

| Registration topic | Sessions |
| --- | --- |
| Business development and international sales | 1A, 1C |
| AI adoption and applied AI | 1B |
| Product management and strategy | 2A |
| Fundraising, finance, and scaling a company | 3A |
| Career growth and remote work | 3C, 3B |
| Engineering leadership and architecture | 3B, 1B |

Rules, per block:

1. Score each session: 3 points for each of the person's topics that maps to it, plus 1 point when the delivery fits their advisor preference (`remote` with Online, `local` with In person).
2. Take the highest score above zero. Ties go to the session with fewer people planning to join, then to room order.
3. Skip a session that already has as many people planning to join as it has seats, and take the next.
4. No session scores above zero: no pick. The phone asks the person to choose.
5. A room assigned by the team in the import always wins, shows as "Your seat", and is returned with `by: "team"`.
6. Picks are made once. They are never recalculated after the first sign in, and a choice by the person is never overwritten.

Words on the phone: "Picked for you", with the reason on one line ("Because you chose AI adoption and applied AI"), and two actions, "Keep" and "Change". "Keep" turns the pick into `own`. The wall counts `own` and `auto` stars together as "planning to join".

## 6. Work Packages

Each task: priority, what to build, and how to know it is done.

### WP0 Baseline (Sonnet 5.5)

Read first: `CLAUDE.md`, `package.json`, `scripts/`.

1. P0. Create branch `v2`. Change the dev port from 8899 to 8897 in `package.json`, `scripts/seed.sh`, `scripts/e2e.cjs`, `scripts/shoot.cjs` and `CLAUDE.md`.
2. P0. `npm i -D playwright`, install Chromium, create `dev/shots/`, run `npm run dev`, `npm run seed`, `npm test`. Fix only what stops the existing test from passing.
3. P0. Save baseline screenshots to `dev/shots/baseline/`: the wall at 3840x1920, 1920x1080 and 3840x1080, light and dark, at `t=09:40`, `10:02`, `10:45`, `10:55:02`, `11:20`, `14:10`, plus each scene id from `CLAUDE.md` held with `scene=`. The phone tabs at 390x844.
4. P0. Write `scripts/probe.cjs`. For a list of wall URLs at the three sizes and both themes it fails when: any page error or console error; any `.sb` child overflows its slot; any visible text has a computed size under 1.3 times `--u`; two canvas checksums 2 seconds apart are equal (the background stopped). It prints one line per check. Add `npm run probe`.
5. P0. Ask Zaid for the go, then deploy `main` as it is to Netlify, so the pipeline and the QR address are proven before version 2 exists. Run the CDN check from section 5.6. Zaid opens the phone page on his own phone once.

Done when: the baseline folder exists, `npm test` and `npm run probe` pass on `main`, and the site answers at its Netlify address.

### WP1 Server Foundation (Opus 5.5)

Read first: section 5, all of `netlify/`, `server/index.mjs`.

1. P0. `public/assets/day.js` and `netlify/lib/day.mjs` as in 5.2 and 5.5. Adapters in the wall and phone files, old literals deleted. Proof that nothing changed: before editing, save the visible text of `#app` (wall) and `main` (phone) for every baseline view to `dev/text-before/`; after editing, save it again and diff. The diff must be empty apart from the seconds of the clock. Pixels cannot be compared because the background moves.
2. P0. `update()` helper as in 5.4, with a test that runs 20 concurrent updates on one key and loses none, on the local server.
3. P0. Ids as in 5.3. Move profiles to `pub` keys. `/api/op` returns `pub` ids, and its approve, decline and remove actions take them.
4. P0. State and snap as in 5.6. `snap` changes through `update`. Wall and phone read lists from the snap.
5. P0. Clock, phase and rehearsal as in 5.5. `wipe`, `reload`, `flags`, `repair` actions. `POST /api/beat`.
6. P0. Safety: `x-content-type-options: nosniff` on photos, the wrong PIN counter, body size limits on every new route, `cfg.hidden` still never public.
7. P0. `scripts/api-test.mjs` using `node:test` against a local server it starts itself on a free port with a temp data folder. Add `npm run test:api`. Cover every route in this package: the good path and each refusal.

Done when: `npm test`, `npm run test:api` and `npm run probe` pass, and no response to an anonymous client contains a device id (the API test asserts this by scanning every public response for every device id it used).

### WP2 Feature API (Opus 5.5)

Read first: sections 5.3 to 5.10.

0. P0, first. The function call budget in section 5.12: make the durable cache work or change the polling design, and write the result into 5.12. Needs Zaid's go for each deploy.
1. P0. `who`, `claim`, `guest`, `signout`, `me`, with limits and lockout. `peopleImport`, `peopleUnlock`.
2. P0. `star` and `interest` in state. Picked sessions on first sign in as in 5.11, with an API test for each of the six rules.
3. P0. Poll schedule as in 5.8, with `pollManual`.
4. P0. Auto approval of verified cards, `here` and `hello`.
5. P1. `react` and `rx` in state, with the 1 second CDN time while on.
6. P1. Meet codes, `meet`, `links` in the snap, `n.links` in state.
7. P1. `takeaway` with its window, queue and approval actions, `takeaways` in the snap.
8. P1. `export`, team photo upload, `groupPhoto`, `finale`, `links`.
9. P1. Alerts as in 5.10.
10. P2. `feedback`, `forget`, `ics`.
11. P0. Extend `scripts/api-test.mjs` for all of the above. Extend `scripts/seed.sh` to import the six sample people (with made up last 4 digits kept in the script), sign four of them in, star sessions, add two connections and three takeaways.

Done when: gate G1.

### WP3 Crowd Simulator (Sonnet 5.5)

Read first: section 5.7, `scripts/seed.sh`.

1. P0. `scripts/sim.mjs`. Arguments: `--base`, `--people 100`, `--from 09:25`, `--speed 30`. It starts a rehearsal at `--from`, imports generated sample people (names from a fixed list of sample first and last names in the script, clearly test data), then plays the day in fast time: sign ins with hellos through arrival, stars, a poll answer per person per poll, reaction bursts in both windows, 60 cards, connections that speed up at lunch, photos from `scripts/sample.jpg` approved through `op`, takeaways after each block. It refuses any address that is not localhost unless `--allow-remote` is given, and then prints a warning and waits 5 seconds.
2. P0. `--load` mode: 120 clients polling state at the phone cadence, with the same bursts. Prints p50, p95, error count per route. Budget locally: p95 for state under 400 ms, no 5xx.
3. P1. `npm run sim`, `npm run load`.

Done when: a simulated day fills every wall scene with believable data and the load numbers print.

### WP4 The Wall (Opus 5.5)

Read first: section 4, section 7, the whole of `public/screen/index.html`, then run the simulator and watch a full day at speed before changing anything.

Keep: the three layouts, the U unit, both themes, every keyboard key, every URL option, the offline behavior.

1. P0. Plumbing. `day.js`, state and snap, the clock rule, polling as section 5.12 says, heartbeat every 60 seconds, reload when `cfg.reloadAt` is newer than page load (never during a video or a moment), `navigator.wakeLock`, `window.onerror` into the next beat, a watchdog that reloads if the main loop has not ticked for 20 seconds. Expose `window.__md = {S, slotState, force(id)}` for probes. `theme=` in the URL wins over `cfg.theme`, and the T key workaround leaves `scripts/wall-urls.cjs`. Fix the Today's Advisors overflow at 3840x1920 and remove its entry from `scripts/probe-known.json`.
2. P0. Performance governor. Measure frame time for the first 6 seconds and then on a rolling 120 frames. If the average stays over 22 ms for 3 seconds, set `data-lite` on the root: no `backdrop-filter` (glass becomes a solid fill at .86 alpha), no blur in reveals, half the background nodes, at most 30 effect particles. Never switch back in the same session. Report `lite` and fps in the beat. `?lite=1` and `?lite=0` force it. The screen check view shows fps and lite state.
3. P0. Motion system, as in section 7.2. One set of duration and easing tokens. Scene change, title change, leaf pills, blue rules and numbers each get one treatment, used everywhere.
4. P0. The director. Replace fixed rotation with `nextFor(slot)`:
   * A scene is eligible only with content: `way` needs directions, `takeaways` needs one, `pulse` needs three numbers above zero. `photos` and `meet` with nothing to show appear as a join prompt at most once in four turns.
   * Bumps: a new approved photo, three new poll answers within 10 seconds, a new connection, a new takeaway each put their scene at the front of one secondary slot. A bump waits until the current scene has shown for 8 seconds, and each scene can bump once per 90 seconds.
   * Clock: from 10 minutes before a block, the primary slot holds Choose Your Sessions for that block. During a block it holds Rooms.
   * Dwell follows content: photos 4 seconds per photo between 20 and 45, word cloud longer while answers arrive.
   * Holding a scene or a mode from the remote still wins.
5. P0. Arrival. In Welcome: "N people are here" from `n.here` with a count up, and each new `hello` rises as "Welcome, Layla" beside the title, three at a time at most, 4 seconds each. In other modes hellos appear only in the ticker. The QR block gets one line that fits the moment: "Scan and find your name" before 10:40, "Scan to pick your 11:00 session" in the coffee break, "Scan to meet your 3 people" at lunch, with a soft ring pulse every 20 seconds.
6. P0. Moments. A moment covers the stage and the rail. The 5 minute call shows the three rooms with their arrows when directions exist. The last 10 seconds before 10:00, 11:00, 12:00 and 13:00 count down in large numerals, then "Starting Now". Announcements keep their look and get the masked text entrance.
7. P0. Choose and Rooms. Each session shows "N planning to join" from `interest` when N is above zero. Seats left and its bar show only when the tracker has at least one booking, so the wall never shows a made up number. Live sessions get a thin progress bar for the 45 minutes. Under 5 minutes left the tag reads "Wrapping up".
8. P0. Arabic text. `dir="auto"` on every element that shows text typed by a person. Add Noto Sans Arabic 400 and 700 as woff2 in `public/assets/` (Open Font License, copied from the `@fontsource/noto-sans-arabic` package without adding it as a dependency) and put it after SS3 in the font stack and in the word cloud measuring font.
9. P1. Reactions. A new canvas above the stage, pointer events off. Each reaction is a small drawn shape (clapping hands, a heart, the Summit honeycomb flower) in orange or blue, never an emoji character. Shapes rise from the band over 3.2 seconds with a slight sway and fade. At most 70 alive, 30 in lite. When more arrive than fit, shapes grow instead of multiplying. The thick blue band brightens with the rate. In Opening the now zone shows the running total. Over a video only hearts show, on the right edge, at 60 percent opacity. Poll state every 1.5 seconds while `rx.on`.
10. P1. Networking Board as a constellation. People on the board are nodes with initials, placed by a seeded layout so they do not jump between refreshes. Connections are lines in the Summit network style. A new connection draws its line over 900 ms, both nodes pulse, and one line of text says "Layla Khoury and Omar Saleh just connected". The featured card and "who is looking for what" stay, beside it. Counter: "N connections made". With zero connections the scene looks like version 1.
11. P1. Takeaways scene, title "Voices of the Day". One quote large, two smaller, each with the session title and room, and the first name when allowed. Quotes enter line by line, masked. New ones first.
12. P1. Poll. A new word flies in from the QR and lands, the rest make room. Bars race when counts change. When the scheduled poll changes, a short moment shows the top three answers of the one that closed, then the new question.
13. P1. Photo Wall. The big photo crossfades in place instead of repainting the scene. A photo approved in the last 2 minutes carries a "New" leaf tag. Layouts for 1, 2, 3 to 5, and 6 or more photos.
14. P1. Lunch Finale. In Lunch mode the primary slot loops six steps: Day in Numbers (people here, sessions, one to ones, poll answers, connections, photos, reactions), the last poll, Photos, Voices of the Day, Connectors of the Day (the five people with the most connections, and how many people met their 3), Thank You to Our Advisors. A secondary slot keeps the QR and the constellation. `groupPhoto` shows a full wall countdown ring, a white flash at zero, then "Thank You" for 5 seconds. At 15:00 the wall holds Thank You with the one QR.
15. P2. The garden grows. One small flower joins the timeline strip for every 6 interactions (answers, photos, connections, takeaways, sign ins, and reactions divided by 10), up to 60, at seeded positions between the program flowers. Each grows stem first, then blooms. The finale's first step names the total.
16. P2. Clock digits roll on change. Advisor Spotlight gets a live tag and the progress ring it already has. The ticker puts announcements and "starting soon" lines first.

Done when: `npm run probe` passes on every scene at the three sizes in both themes with simulator data and with empty data, a simulated day at speed 30 shows no error, and the `design-review` agent has no open finding.

### WP5 The Phone Page (Opus 5.5)

Read first: section 4, section 7, `public/index.html`, the `mobile-first-pwa` skill.

Four tabs in a bar at the bottom, inside the safe area: My Day, Live, People, Photos. The header shrinks to the title and the blue rule.

1. P0. Shell. Paint at once from the last state, snap and `me` kept in `localStorage`, then refresh. No skeletons, no spinners over content. Poll state as section 5.12 says: every 15 seconds by default, every 6 seconds on the Live and People tabs, never while hidden, paused after 10 minutes without a touch. The phone never polls faster for reactions: its own taps animate locally. A thin banner when offline, and a queue that sends answers, stars and takeaways when the connection returns. `dir="auto"` on all typed text. Touch targets at least 44 px. `navigator.vibrate(10)` on a successful send where it exists.
2. P0. Sign in, shown on first open as a sheet over My Day. Step 1: "Find your name", a search field, results as you type. Step 2: "Last 4 digits of your mobile number", four boxes, numeric keyboard. Step 3: one switch, "Say hello to me on the big screen", on by default, first name only. Links: "I am not on the list" for guests, and "Not now" to skip. Wrong code shows how many tries are left. A signed in person can sign out from the bottom of My Day.
3. P0. My Day. The top card follows this table. It checks the clock every 15 seconds.

   | When | Card |
   | --- | --- |
   | Phase `before` | "See you on Tuesday", date, place, doors at 09:30. Star your sessions below |
   | 09:00 to 10:00 | "Good morning, Layla". Opening at 10:00 in the Main Hall, with a countdown. Button to the first poll. Button to join the Networking Board if not on it |
   | 10:00 to 10:40 | "On stage now" with the speaker or video title. Button to Live for reactions |
   | Break before a block, automatic pick | "Picked for you: Room B at 11:00", title, advisor, the reason line, countdown. "Keep" and "Change" |
   | Break before a block, no pick | "Pick your 11:00 session": the block's sessions as three large choices with "N planning to join" |
   | Break before a block, own choice or kept | "Next: Room A at 11:00", title, advisor, countdown. "Change" link |
   | 5 minutes before | The same card turns orange, vibrates once, and the tab title changes |
   | In a block, starred | "You are in Room A until 11:45", title, advisor, a progress bar |
   | In a block, no star | The block's sessions, marked "On now", plus "In the Main Hall? Meet people" to the People tab |
   | Takeaway window open, not answered | "How was it?" See task 6 |
   | One to one assigned | Always pinned second: advisor, time, room, "Be in the Main Hall 3 minutes before" |
   | 14:00 to 15:00 | "Lunch and Networking". Mission progress, button to People |
   | Phase `after` | See task 9 |

   Below the card: the three blocks with a star per session (one per block, tapping another moves it), One to Ones with "Book yours at the registration desk", the full agenda folded. An automatic pick shows a small "Picked for you" tag until the person keeps or changes it. If the import carried assigned rooms, that session is starred already and labeled "Your seat".
4. P0. Live tab. The current poll, exactly as today, with the answer field or the choices first. Numbers of the day from `n`.
5. P1. Reactions on the Live tab and as a floating pad on My Day while `rx.on`: three large round buttons with the drawn shapes. Each tap animates on the phone at once. Taps are batched and sent every 3 seconds at most, with the daily cap from section 5.12.
6. P1. Takeaways. In the window: the session (starred, or a short picker, or "I was not in a session"), five flowers to tap for the rating, one optional line "One thing you are taking away", a switch "Show my first name", Send. Afterward the card shows "Thank you" and whether the line is on the wall or waiting.
7. P1. People tab. Top: my card. For a verified person the form opens filled in from registration (name, company, role from job title, LinkedIn) with suggested tags from topics (mapping in section 10, the person confirms). Consent line: "Show my card and my connections on the big screen and to other attendees today." Once on the board: my 3 digit code, large, with a QR of `<site>/?m=<code>`, and "Your 3 people to meet". Ranking: 2 points for each tag they offer that I look for, 2 for each tag they look for that I offer, 1 for each shared "looking for" tag; ties go to people with fewer connections, then to a stable hash of the two ids. Each suggestion shows one reason line, for example "Can help you with Funding". "We met" opens a field for the other person's code; opening the page with `?m=` does the same without typing. Progress shows as a flower with three petals. Then: My Connections with LinkedIn buttons, then everyone, with the tag filter that exists today.
8. P0. Photos tab. Today's upload, plus one line: "Make sure the people in your photo are happy to be on the big screen." P1: a grid of approved photos below, tap to open.
9. P1. After the Event. From phase `after` the tabs are Keepsake, People, Photos. Keepsake: "Thank you, Layla", the day in numbers, my takeaways, a three question feedback form (overall 1 to 5, would you recommend it 0 to 10, one line), or a button to `cfg.links.survey` when Zaid sets one. People opens on My Connections. Uploads, polls and reactions are closed. "We met" still works. A quiet "Remove my data" link calls `forget` after a confirm.
10. P2. Calendar file button on My Day. Web manifest and icons so the page opens cleanly from the home screen.

Done when: the extended end to end test passes at 390x844 in Chromium and WebKit, every state in the task 3 table has a screenshot taken with `?t=`, the page is usable with JavaScript state from a cold start on a throttled 3G profile within 3 seconds, and Zaid has opened it on his own phone over mobile data.

### WP6 The Team Remote (Sonnet 5.5)

Read first: section 5.7, `public/remote/index.html`. Keep its look: it is a tool, not a showpiece.

1. P0. New first tab, Status. The wall: online or not, seconds since the last beat, mode, scenes, size, lite, last error. "Running by itself": what the clock rules are doing and what comes next ("Poll changes at 12:00", "Reactions on until 10:40"). Counts from `n`. What is waiting. One row of one tap announcements: "Sessions start in 5 minutes", "Lunch is served in the Main Hall", "Group photo in the Main Hall now", "One to one slots are open at the registration desk".
2. P0. People tab. Import: choose the CSV file downloaded from the response sheet, or paste rows copied from it. Parse in the browser (quoted cells with line breaks included), find columns by header text ("full name", "mobile number", "company", "job title", "linkedin", "which topics", "which advisors", "consent to photos"; and when present "status", "block 1 room", "block 2 room", "block 3 room", "one to one slot"), skip empty rows, keep the newest row per phone number, and show a preview: how many people, how many skipped and why. Topics are read by looking for each known topic from `topicMap` inside the cell, never by splitting on commas, because one topic contains commas itself. Every row is accepted unless a Status column says otherwise. Only then send `{name, company, title, linkedin, topics, advisorPref, photoOk, last4, rooms, slot}` per person. The email and the full number never leave the browser. Below: who has signed in, who is locked with an Unlock button, guests.
3. P0. Tools box on Status: start a rehearsal at a chosen time and stop it, Reload the Wall, Repair Lists, feature switches from `cfg.flags`, and Wipe Test Data behind typing the phrase.
4. P1. Approve tab: takeaways queue with approve and decline, a remove button on approved ones, the three trust switches from 5.9, and "Add team photos" (choose several, sent with the PIN, approved at once).
5. P1. Polls tab: "Follows the schedule" or "Held by you", with "Back to the schedule". Screen tab: reactions Auto, On, Off; finale step buttons; "Group photo in 60 seconds"; survey link field.
6. P1. Export tab: one download button per CSV.

Done when: the end to end test drives import, a sign in, an unlock, a rehearsal and a wipe through the remote at 420 px wide.

### WP7 Integration and Rehearsal (Opus 5.5, docs by Sonnet 5.5)

1. P0. Merge the lanes. Extend `scripts/e2e.cjs` to one story: import, sign in on a phone, star, answer, react, join the board on two phones, meet, send a takeaway, see each of them on the wall, export.
2. P0. Rehearsal of the whole day at speed 30 with the simulator, wall at 3840x1920, recorded as screenshots every simulated 5 minutes into `dev/shots/day/`. Read every screenshot. Fix what is wrong.
3. P0. Load test and a 2 hour soak as in section 8.
4. P0. Docs: update `CLAUDE.md` (repo table, API, storage keys, testing, open items), `docs/SPEC.md` (what version 2 does), `docs/OPERATIONS.md` (the new runbook in section 8.6), `README.md`. Add one page, `docs/TEAM-CARD.md`, for the floor team: the one sentence to say at registration, what to do when someone is locked out, what the alerts mean.
5. P0. Ask Zaid for the go, deploy, run the live checks in section 8.4, tag `v2-freeze`.

## 7. Design and Motion Rules

### 7.1 Look

The Summit look in `CLAUDE.md` is the contract: the gray gradient, orange titles, blue rules, navy text, leaf pills, honeycomb flowers on the triple band, the leaf border. Version 1 already follows it. New elements are built from the same parts. Orange is for titles and "now". Blue is for structure and "next". Small text is navy, never orange. Every new element is checked in the dark theme too.

### 7.2 Motion on the Wall

* The background never stops, also in lite mode.
* Text enters masked: each line rises from behind its own clipped edge. Text does not fade in.
* Arrivals use depth: content comes forward (scale 1.06 to 1 with opacity and a small rise), and leaves by receding (scale to .97). No flat slide from an edge.
* Leaf pills unfold from their square corner. Blue rules draw from the left. Numbers count.
* Tokens: 240 ms for small state changes, 520 ms for elements, 900 ms for scene changes, stagger 55 ms up to 14 items. Easing `cubic-bezier(.2,.8,.2,1)` out, `cubic-bezier(.65,0,.25,1)` in and out. No bounce.
* Motion marks a change or an arrival. Nothing loops for decoration except the background, the live dot and the current flower.
* Animate transform and opacity. Blur only on a few large elements and never in lite mode.
* `prefers-reduced-motion` keeps its current behavior.

### 7.3 The Phone

* Built for one hand: actions in the lower half, tabs at the bottom, one main action per card.
* Last known data shows instantly. Sending is optimistic and corrects itself.
* 16 px side margins, inputs at 17 px so iOS does not zoom, no horizontal scroll at 320 px.
* The same leaf shapes and colors as the wall, so the two feel like one thing.

### 7.4 Look Gate With Zaid (G2)

Zaid does not accept design from imagination. Show rendered screens and let him point. Build two real variants only where taste risk is highest, switchable with `?v=a` or `?v=b`:

1. Phone: the sign in sheet and the My Day top card.
2. Wall: the Welcome mode with hellos, and the constellation.

Send him: both variants of each, at 390x844 for the phone and 3840x1920 for the wall, with a one line recommendation. He picks or mixes. After that, no further questions about look. Everything else follows the rules above without asking.

## 8. Verification

### 8.1 Always

`npm test` and `npm run test:api` before every commit that ends a task. For the wall, `npm run probe -- --only <view>` on the views the task touched. The full `npm run probe` (about 20 minutes on this machine, one page at a time) runs at the end of each package and at every gate. A finding goes into `scripts/probe-known.json` only when it is a version 1 fault with a planned fix, never to hide a new one.

### 8.2 Rehearsal

`npm run dev`, then `npm run sim -- --from 09:25 --speed 30`, wall open at `/screen/?quiet`. One real hour covers the day in 11 minutes. Watch it once fully in each theme.

### 8.3 Load and Soak

* `npm run load` locally: p95 for state under 400 ms, no 5xx, no lost answers (the simulator counts what it sent against what the tally shows).
* Soak: wall open for 2 hours against a simulator at speed 3. Heap growth under 30 percent after the first 10 minutes, no errors, fps steady.

### 8.4 Live Checks After Deploy

The Netlify store is shared by every deploy of the site, so tests on the live address write live data. Run them before real data exists, then wipe.

1. `curl -sI` on state twice: CDN hit on the second.
2. `npm run load -- --base https://mentorship-day-live.netlify.app --allow-remote`, for 2 minutes only because every call counts against the monthly limit: p95 for state under 800 ms, no 5xx, and the cache hit rate printed.
3. Zaid's phone on mobile data: sign in as a sample person, star, answer, react, upload a photo.
4. Remote on a second phone: approve, announce, rehearsal on and off.
5. Wipe Test Data.

### 8.5 On Site, Monday 16

1. Wall computer: Chrome in kiosk mode with the flags from `docs/OPERATIONS.md`. Screen check from the remote: frame on the edges, small text readable from the back, fps and lite state noted.
2. Clock on the wall computer against a phone.
3. A rehearsal at 09:55, 10:59:40 and 13:59 from the remote: moments, countdowns and the finale on the real wall.
4. Five real phones on the hall WiFi and two on mobile data through the whole flow.
5. Videos with sound, once Zaid has added the files.
6. Unplug the network for 2 minutes: the wall keeps running and comes back by itself.
7. The laptop fallback starts with `npm start` and serves the wall.
8. Set the This Way directions.
9. Stop the rehearsal. Wipe Test Data.

### 8.6 Event Morning, Tuesday 17

1. 08:30: import the final people list from the remote. Check the count.
2. Status tab: wall online, "Running by itself" reads sensibly, no rehearsal, flags as wanted.
3. One real sign in, one hello on the wall.
4. Share the remote link and the PIN with the team. Give registration the team card.

## 9. Schedule and Cut Lines

| Day | Target |
| --- | --- |
| Thursday 12, evening | WP0. Version 1 live on Netlify. WP1 started |
| Friday 13 | WP1 and WP2 done by midday (G1). Lanes start. Look gate in the evening (G2) |
| Saturday 14 | All P0 in the three lanes by midday. P1 through the day. G3 in the evening |
| Sunday 15 | Morning: last P1, merge. Afternoon: rehearsal, load, soak, docs. 18:00 freeze (G4). Deploy |
| Monday 16 | On site test (G5). Fixes only, each one rehearsed |
| Tuesday 17 | Event |

If a gate slips, cut in this order, top first, and say so in the commit and to Zaid:

1. All P2: garden growth, clock roll, calendar file, manifest, feedback form (use a survey link instead), Remove My Data (Zaid removes on request).
2. Poll result moment and the word fly in (WP4 task 12).
3. Photo Wall layouts (keep the crossfade).
4. Voices of the Day on the wall (keep collecting takeaways on the phone and the export).
5. The constellation (keep connections on the phone, show "N connections made" as a number).
6. Finale reduced to Day in Numbers, Photos and Thank You.
7. Reactions.

Never cut: the id fix, sign in, My Day, the poll schedule, the heartbeat, the performance governor, rehearsal and wipe, the tests.

## 10. Open Items for Zaid

Nothing below is invented in the build. Each stays out or stays a draft until answered.

0. Hosting: the Netlify account is on the Free plan with 125,000 function calls a month, and a full day of 100 phones can pass that if the shared cache cannot be fixed (section 5.12). Decide whether to move to a paid plan for November as insurance, or to run the self hosted server as the main site. Also confirm what Netlify does when the Free limit is reached.
1. Print: the QR address `https://mentorship-day-live.netlify.app/` is final and can go on the day card and badges now. The tracker says print by 13 November. Suggested line for the card: "Scan, find your name, confirm with the last 4 digits of your mobile number."
2. Answered 12 November: for now everyone in the response sheet is accepted. Say if that changes before the import on Tuesday morning.
3. Answered 12 November: free choice, with a session picked for each person by advisor, topic and time. The topic to session table in section 5.11 is my draft of that. Please approve or correct it.
4. Answered 12 November: poll questions and the four poll times are approved.
5. Networking tags, and these suggestions from registration topics: Business development and international sales to Clients; AI adoption and applied AI to AI and Tech; Fundraising, finance, and scaling a company to Funding; Product management and strategy to Product; Career growth and remote work to Mentoring; Engineering leadership and architecture to no suggestion.
6. Wording check against the Mercy Corps safeguarding policy for three consents: hello on the wall, connections on the wall, takeaways with a first name.
7. Team PIN: at least 8 characters with letters, since the remote can now import people and wipe data. Do not change it after the import.
8. Alerts: do you want them in a team Telegram chat? Needs a bot and the chat.
9. Feedback: the built in three questions, or an official survey link?
10. How long the site stays up after the event, and who exports and wipes.
11. Still open from before: opening videos, speaker titles for Rand Safi and Alaa Alaaedein, Alan's title, the This Way directions, the wall signal and resolution from Rose.
12. The tracker's One to ones tab lists Brandon as to confirm for Small Room 2, and Rajai's time as to confirm. The wall hides unconfirmed advisors. Say if either changes.
13. Most people who registered asked for Arabic or either language for sessions. The interface stays English as decided. Worth a second look for the participant app later.

## 11. Not in This Version

* Arabic interface.
* Booking seats or one to one slots from the phone. Stars are intentions, not bookings.
* Screens in the session rooms.
* Sound on the wall, apart from the videos.
* Questions with upvotes.
* Push notifications and offline install.
* Checking photos by machine. People approve photos.
* Writing anything back to the tracker or the response sheet.
