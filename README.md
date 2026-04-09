# Njinko Construction Deal App

Database-backed investor dashboard and sponsor-side deal calculator for:

- investor returns by deal
- sponsor promote IRR trigger visibility
- contractor deferred compensation tracked as Class C participation
- manager-side user creation, deal allocation, and project updates

## Run locally

```bash
export PGHOST=127.0.0.1
export PGPORT=5432
export PGUSER=postgres
export PGPASSWORD='your-password'
export PGDATABASE=investors
npm run migrate
npm run seed
npm start
```

The app runs on `http://localhost:3000`.

If the database already contains data, `npm run seed` will stop instead of overwriting it. Use `npm run seed -- --force` only when you intentionally want to replace the current contents with the demo dataset.
If you see `Missing Postgres setting: PGPASSWORD`, start the app from the same shell where you exported the Postgres variables, or use `DATABASE_URL`.

## Demo logins

These accounts exist only after running `npm run seed`.

- Manager: `manager@njinko.dev` / `njinko-admin`
- Investor: `sarah@bluecrest.dev` / `investor-sarah`
- Investor: `david@bluecrest.dev` / `investor-david`
- Contractor participant: `john@solidset.dev` / `contractor-john`

## What is included

- Cookie-based login with per-user dashboard access
- Postgres persistence using the `investors` database
- Personal investor portfolio totals and per-project breakdowns
- Limited project summary for investors without exposing the full cap table
- Sponsor calculator to plug in sale price, hold months, and pref rate
- Contractor tracking table for deferred compensation and Class C participation
- Manager admin console to:
  - add investor and contractor users
  - add deal allocations / Class C participation
  - update project records and save changes to the database

## Database

- Migration files: [`migrations/001_initial_schema.sql`](/home/herbertabingwa/njinko_construction/migrations/001_initial_schema.sql)
- Reference schema snapshot: [`data/schema.sql`](/home/herbertabingwa/njinko_construction/data/schema.sql)
- Runtime connection uses `DATABASE_URL` or the standard `PGHOST` / `PGPORT` / `PGUSER` / `PGPASSWORD` / `PGDATABASE` variables
- Default local assumptions if env vars are omitted: host `127.0.0.1`, port `5432`, user `postgres`, database `investors`
- The app will not auto-create tables or seed demo data on startup. Run `npm run migrate` first, then `npm run seed` only if you want the sample dataset.

### Core tables

- `participants`: investors, contractors, sponsor entities
- `users`: login credentials tied one-to-one to participants
- `deals`: project-level financial and status fields
- `promote_tiers`: promote hurdle structure per deal
- `deal_timeline_items`: visible milestone timeline per deal
- `positions`: Class A / Class C capital participation by deal and participant
- `contractor_participation`: deferred labor tracking for contractor participants

## Notes

- Seed data lives in [`src/data.js`](/home/herbertabingwa/njinko_construction/src/data.js) and is loaded only by [`npm run seed`](#run-locally).
- Migration execution is implemented in [`src/migrations.js`](/home/herbertabingwa/njinko_construction/src/migrations.js).
- Database access is implemented in [`src/database.js`](/home/herbertabingwa/njinko_construction/src/database.js).
- The app uses Node's built-in HTTP server plus the [`pg`](https://www.npmjs.com/package/pg) driver for Postgres.
- This is still a prototype, not production-grade auth, authorization, or accounting infrastructure.
