# Day of Runbook

For Mentorship Day, Tuesday 17 November 2026, version 2. Version 2 is not deployed at the time of writing: until it is, the live address still serves version 1, and parts of this runbook (Status, People, sign in) will not match what you see.

| Page | Address | Who |
| --- | --- | --- |
| Wall | https://mentorship-day-live.netlify.app/screen/ | The wall in the Main Hall |
| Remote | https://mentorship-day-live.netlify.app/remote/ | The team, with the team PIN |
| Phone page | https://mentorship-day-live.netlify.app/ | Attendees, from the QR code |

The floor team needs only `docs/TEAM-CARD.md`.

## 1. Wall Setup With a Laptop

One laptop drives the wall. The wall is its second display; the laptop's own screen keeps the remote.

1. Plug the laptop into power. Connect it to the wall with HDMI.
2. In the display settings of the laptop, choose extend, not mirror (on Windows: Windows key and P, then Extend). The wall must be its own display, so the remote never shows on it.
3. Open a Chrome window with the wall address, drag it onto the wall display, and make it full screen: press F inside the page, or F11.
4. Click once anywhere on the wall window. Chrome lets a video play with sound only after a click on the page. Without that click the wall plays the video muted and shows "Click the screen once so videos can play with sound". The other way: close every Chrome window, then start Chrome with `--autoplay-policy=no-user-gesture-required` (the flag only counts when Chrome starts fresh).
5. Open a second Chrome window on the laptop's own screen with the remote. Type your name and the team PIN. This is the window for the team member in charge.
6. Move the mouse pointer back to the laptop screen. On the wall it hides by itself after 3 seconds without a move.
7. On the laptop, turn off sleep, the screen saver, turning the display off, notifications (do not disturb), and automatic updates. Keep it on power all day.
8. Never minimize the wall window. The page keeps the screen awake only while it is visible.
9. Run the screen check (below), then go back to the live screen.
10. If the circle in the screen check looks like an oval, the wall is stretching the laptop's picture. Open `/screen/fit.html?shape=2&quiet` in place of `/screen/?quiet`: it lays the wall out 2 wide to 1 high and squeezes it into the laptop's picture, so the wall's stretch puts it back in proportion. Change the number if the wall has another shape (width divided by height).

Keyboard keys reach the wall only while its window has focus. After you use the remote, click once on the wall window before you press a key. Keys change only this wall page, not the server; a mode or scene chosen later in the remote replaces a key hold.

### Keys on the Wall

| Key | What it does |
| --- | --- |
| F | Full screen on or off |
| H or ? | Show or hide the list of keys |
| 0 | Automatic, follows the clock |
| 1 to 7 | Hold Welcome, Opening, Videos, Coffee Break, Sessions, Lunch, Thank You |
| Left, Right | Previous or next opening speaker |
| N | Next scene now |
| T | Light or dark |
| A | Type an announcement in a box on the wall itself (use the remote instead) |
| C | Clear the announcement |
| L | Logo screen on or off |
| B | Black screen on or off |
| K | Screen check on or off |
| V | Stop a playing video |
| D | Demo data on or off. Demo data shows made up numbers and the band says "Demo data". Never leave it on |

### Screen Check

From the remote: Screen tab, Screen box, Screen check. Or press K on the wall. It shows:

* a red frame and blue corners that must sit exactly on the edges of the wall
* the size in browser pixels and device pixels, the shape, and the layout (one column, 2 or 3 columns, or ultra wide with a side panel)
* the frame rate, and whether lite mode is on and why
* the smallest text the wall uses, to read from the back of the hall

Then tap Live screen in the remote, or press K again.

Lite mode: when an average frame takes over 22 ms for 3 seconds, the wall switches to lite mode for the rest of the session (glass becomes a solid fill, no blur, half the background nodes, fewer effects). The background keeps moving. It switches back only after a reload. The remote's Status tab shows the frame rate and lite state too, in the Speed row (it says "light mode").

### Wall Address Options

Add them to the wall address, for example `/screen/?quiet` or `/screen/?quiet&lite=1`.

