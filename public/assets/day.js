// The schedule of Mentorship Day 2026, written once.
// A plain script: the wall and the phone page load it with a script tag, and the
// server imports it from netlify/lib/day.mjs. It sets globalThis.MD_DAY.
// When a session, title or time changes, change it here and in the tracker.
// Times are local to the venue (Asia/Hebron), as HH:MM.
//   dayFrom      the app's day phase starts here, before the doors open
//   blocks       n, start s, end of the session e, end of the block end
//   sessions     id is the block number plus the room letter; who lists advisor keys
//   ones         one to one windows, cut into 15 minute slots by the wall
//   program      title and sub label the wall timeline; name and where are what the phone shows
//   pollPlan, reactionWindows, topicMap   drafts until Zaid approves them (docs/PLAN.md section 10)
globalThis.MD_DAY = {
  date: "2026-11-17", tz: "Asia/Hebron", dayFrom: "09:00", open: "09:30", close: "15:00",
  rooms: ["Room A", "Room B", "Room C"],
  blocks: [
    { n: 1, s: "11:00", e: "11:45", end: "12:00" },
    { n: 2, s: "12:00", e: "12:45", end: "13:00" },
    { n: 3, s: "13:00", e: "13:45", end: "14:00" }
  ],
  advisors: {
    gigi: { name: "Gigi Aulsebrook", role: "Founder and Director, Gia", photo: "/assets/p_gigi.jpg" },
    taylor: { name: "Taylor Mohylsky", role: "Growth Advisor, Founders Loft", photo: "/assets/p_taylor.jpg" },
    asem: { name: "Asem", role: "", photo: null, noPhoto: true },
    zyad: { name: "Zyad Alhasan", role: "Managing Director, Milestones Training and Consulting", photo: "/assets/p_ziad.jpg" },
    tom: { name: "Tom Sperry", role: "Managing Director, Rogue Venture Partners", photo: "/assets/p_tom.jpg" },
    adam: { name: "Adam Stoll", role: "", photo: "/assets/p_adam.jpg" },
    rania: { name: "Rania Jaber", role: "Assistant Professor, Birzeit University", photo: "/assets/p_rania.jpg" },
    rajai: { name: "Rajai Nuseibeh", role: "Managing Partner, Ather Ventures", photo: "/assets/p_rajai.jpg" },
    rand: { name: "Rand Safi", role: "Gaza Sky Geeks", photo: "/assets/p_rand.jpg" },
    alan: { name: "Alan", role: "Gaza Sky Geeks", photo: "/assets/p_alan.jpg" },
    iyas: { name: "Iyas Hisham Sabri", role: "CEO, Sabri Invest", photo: "/assets/p_iyas.jpg" }
  },
  sessions: [
    { id: "1A", b: 1, room: "Room A", title: "Pitching and Outreach to International Clients", who: ["gigi"], mode: "Online", seats: 25 },
    { id: "1B", b: 1, room: "Room B", title: "AI Impact on Technical Jobs", who: ["asem"], mode: "In person", seats: 25 },
    { id: "1C", b: 1, room: "Room C", title: "Sales Tactics for Startups and Scaleups", who: ["taylor"], mode: "Online", seats: 25 },
    { id: "2A", b: 2, room: "Room A", title: "From Vision to Execution: Turning Ideas into Results", who: ["zyad"], mode: "In person", seats: 25 },
    { id: "3A", b: 3, room: "Room A", title: "Growing Against the Odds: Building Tech Companies in Uncertain Times", who: ["tom", "adam"], mode: "Online", seats: 25 },
    { id: "3B", b: 3, room: "Room B", title: "Lead Through Communication", who: ["rania"], mode: "In person", seats: 25 },
    { id: "3C", b: 3, room: "Room C", title: "Personal Branding", who: ["rajai"], mode: "In person", seats: 25 }
  ],
  ones: [
    { who: "rand", room: "Small Room 1", s: "11:00", e: "12:00", mode: "In person", focus: "Founder and Career Conversations" },
    { who: "alan", room: "Small Room 1", s: "12:00", e: "13:00", mode: "In person", focus: "Founder and Career Conversations" },
    { who: "iyas", room: "Small Room 3", s: "13:00", e: "14:00", mode: "Online", focus: "Fundraising" }
  ],
  program: [
    { s: "09:30", e: "10:00", title: "Registration", sub: "and Coffee", mode: "welcome", where: "Registration desk", name: "Registration and Coffee" },
    { s: "10:00", e: "10:30", title: "Opening", sub: "Main Hall", mode: "opening", where: "Main Hall" },
    { s: "10:30", e: "10:40", title: "Gaza Sky Geeks Film", sub: "Main Hall", mode: "video", where: "Main Hall" },
    { s: "10:40", e: "11:00", title: "Coffee Break", sub: "Pick your sessions", mode: "choose", where: "Main Hall" },
    { s: "11:00", e: "12:00", title: "Sessions", sub: "Rooms A, B and C", mode: "live", where: "Rooms A, B and C" },
    { s: "12:00", e: "13:00", title: "Sessions", sub: "Room A", mode: "live", where: "Room A" },
    { s: "13:00", e: "14:00", title: "Sessions", sub: "Rooms A, B and C", mode: "live", where: "Rooms A, B and C" },
    { s: "14:00", e: "15:00", title: "Lunch and Networking", sub: "Main Hall", mode: "lunch", where: "Main Hall" }
  ],
  speakers: [
    { s: "10:00", name: "Zaid Salem", org: "Market Access Lead, Gaza Sky Geeks", what: "Welcome and introduction" },
    { s: "10:05", name: "Rand Safi", org: "Gaza Sky Geeks", what: "Opening remarks" },
    { s: "10:15", name: "Alaa Alaaedein", org: "Palestine TechnoPark", what: "Opening remarks" }
  ],
  videos: [
    { id: "gsg", title: "Gaza Sky Geeks Film", src: "/videos/gsg.mp4" }
  ],
  pollPlan: [
    { id: "p2", from: "09:00", to: "10:40" },
    { id: "p1", from: "10:40", to: "12:00" },
    { id: "p3", from: "12:00", to: "13:40" },
    { id: "p4", from: "13:40", to: "15:00" }
  ],
  reactionWindows: [
    { from: "10:00", to: "10:40" },
    { from: "14:00", to: "15:00" }
  ],
  topicMap: {
    "Business development and international sales": ["1A", "1C"],
    "AI adoption and applied AI": ["1B"],
    "Product management and strategy": ["2A"],
    "Fundraising, finance, and scaling a company": ["3A"],
    "Career growth and remote work": ["3C", "3B"],
    "Engineering leadership and architecture": ["3B", "1B"]
  }
};
