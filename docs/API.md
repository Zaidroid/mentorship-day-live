# API Contract, Version 2

This is the contract as built in WP1 and WP2 on branch `v2` and proven by `npm run test:api` (102 tests). Where it differs from `docs/PLAN.md` section 5.7, this file is right. The wall, the phone page and the remote are built against it and do not change `netlify/`.

## Common Rules

* Phone routes take the device id in the `x-dev` header (8 to 40 letters or digits). It never appears in any answer.
* Errors are `{error: "plain sentence"}` with a fitting status. Show the sentence as it is.
* JSON answers are `no-store` unless a CDN time is given below.
* Public ids: `p` plus 10 hex characters for a verified person, `g` plus 10 hex for a guest or a phone that never signed in. Takeaway ids are `t` plus 10 hex.
* Times: `t` is server time in ms, moved during a rehearsal. `ann.at`, `video.at` and the reaction windows are in the same time base.
* `cfg.reloadAt` is a version number. Reload when it differs from the value seen at load.

## Public Reads

Identical for every anonymous client. Safe to cache.

### `GET /api/state`

CDN 2 seconds, 1 second while `rx.on`.

```
{"t":1794502737962,"reh":false,"phase":"before",
 "cfg":{"mode":"auto","pin":null,"speaker":null,"theme":"light","overlay":null,"ann":null,"video":null,
   "way":{"registration":"left","rooms":"up right","oneToOnes":"right"},"reloadAt":0,"photoAt":null,"finale":null,"links":null,
   "flags":{"trustProfiles":true,"trustTakeaways":true,"trustPhotos":false,"hello":true,"picks":true,"meet":true,"takeaways":true},"at":1794502615411},
 "poll":{"id":"p1","q":"In one word, what do you need most to grow?","type":"words","options":[],"open":true,"total":19,"words":[["confidence",4],["funding",4]],"manual":true},
 "rx":{"on":false,"b":[[448625684,0,0,0],[448625683,0,0,0]],"total":0},
 "n":{"here":4,"board":13,"links":2,"photos":15,"takeaways":3,"answers":19},
 "interest":{"1B":2,"1C":1,"1A":1,"2A":2,"3B":1,"3C":1,"3A":1},
 "hello":[{"f":"Yousef","at":1794909000871},{"f":"Rana","at":1794909000651}],
 "snapV":"1794502576376.2","tags":["Funding","Clients"],"videos":[{"id":"gsg","title":"Gaza Sky Geeks Film","src":"/videos/gsg.mp4"}]}
```

* `phase` is `before`, `day` or `after`.
* `poll` is null before the first row of the poll schedule. `poll.manual` is true while the remote holds a poll.
* `cfg.photoAt` is `{at, secs}` for the group photo countdown, or null. `cfg.finale` is `{step, at}` or null. `cfg.links` is `{survey}` or null.
* `rx.b` holds the current and the previous 4 second window as `[window, clap, heart, bloom]`. Counts in a window only grow. Remember what was shown per window and animate the difference.
* `rx.total` is every reaction accepted since the last wipe, and it only grows, also across a rehearsal that moves or repeats the clock. A batch counts from the first answer after it is stored, also when its request was slow.
* A state call makes 9 storage calls, up to 11 while reactions flow, and 1 list and 1 write more when a minute is summed, about once a minute.
* `n.here` counts people first seen on the event day, not sign ins made before it.
* `interest` counts people planning to join each session, own choices and automatic picks together.
* `hello` is the newest 12 greetings, first name only, only with consent.

### `GET /api/snap?v=<snapV>`

CDN 1 hour when `v` is the current version, uncached otherwise. Fetch only when `snapV` changes.

```
{"at":1794502576376,"v":"1794502576376.2",
 "photos":[{"id":"mwdshvxy9p7826","name":"E2E Tester","caption":"Coffee break in the Main Hall","at":1794502568954}],
 "profiles":[{"id":"gd8b3ce1853","name":"E2E Tester","company":"Test Co","role":"","looking":["Funding"],"offer":["Marketing"],"linkedin":"","at":1794502570874}],
 "links":[["p125e7fe8e5","p67fea19f22",1794909001131]],
 "takeaways":[{"id":"tdf3d3301df","sid":"1B","text":"AI changes the tasks first, then the jobs.","first":"Yousef","at":1794909001297}]}
```

* `links` holds only pairs where both cards are on the board now.
* A takeaway has `first` only when the person allowed it.
* Photos are served at `/api/photo/<id>`.

### `GET /api/rx`

CDN 1 second. `{t, on, b, total}`, the same as `state.rx` plus `t`. For the wall only, and only if the plan's call budget rule 2 is chosen.

### `GET /api/ics?s=1A,3B`

A calendar file with those sessions. Without `s`, the day itself. 400 for an unknown session.

### `GET /api/cdn-probe?p=a..e&s=1..60`

For the cache experiments only. `{p, s, at}` with that policy's headers.

## Phone Routes

### `GET /api/who?q=`

Returns `{list: [{id, name}]}`, at most 5, `id` in the `p` form. Matches the start of any word in the name, Latin or Arabic.