| Option | What it does |
| --- | --- |
| `quiet` | No "Press F for full screen and H for controls" hint after loading. Use it on the day |
| `lite=1` | Lite mode from the start |
| `lite=0` | Never switch to lite mode |
| `theme=dark` or `theme=light` | That theme, and it wins over the remote until someone presses T. Leave it out on the day so the remote decides |
| `offline` | Do not read the Screen Feed sheet; use the built in schedule |
| `v=a` or `v=b` | One of the two Welcome looks |
| `t=HH:MM` or `t=HH:MM:SS` | Pretend it is that time. For tests only |
| `speed=N` | Run the clock N times faster. For tests only |
| `mode=<mode>` | Hold a mode: `welcome`, `opening`, `video`, `choose`, `live`, `lunch`, `close` |
| `scene=<id>` | Hold one scene, see the scene ids in `CLAUDE.md` |
| `demo` | Start with demo data on. Never on the day |

The QR code on the wall is made from the wall's own address. Opened as `localhost`, the wall uses the Netlify address for its QR code instead.

## 2. Monday 16 November, On Site

1. Set up the wall laptop as in section 1. Screen check from the remote: frame on the edges, small text readable from the back, frame rate and lite state noted.
2. Compare the clock on the wall with a phone.
3. In the remote (Status tab, Tools), run a rehearsal at 09:55, at 10:59 and at 13:59, and watch the moments, the last 10 seconds countdowns and the change to Lunch on the real wall. The remote takes the time as hours and minutes only.
4. Five real phones on the hall WiFi and two on mobile data, through the whole flow: sign in, stars, poll, reactions, Networking Board, a photo, a takeaway. Reactions and takeaways open only at their times (section 5), so do those parts inside a rehearsal.
5. Videos with sound, once Zaid has added the files.
6. Unplug the network for 2 minutes: the wall keeps running and comes back by itself.
7. The laptop fallback starts with `npm start` and serves the wall (see section 8).
8. Set the This Way directions in the remote, as seen from the wall.
9. Stop the rehearsal. Wipe Test Data. It is blocked from 08:00 to 16:00 on Tuesday, so Monday is the last chance before the event. The wipe also puts the feature switches and screen controls back to their defaults; set any you changed again.

## 3. Event Morning, Tuesday 17 November

1. 08:30: import the final people list in the remote's People tab (below). Check the count.
2. Status tab: the wall is Online, "Running by itself" reads sensibly, no rehearsal banner, and no "Held by you" box unless you want something held.
3. One real sign in on a phone, and one hello on the wall.
4. Share the remote link and the PIN with the team. Give registration the team card (`docs/TEAM-CARD.md`).

A rehearsal cannot start on 17 November, and one left over from Monday does not apply on that day.

### Importing the People List

1. Download the registration response sheet as CSV, or select its rows and copy them, header row first.
2. Remote, People tab, Import People: choose the file, or paste the rows.
3. Read the preview: how many people are ready, how many rows were skipped and why (empty, no name, fewer than 4 digits in the mobile number, a Status column that says not accepted, an older row with the same number), and how many people have no known topic.
4. Tap Send, then confirm.

Columns are found by their header text: full name, mobile number, company, job title, LinkedIn, which topics, which advisors, photo consent, and when present status, block 1 to 3 room, and one to one slot. The newest row per mobile number wins. Email addresses and full numbers never leave the browser: only the name, company, job title, LinkedIn, topics, advisor preference, photo consent, room and slot columns and the last 4 digits are sent.

Each import replaces the whole list on the server. To add someone, add the row to the sheet and import the whole sheet again. Do not change the team PIN after the import: person ids are made with it, so a new PIN needs a new import.

## 4. The Remote, Tab by Tab

Open the remote, type your name (the log shows who did what) and the team PIN. It updates every 8 seconds while the page is open; Refresh updates it now. During a rehearsal a blue banner on every tab shows the rehearsal time, with Stop. Small numbers on the tabs show what waits: Status (things that need you), People (people locked out), Approve (items waiting). Actions that change a lot say what will happen and ask you to confirm or cancel first.

