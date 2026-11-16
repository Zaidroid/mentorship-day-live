# What the big screen does

Decisions from Zaid's interview on 12 November 2026. Everything down to "Not in this version" describes version 1. What version 2 adds is in the last section, "Version 2".

## The screen

* A 5 m by 2.5 m wall, said to be 4K, behind the stage in the Main Hall. It runs all day.
* There are no panels or speakers during the sessions. People gather around the screen for coffee and networking, mostly between 11:00 and 13:00.
* It changes mode by time of day, and the team can hold any mode or scene from the remote.
* Look: the light, cinematic Palestine Innovation Summit design. It adapts to any signal: native 2:1, 16:9 stretched or cropped, or ultra wide. A screen check view helps line up the edges on site.

## Modes by time

| Time | Mode | What shows |
| --- | --- | --- |
| 09:30 | Welcome | Title, live clock, countdown to the opening, check in counter, QR code, This Way |
| 10:00 | Opening | Speaker name cards (Zaid Salem, Rand Safi, Alaa Alaaedein), moved forward from the remote |
| 10:30 | Gaza Sky Geeks Film | One film (since 16 November, in place of the two video messages), started from the remote, full screen, returning by itself |
| 10:40 | Coffee Break | What starts at 11:00 with seats left, first poll, One to Ones |
| 11:00 to 14:00 | Lounge and Sessions | Rooms now, Next Up with seats left, One to Ones, Networking Board, Photo Wall, Live Poll, Advisor Spotlight, Live Numbers, This Way |
| 14:00 | Lunch | Best photos, Networking Board, final word cloud, thanks to the advisors |

Five minute calls before each hour, "starting now" moments and announcements break in over the loop. A ticker runs along the bottom band.

## Interaction

* One QR code opens the phone page. Attendees answer the poll, send photos, join the Networking Board and see the agenda.
* Live poll and word cloud. Words show straight away with a word filter; the team can hide any word from the remote.
* Photo wall. Attendees and the team can send photos. Nothing shows until someone approves it.
* Networking Board. Name, company, role, up to three "looking for" tags and three "can help with" tags, optional LinkedIn, with consent. Profiles show after approval. The screen shows a featured card with good people to meet, a balance of who is looking for what, and everyone on the board.
* Live data from the tracker sheet: sessions, seats booked, one to one slots, check ins.
* Team remote shared by the team with one PIN, with a log of who did what.

## Not in this version

* Questions with upvotes and live reactions: there are no speakers during the day.
* Session and one to one booking from the phone: planned for the participant app later.

## Version 2

Decided with Zaid on 12 November 2026; the plan is `docs/PLAN.md`, the API as built is `docs/API.md`. Built on branch `v2`, not deployed at the time of writing. Principles: the app mirrors the day and nothing depends on it; the server decides by the clock when it is asked; the team remote is shared and the system asks for a person only when it must. English only, with Arabic names and answers shown correctly.

### The Phone

* Sign in against the registration list: find your name, then the last 4 digits of the mobile number you registered with. A switch says hello on the big screen, first name only. People not on the list continue as guests; guests can do everything, but their card and takeaways wait for the team. After 5 wrong tries on one phone, or 10 in total, the name is locked until the team taps Unlock.
* My Day: a top card that follows the day (see you on Tuesday, the opening, the session picked for you or chosen by you, the 5 minute call, the session you are in, the takeaway, lunch), then the three blocks with one star per block, One to Ones, the agenda, and a calendar file.
* Picked for You: on a person's first sign in, the server picks one session per block from the topics and advisors they asked for at registration (`topicMap` in `day.js`). They keep it or change it. A room set by the team in the import shows as "Your seat".
* Live: the current poll and the numbers of the day, and reaction buttons while reactions are on.
* People: the Networking Board card, filled in from registration for a verified person, a 3 digit meet code with a QR code, three people to meet, "We met" to record a connection, and everyone on the board.
* Photos: upload, and the approved photos.
* Takeaways: near the end of each session, a rating of 1 to 5 and one optional line.
* After the Event, from 15:00: Keepsake (thank you, the day in numbers, my takeaways, feedback or a survey link), People with my connections, Photos. "Remove my data" deletes a person's card, connections, stars, takeaway text and name.

### The Wall

* The schedule comes from one file, `public/assets/day.js`, shared with the phone and the server. The Screen Feed sheet still overrides sessions and slots.
* Welcome counts "people are here" and greets each person who signs in, first name only, with consent. The QR block says one line that fits the moment: find your name, pick your session, meet your 3 people.
* Moments cover the stage and the rail: the 5 minute calls with the rooms of the block (and arrows once directions are set), the last 10 seconds before the Opening and each block counted in large numerals, then Starting Now.
* Choose Your Sessions and Rooms show how many people plan to join each session. Seats left show only when the tracker has bookings. A live session has a progress bar and reads "Wrapping up" in its last 5 minutes.
* A director picks what each slot shows by content and the clock: Choose Your Sessions before a block, Rooms during it, new photos, poll answers and connections brought forward, empty scenes skipped.
* It keeps itself running: a heartbeat every 60 seconds to the remote, a reload when the team asks, a watchdog, a screen wake lock, and a lite mode when frames are slow.
* Not built at the time of writing: the Networking Board constellation, Voices of the Day, the Lunch Finale, the poll word fly in and the growing garden. Reactions and the group photo countdown are on the wall.

### By the Clock

* Polls change by themselves at 09:00, 10:40, 12:00 and 13:40, unless the remote holds one.
* Reactions are on from 10:00 to 10:40 and from 14:00 to 15:00, unless the remote holds them on or off.
* Takeaway windows open 5 minutes before each session ends and close 20 minutes after its block ends; the last stays open until 15:00.
* A rehearsal from the remote moves every clock to a chosen time on 17 November for 2 hours. It cannot run on 17 November itself.

### Approvals

* Poll words go up at once through the word filter. Cards and takeaways of verified people go up at once; those of guests wait. Attendee photos wait for a person; team photos go up at once. Three trust switches change this.

### The Team Remote

* Status: what needs the team, what is held, the wall's heartbeat, what runs by itself, counts, one tap announcements, rehearsal, reload, repair, feature switches, Wipe Test Data.
* People: import the registration list from a CSV file or pasted rows, read in the browser so email addresses and full numbers never leave it; Locked Out with Unlock; who signed in.
* Screen, Approve, Polls, Export (seven CSV files) and Log.

### Not in Version 2

* An Arabic interface.
* Booking seats or one to one slots from the phone. Stars are intentions, not bookings.
* Screens in the session rooms. Sound on the wall, apart from the videos.
* Questions with upvotes. Push notifications and offline install. Checking photos by machine.
* Writing anything back to the tracker or the response sheet.
