# Njinko Construction Deal App

Read-only investor dashboard and sponsor-side deal calculator for:

- investor returns by deal
- sponsor promote IRR trigger visibility
- contractor deferred compensation tracked as Class C participation

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
- Personal investor portfolio totals and per-project breakdowns
- Limited project summary for investors without exposing the full cap table
- Sponsor calculator to plug in sale price, hold months, and pref rate
- Contractor tracking table for deferred compensation and Class C participation

## Notes

- Data is seeded in [`src/data.js`](/home/herbertabingwa/njinko_construction/src/data.js).
- The app is dependency-free and uses Node's built-in HTTP server.
- This is a prototype using seeded data, not a production auth or accounting system.