### Status

* The top box says "All good", or lists what needs you, each with a button: the wall has not reported (during the day, after 150 seconds), the wall reported an error, photos, cards or takeaways waiting, people locked out, and 10 or more wrong PIN tries lately.
* Held by you: anything that does not follow the clock (a mode, a scene, an overlay, a speaker card, the poll, reactions, the finale, the group photo countdown), each with a button to release it, and any feature switch that differs from its default.
* The Wall: Online or not (Online means a heartbeat in the last 150 seconds), what it shows, its size and layout, frame rate and lite state, and its last error.
* Running by itself: the clock, the program now and next, when the poll changes, when reactions open or close, which takeaway windows are open.
* Counts: Here, Signed in, Cards, Connections, Photos, Takeaways, Answers, Reactions.
* Waiting for you, with Review and Unlock buttons.
* Announce: one tap, 30 seconds on the wall: "Sessions start in 5 minutes", "Lunch is served in the Main Hall", "Group photo in the Main Hall now", "One to one slots are open at the registration desk".
* Tools:
  * Rehearsal: choose a start time (or tap 09:25 Doors, 10:00 Opening, 10:55 5 minute call, 11:40 Takeaways, 14:00 Lunch), then Start rehearsal. It moves the clock of the wall and every phone to that time on 17 November for 2 hours. Stop rehearsal goes back to real time.
  * Reload the Wall restarts the wall page within seconds (it waits until a video or a moment ends). Repair Lists rebuilds the photo, card and takeaway lists from storage.
  * Feature switches: Verified cards go up at once, Verified takeaways go up at once, Verified photos skip the queue, Say hello on the wall, Pick sessions for people, Meet codes, Takeaways.
  * Wipe Test Data: type RESET MD26 to unlock the button. See section 9.

### People

* Import People, as in section 3.
* Locked Out: each locked person with their wrong tries, and Unlock. Unlock lets them try their last 4 digits again and clears the limit of 3 phones per person. Check their name first.
* Who Signed In: everyone who signed in, as a person or a Guest, with Here once seen on the day, and a name search.

### Screen

* What the screen shows: Automatic, or hold Welcome, Opening, Video Messages, Coffee Break, Lounge and Sessions, Lunch, Thank You.
* Hold one scene: Rooms now, Next Up, One to Ones, Networking Board, Photo Wall, Live Poll, Live Numbers, This Way, Advisor Spotlight, Today's Advisors. Rotate scenes lets go.
* Reactions: Auto (follows the clock), On, Off. This opens or closes the reaction buttons on the phones.
* Group photo: "Group photo in 60 seconds" starts a countdown that takes the whole wall, then holds "Smile" for a moment. "Stop countdown" ends it. The Lunch finale controls are hidden, because the wall has no finale loop yet (section 6).
* Opening speakers: Previous, By the clock, Next.
* Videos: Play Tareq Azza, Play KassimLegal, Stop video. A video plays full screen and returns by itself.
* Announcement: up to 140 characters, shown for 15 seconds, 30 seconds or 1 minute. Send or Clear.
* Screen: Live screen, Black, Logos, Screen check. Light or Dark.
* This Way directions: an arrow for Registration, Rooms A, B and C, and One to Ones, as seen from the wall. Save directions. The This Way scene and the arrows in the 5 minute calls show only once directions are set.
* Survey link: a full https address, shown on the phone's page after the event.
* Reset screen controls: mode, scene, speaker, video, announcement, overlay and theme go back to automatic. Polls, directions, hidden words and switches stay.

### Approve

* Photos waiting, Profiles waiting, Takeaways waiting: Approve or Decline each.
* Add team photos: choose several, an optional caption for all, then Add to the photo wall. They go up at once.
* Trust switches: the three "who skips the queue" switches.
* On the photo wall, Takeaways on the wall, On the Networking Board: Remove takes anything down.

### Polls

