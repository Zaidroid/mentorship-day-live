# Mentorship Day Live

The big screen, phone page and team remote for Mentorship Day 2026 at the Palestine Innovation Summit, by Gaza Sky Geeks, a program of Mercy Corps, with Palestine TechnoPark and the support of Sweden.

| Page | Path | Who uses it |
| --- | --- | --- |
| Phone page | `/` | Attendees, from the QR code: live poll, photo wall, Networking Board, agenda |
| Big screen | `/screen/` | The wall in the Main Hall |
| Team remote | `/remote/` | The GSG team, with the team PIN |

## Quick start

```
npm ci
npm run dev        # http://localhost:8897, PIN 123456, local data
npm run seed       # sample data for the local server
```

Deploy to Netlify with `npx netlify-cli deploy --prod` after linking the project, or self host with `docker compose up -d --build`. Details, data sources and open items are in `CLAUDE.md`. What the screen does is in `docs/SPEC.md`. The day of runbook is `docs/OPERATIONS.md`.
