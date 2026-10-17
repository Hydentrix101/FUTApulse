# FUTApulse Phase 2 — MongoDB Atlas cutover

This is an overlay patch for the backend files in the supplied source bundle. It does not include the React client or `node_modules`.

## What changed

- Kept the existing Mongoose models and connection startup; the API verifies indexes before listening.
- Completed MongoDB-backed RSVP, flame/hype, and reminder writes using `engagement_actions`, whose compound unique index makes repeated actions idempotent.
- Fixed `GET /api/events` to read through the repository layer (the previous version referenced an undefined `storedEvents` variable and always read the local JSON file).
- Prevented the process from silently switching to stale local JSON after a successful MongoDB connection is lost. In development, a *first* failed connection may still start local JSON mode; check `/api/health` to confirm which backend is active.
- Account deletion now removes that user's engagement actions as well as their owned events, reports, and event actions.
- Hardened the allowlisted migration planner against missing IDs and empty owner/event IDs.
- Added a dry-run/apply migration command and Node built-in tests for the migration filter.
- Kept production startup gated behind an explicit cutover acknowledgment. Do not enable it until after migration and smoke tests.

## Atlas setup and migration

1. In Atlas, create a database user with access only to the FUTApulse database. Add the server's outbound IP to Network Access; avoid `0.0.0.0/0` for production.
2. Copy `.env.example` to `.env`. Set a development/staging `MONGO_URI` and a strong `JWT_SECRET`. Percent-encode special characters in the database username/password. Never commit or share `.env`.
3. Install backend dependencies with `npm install`.
4. Run `npm test` and `node --check server.js`.
5. Run the migration preview: `npm run migrate:local`. It reads `data/futapulse.json`, reports counts for the approved accounts/events/reports, and does not write to MongoDB.
6. Inspect the counts and source file carefully. If correct, run `npm run migrate:local -- --apply`. The script leaves the local JSON untouched and uses upserts, so reruns do not duplicate migrated records. Keep a backup of the local JSON before applying.
7. Start the API with `npm run dev`, then check `GET /api/health`. Confirm it reports `"database":"mongodb"` and `"databaseConnected":true`—not `local-fallback`.
8. Smoke-test sign-in, event list/create/edit/delete, RSVP, flame/hype, reminders, reports, and admin review against the staging Atlas database. Verify records in Atlas and confirm that restarting the API preserves them.
9. Only after those checks, set `FUTAPULSE_MONGO_CUTOVER_COMPLETE=true` in the production environment and deploy. Production refuses to start without `MONGO_URI` and this acknowledgment.

## Migration scope

The existing planner intentionally migrates only the approved accounts in `server/dataMigration.js`, their owned events, and reports for those events. Engagement actions are remapped to the migrated MongoDB user IDs. Review that allowlist and the dry-run summary before applying. Email challenges are temporary and are not migrated.

## Current validation

The supplied source has been syntax-checked; the migration planner tests pass. No Atlas credentials were provided, so a real Atlas connection, index creation, and API smoke test have **not** been run. Keep the production gate disabled until those checks are completed.