* The top box says "Follows the schedule" (with Hold this poll) or "Held by you" (with Back to the schedule).
* Current poll: the question, open or closed, the answer count, and each word. Tap a word to hide it from the wall; tap again to bring it back. Close poll or Open again, and Clear answers.
* All polls: Open puts one on the wall and every phone and holds it.
* Add a poll: a question, answered with words (word cloud) or choices (bars).

Opening or closing a poll here holds it. Nothing changes by the clock again until someone taps Back to the schedule.

### Export

One button per CSV file: Takeaways, Ratings, Poll Answers, Networking Board, Connections, Feedback, Sign Ins. The files hold names. Keep them with the team.

### Log

Who did what in the remote, and when, newest first.

## 5. What Runs by Itself

The server decides by the clock each time a phone, the wall or the remote asks. A rehearsal moves all of it.

| What | When |
| --- | --- |
| Phase | Before the day until 09:00 on 17 November, the day from 09:00, after the event from 15:00 |
| Wall mode | Welcome until 10:00, Opening 10:00, Video Messages 10:30, Coffee Break 10:40, Lounge and Sessions 11:00 to 14:00, Lunch 14:00, Thank You from 15:00 |
| Polls | 09:00 "What brought you here today?" (choices), 10:40 "In one word, what do you need most to grow?", 12:00 "In one word, how is your day going?", 13:40 "In one word, what will you do differently after today?". Closed after 15:00 |
| Reactions on phones | 10:00 to 10:40 and 14:00 to 15:00 |
| Takeaway windows | Block 1 from 11:40 to 12:20, block 2 from 12:40 to 13:20, block 3 from 13:40 to 15:00 |
| Moments on the wall | 09:55 call for the Opening, last 10 seconds before 10:00, Starting Now. 10:40 coffee break. 10:55, 11:55 and 12:55 calls with the rooms (and arrows once directions are set), last 10 seconds, Starting Now. 14:00 lunch |
| Wall scenes | From 10 minutes before a block the big slot shows Choose Your Sessions for it, during a block it shows Rooms. A new photo, a burst of poll answers or a new connection brings its scene forward. Scenes with nothing to show are skipped |
| Hello on the wall | When someone who signed in is first seen on the day and said yes to the hello. First name only. Switch: Say hello on the wall |
| Sessions picked | On a person's first sign in, one session per block from their registration topics and advisor preference. Switch: Pick sessions for people |
| Wall heartbeat | Every 60 seconds to the Status tab |
| Wall reload | After Reload the Wall, never during a video or a moment. By itself if its main loop stops for 20 seconds |
| Screen Feed sheet | The wall reads Sessions, Slots and Stats every 60 seconds |

The Scene and Theme rows of the Screen Feed sheet hold the wall too: Scene holds a mode unless the remote holds one, and Theme wins over the remote. Leave both empty on the day.

## 6. What the Wall Does Not Do Yet

At the time of writing these parts of the plan are not built on the wall:

* the Networking Board as a constellation with connection lines (the wall shows the featured card, who is looking for what, and the names; "connections made" shows in Live Numbers)
* Voices of the Day: takeaways are collected, approved and exported, but the wall does not show them
* the Lunch Finale loop: at 14:00 the wall shows Lunch as in version 1, and the finale controls are hidden in the remote. The group photo countdown does work
* the poll word flying in from the QR code, and the moment with the top answers when the poll changes
* the garden that grows with the day (the timeline flowers are the program, as in version 1)

## 7. Moderation and Approvals

| Content | How it reaches the wall |
| --- | --- |
| Poll words | At once, through the word filter. Hide a word in the Polls tab |
| Card of a person from the list | At once while "Verified cards go up at once" is on (default on) |
| Card of a guest | Waits in the Approve tab |
| Takeaway of a person from the list | Approved at once through the filter while "Verified takeaways go up at once" is on (default on) |
| Takeaway of a guest | Waits in the Approve tab |
| Photo from an attendee | Waits in the Approve tab. "Verified photos skip the queue" (default off) lets people from the list who agreed to photos skip it |
| Photo from the team | At once, from Add team photos |