* 400: no `x-dev`, fewer than 3 letters, or more than 60 characters.
* 429: more than 40 searches per phone per 10 minutes.

### `POST /api/claim`

Body `{id: "p...", last4: "1234", hello: true}`. `last4` is a string. Returns `{ok: true}` plus the whole `GET /api/me` body.

* 401 `{error, left}`: wrong number. `left` is the number of tries left on this phone.
* 423 `{error, left: 0}`: locked. Show the sentence, which sends the person to the registration desk.
* 409: the name is signed in on 3 phones already.
* 404: unknown id. 400: bad input.

### `POST /api/guest`

Body `{name, hello}`. Returns `{ok: true}` plus the `me` body. 400 for a name under 2 letters, 422 when the word filter refuses it.

### `POST /api/signout`

Returns `{ok}`.

### `GET /api/me`

Call it on open and after the phone's own writes. Do not poll it.

```
{"status":"person",
 "me":{"pub":"p67fea19f22","name":"Layla Khoury","first":"Layla","company":"Byte Studio","title":"Founder",
   "linkedin":"https://linkedin.com/in/sample-layla","suggest":["Clients","AI and Tech"],"rooms":{},"slot":null,"photoOk":true},
 "stars":{"1":{"sid":"1A","by":"own","why":null},"3":{"sid":"3A","by":"auto","why":"Fundraising, finance, and scaling a company"}},
 "profile":{"status":"approved","name":"Layla Khoury","company":"Byte Studio","role":"Founder","looking":["Funding","Clients"],"offer":["Product"],"linkedin":"","at":1794502562038},
 "code":656,
 "links":[{"id":"p125e7fe8e5","name":"Omar Saleh","company":"Freelance","role":"Full Stack Developer","linkedin":"","at":1794909001131}],
 "takeaways":[{"sid":"1A","rating":5,"text":"Lead with the client problem, not the product.","showName":true,"status":"approved","at":1794909001230}],
 "feedback":null}
```

* `status` is `none`, `guest` or `person`. `me` has the same shape for all three. For a phone that never signed in, `pub` is its guest id and the other fields are empty.
* `stars[block].by` is `own`, `auto` or `team`. `why` is the registration topic behind an automatic pick. It can be null on an automatic pick that came from the advisor preference alone.
* `me.slot` is `{who, s, e, room}`, or `{text}`, or null.
* `me.suggest` is the suggested "looking for" tags from registration.
* `code` is the 3 digit meet code, present only while the card is approved.
* `profile` is null without a card. `profile.status` is `approved`, `pending` or `declined`.
* On the event day this call also marks the person as here and fires their hello.

### `POST /api/star`

Body `{b: 1, sid: "1A"}`, or `sid: null` to remove. Returns `{ok, stars}`. 400 for a bad block or session. 409 when the team set that seat.

### `POST /api/react`

Body `{c: {clap, heart, bloom}}`. Returns 204.

* Each count is capped at 30.
* 409: reactions are off. 400: nothing to send.
* 429: sent less than 2.5 seconds after the last batch, or 150 batches from this phone today, or too many from everyone in one window.

### `POST /api/answer`

As in version 1: `{pid, text}` with `x-dev`. 409 unless `pid` is the poll open now.

### `POST /api/profile`

Body as in version 1: `{name, company, role, looking, offer, linkedin, consent}`. Returns `{ok, status, id}` where `status` is `approved` (a verified person, with the trust switch on) or `pending`.

### `POST /api/meet`

Body `{code}`. Returns `{ok, again, person: {id, name, company, role, linkedin}}`. `again` is true when the two were connected already.

* 400: bad code, or your own code.
* 404: nobody on the board has that code.
* 409: your own card is not on the board, or the feature is switched off.
* 429: 5 wrong codes in 10 minutes, or 60 connections.

### `POST /api/takeaway`

Body `{sid, rating, text, showName}`. `rating` is 1 to 5 and required. `text` is optional, 120 characters at most. Returns `{ok, status}` where `status` is `approved`, `pending`, or `none` when there was no text.

* 409: outside the session's window (the sentence says when it opens, or that it is closed), or the feature is switched off.
* 422: the word filter, a link, or a phone number in the text.
* 400: bad session or rating, or text over 120 characters.
* 429: more than 5 edits for one session.

The window for block b runs from 5 minutes before the session ends until 20 minutes after the block ends. Block 3 stays open until 15:00.

### `POST /api/feedback`

Body `{overall: 1..5, recommend: 0..10 or null, text}`. `text` is 300 characters at most. 409 before phase `after`.

### `POST /api/forget`

Removes the card, connections, stars, takeaway text and name. Returns `{ok}`.

### `POST /api/photo`

As in version 1, raw image body with `x-dev`, `x-name`, `x-caption`. Returns `{ok, id, status}`. With a valid `x-pin` it is a team upload: approved at once, no `x-dev` needed. A wrong `x-pin` gets 401.

## Team Routes

All need `x-pin` and `x-who`.

### `GET /api/op`

Everything version 1 returned, plus:

```
{"cfg":{"poll":{"id":"p1","open":true,"manual":true},"rx":"auto","rehearsal":null,"hidden":[],"links":null},
 "pending":{"photos":[],"profiles":[],"takeaways":[]},
 "t":1794502747182,"reh":false,"screen":null,"pinFails":0,
 "n":{"here":4,"board":13,"links":2,"photos":15,"takeaways":3,"answers":19},"rx":{"on":false,"total":0},
 "people":{"count":6,"signedIn":4,"guests":0,"here":4,"locked":[],"list":[{"id":"p67fea19f22","name":"Layla Khoury","kind":"person","here":true}]},
 "auto":{"now":"18:59","date":"2026-11-12","phase":"before",
   "poll":{"id":"p1","open":true,"manual":true,"until":null,"next":{"id":"p2","at":"09:00"}},
   "rx":{"mode":"auto","on":false,"until":null,"next":"10:00"},
   "program":{"now":null,"next":{"title":"Registration and Coffee","s":"09:30"}},"takeaways":[]}}
```

* `n` is the same object as in `/api/state`, and `rx` is `state.rx` without `b`, so the remote shows its counts without a state request.
* `screen` is the wall's last heartbeat plus `age` in seconds, or null.
* `cfg.rehearsal` is `{shift, until, hhmm, at}` or null.
* A pending takeaway is `{id, sid, text, rating, first, showName, guest, at}`.
* A locked person is `{id, name, tries, all}`.
* Pending and approved cards carry public ids.

### `POST /api/op`

Body `{action, ...}`. Returns `{ok: true}` plus extra fields for some actions. Every action is logged.

| Action | Body | Notes |
| --- | --- | --- |
| Version 1 actions | as before | `mode`, `pin`, `speaker`, `video`, `theme`, `overlay`, `ann`, `way`, photo and profile approvals, poll actions, `hideWord`, `showWord`, `reset` |
| `peopleImport` | `{people: [{name, last4, company, title, linkedin, topics, advisorPref, photoOk, rooms, slot}]}` | Returns `{count, skipped: [{row, why}], replaced}`. `topics` is an array of topic names from `MD_DAY.topicMap`. `advisorPref` is `remote`, `local` or empty. `rooms` is `{"1": "1A"}` and also accepts `"Room A"` or `"A"`. `slot` is `{who, s}` or text |
| `peopleUnlock` | `{id}` | Clears the lock and the 3 phone limit |
| `rehearsal` | `{hhmm}` or `{hhmm: null}` | Refused on the real 17 November |
| `wipe` | `{phrase: "RESET MD26"}` | Refused between 08:00 and 16:00 on the real 17 November |
| `reload` | | Raises `cfg.reloadAt` |
| `flags` | `{name, on}` | Names: `trustProfiles`, `trustTakeaways`, `trustPhotos`, `hello`, `picks`, `meet`, `takeaways` |
| `repair` | | Rebuilds the lists from storage |
| `rx` | `{mode}` | `auto`, `on` or `off` |
| `pollManual` | `{on}` | `on: false` returns to the schedule. `pollActivate` and `pollClose` hold the poll |
| `approveTakeaway`, `rejectTakeaway`, `hideTakeaway` | `{sid, id}` | |
| `groupPhoto` | `{secs}` or `{secs: null}` | 5 to 600 seconds |
| `finale` | `{step}` | `numbers`, `poll`, `photos`, `voices`, `connectors`, `thanks`, or null for the automatic loop |
| `links` | `{survey}` | An https address, or null |

Approving a missing photo or card answers 404. Approving a card that changed since the team loaded it answers 409.

### `GET /api/export/:what`

`what` is `takeaways`, `ratings`, `polls`, `board`, `links`, `feedback` or `signins`. CSV with a UTF 8 byte order mark. 401 for a wrong PIN, 404 for an unknown export.

### `POST /api/beat`

From the wall every 60 seconds: `{w, h, dpr, layout, mode, scenes, lite, fps, err, at}`, 1 KB at most. Returns 204. No PIN.

## Local Development

* `npm run dev` starts the server on port 8897 with PIN `123456`. Another port: `PORT=8891 DATA_DIR=dev/blobs-wall REMOTE_PIN=123456 node server/index.mjs`.
* `bash scripts/seed.sh http://localhost:<port>` fills it: six sample people (four signed in), answers, cards, photos, stars, two connections, three takeaways.
* The scripts read the address from the `BASE` environment variable.
* A rehearsal moves every clock: `curl -X POST <base>/api/op -H 'x-pin: 123456' -H 'x-who: Test' -H 'content-type: application/json' -d '{"action":"rehearsal","hhmm":"10:55"}'`.
* `npm run test:api` starts its own servers and needs nothing running.
* `npm start` and the Docker image set `LOCAL_CDN=1`. The self hosted server then keeps every answer that carries a CDN time for that time, at most 60 seconds, as the Netlify CDN would: state is made about once a second however many phones poll, and callers that arrive while it is made share it. Team requests (`x-pin`) and photos are never kept. `npm run dev`, the tests and a plain `node server/index.mjs` leave it off, so a write shows at once.
