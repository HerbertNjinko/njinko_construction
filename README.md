# Njinko Construction Deal App

Database-backed investor dashboard and sponsor-side deal calculator for:

- investor returns by deal
- sponsor promote IRR trigger visibility
- contractor deferred compensation tracked as Class C participation
- manager-side user creation, deal allocation, and project updates

## Run locally

```bash
npm start
```

The app runs on `http://localhost:3000`.

## Demo logins

- Manager: `manager@njinko.dev` / `njinko-admin`
- Investor: `sarah@bluecrest.dev` / `investor-sarah`
- Investor: `david@bluecrest.dev` / `investor-david`
- Contractor participant: `john@solidset.dev` / `contractor-john`

## What is included

- Cookie-based login with per-user dashboard access
- SQLite persistence in `data/deal_app.db`
- Personal investor portfolio totals and per-project breakdowns
- Limited project summary for investors without exposing the full cap table
- Sponsor calculator to plug in sale price, hold months, and pref rate
- Contractor tracking table for deferred compensation and Class C participation
- Manager admin console to:
  - add investor and contractor users
  - add deal allocations / Class C participation
  - update project records and save changes to the database

## Database

- Schema file: [`data/schema.sql`](/home/herbertabingwa/njinko_construction/data/schema.sql)
- Database file created at runtime: `data/deal_app.db`

### Core tables

- `participants`: investors, contractors, sponsor entities
- `users`: login credentials tied one-to-one to participants
- `deals`: project-level financial and status fields
- `promote_tiers`: promote hurdle structure per deal
- `deal_timeline_items`: visible milestone timeline per deal
- `positions`: Class A / Class C capital participation by deal and participant
- `contractor_participation`: deferred labor tracking for contractor participants

## Notes

- Seed data lives in [`src/data.js`](/home/herbertabingwa/njinko_construction/src/data.js) and loads on first database initialization.
- Database access is implemented in [`src/database.js`](/home/herbertabingwa/njinko_construction/src/database.js).
- The app uses Node's built-in HTTP server and the `better-sqlite3` package for SQLite compatibility with Node 18+.
- This is still a prototype, not production-grade auth, authorization, or accounting infrastructure.