Check the Status tab every few minutes; the Approve tab shows a number when something waits. Decline anything off topic. Remove anything already on the wall from the lists at the bottom of the Approve tab. If alerts are set up (a team Telegram chat), they say when photos, cards or takeaways wait.

## 8. If Something Goes Wrong

| Problem | What to do |
| --- | --- |
| Someone cannot find their name | Type at least 3 letters of the first or last name as registered. Not on the list: "I am not on the list" on the phone, then continue as a guest. To add them for real, add the row to the sheet and import the whole sheet again |
| Someone is locked out of sign in | The phone says "Too many tries. Ask the team at the registration desk." It happens after 5 wrong tries on one phone, or 10 on all phones together. Remote, People tab, Locked Out: check the name, tap Unlock. They try again |
| "This name is signed in on 3 phones already" | Unlock in the People tab also clears the 3 phone limit |
| Someone does not know which number they registered with | The remote never shows numbers. They continue as a guest |
| The wall is offline in the Status tab | Look at the wall. If it is frozen or blank, click the wall window, reload it (F5), and press F. Check the laptop's internet. The wall also reloads itself when it stops for 20 seconds |
| Internet drops | The wall keeps running on the last data it received and the built in schedule, and the band says "Offline, saved data". It comes back by itself. Phones show "You are offline." and send what waits when they are back |
| The remote does not respond | Use the keys on the wall laptop (section 1). Click the wall window first |
| A video has no sound | Click once on the wall window, then play it again from the remote |
| "This video file is not on the screen yet" | The video file is not in the site. It closes by itself after 5 seconds |
| The wall looks wrong after a change | Reload the Wall in the Status tab Tools, or reload the wall window on the laptop. It picks up the current state at once |
| The wall stays on a mode or theme | Look at Held by you in the Status tab. Press 0 on the wall to drop a key hold. Check the Scene and Theme rows of the Screen Feed sheet. A `theme=` in the wall address wins until T is pressed |
| The band says "Demo data" | Someone pressed D on the wall. Click the wall window and press D |
| The wall is slow or jerky | Screen check: lite mode should be on. If not, open the wall with `?quiet&lite=1` |
| Something should not be on the wall | Approve tab, Remove. A poll word: tap it in the Polls tab |
| The Netlify site is down | The laptop fallback, below |

### Laptop Fallback

A laptop at the venue can serve the wall, the remote and the API itself. Prepare it on Monday: Node 20 or newer, a copy of the repo, and `npm ci` run once while there is internet.

1. In the repo folder: `REMOTE_PIN=<the team PIN> npm start` (macOS or Linux; the script uses shell syntax). On Windows, in PowerShell: `$env:REMOTE_PIN="<the team PIN>"; $env:LOCAL_CDN="1"; node server/index.mjs`.
2. It listens on port 8080 and keeps its data in the `data` folder. Wall: http://localhost:8080/screen/, remote: http://localhost:8080/remote/.
3. It starts empty: no people list, photos or answers from the Netlify site. The wall runs from the built in schedule. For sign in on the laptop, import the people list in its remote.
4. Phones reach it only on the same network, at the laptop's network address and port 8080. The printed QR code still points to the Netlify address. The wall's own QR code points to the laptop when the wall is opened by that network address, and to the Netlify address when opened as localhost.

## 9. After the Event

From 15:00 the phones show Keepsake, People and Photos: the day in numbers, their takeaways, a feedback form or the survey link, and their connections. Uploads, polls and reactions close. "Remove my data" on the phone deletes a person's card, connections, stars, takeaway text and name.

1. Set the survey link in the Screen tab if there is an official survey.
2. Export tab: download all seven files. They hold names; keep them with the team.
3. Wipe Test Data works again from 16:00 on 17 November. It deletes sign ins, cards, photos, poll answers, takeaways, connections, reactions and the log, and keeps the people list, the polls and the This Way directions. It also puts every switch and screen control back to its default.
4. No button removes the people list. Deleting it needs someone with access to the Netlify project (the `people` key in the `md26` Blobs store), or, on the self hosted server, its `data` folder.

How long the site stays up after the event, and who exports and wipes, is still open with Zaid.
