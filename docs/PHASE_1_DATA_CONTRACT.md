# Phase 1 - Local reliability and data contract

This document records the behavior the current local implementation promises before FUTApulse moves its shared data to cloud storage. It is an implementation baseline, not a promise that local JSON files are shared across student devices.

## Current source of truth

- The API reports `database: local-fallback` when MongoDB is not connected. Event, attendance, report, and review state is stored in the API process's local JSON data file in this mode.
- Browser storage keeps device preferences, cached event snapshots, draft-editor recovery data, and reminder scheduling data. It is not authoritative for published events or server-confirmed attendance.
- The active local JSON currently contains the two approved accounts (`immanuelidowu1@gmail.com` and `hydentrix@gmail.com`) and two event records they own: one published event and one draft. The 38 engagement-action keys left behind by removed test events have been cleared. A pre-cleanup rollback copy is retained at `data/backups/futapulse-before-approved-owner-event-prune-2026-10-16T10-08-02-541Z.json`.
- The local API health check timed out during this cleanup, so the result above verifies the workspace's local JSON fallback only. It does not verify or modify a separately hosted MongoDB/API deployment.

## API behavior contract

| Area | Current contract | Identity / persistence |
| --- | --- | --- |
| Public event feed | `GET /api/events` returns published/live events; an authenticated owner also receives their own drafts. Optional category and level filters apply server-side. | Events are associated with the account ID that created them. |
| Hot Events on Campus | `GET /api/events/hot` returns published/live events with score at least 10, ranked by score. Score is attendance × 2 + reminders × 3 + hype × 1. It follows the same app-wide event display window as every other feed. | Computed from event records in current API storage. |
| Create/edit | `POST /api/events` creates a draft or publishes a validated event. `PATCH /api/events/:eventId` is owner-only and preserves the stored owner ID. Exact duplicates are rejected; similar events require confirmation. | Name, username, faculty, and picture on old events are decorated from the current owner profile when events are loaded. |
| Delete event | `DELETE /api/events/:eventId` is owner-only, removes the event and its report/action records, and returns 404 for an already removed event. | Authenticated owner account required. |
| Delete account | `DELETE /api/auth/account` requires confirmation and password where available; owned events and their reports/action records are deleted with the account. | Account ID is the deletion key. |
| Attendance | `PATCH /api/events/:eventId/engagement` with `type: rsvp` and boolean `attending` requires sign-in. The server updates attendance idempotently by user ID and returns the updated event. The client does not show success until the server responds. | Server-confirmed in local API storage; not shared across phones until cloud deployment. |
| Hype and reminder counts | The engagement endpoint accepts `flame` and `reminder` as signed-in account toggles using `enabled: true/false`. Repeating the same requested state is idempotent; toggling off removes that account's contribution. | Aggregate counts are shared by clients connected to the same API. Viewer flags are derived from the signed-in account; private account-ID lists are never returned. Offline reminder toggles may queue locally, tagged to the originating account, and only sync when that account is signed in. Hype requires a live server response. |
| Reminder schedule | A chosen reminder time and notification preference are stored on the device. An open-app/browser alert can run locally. | Not a server schedule or reliable background push. Push delivery is Phase 5. |
| Reports | `POST /api/events/:eventId/report` requires sign-in, prevents self-reporting, and deduplicates by reporter account. Five unique reports queue a developer review email; no automatic ban occurs. | Review decision routes require the verified developer account. Email depends on SMTP configuration. |
| Health | `GET /api/health` reports process availability and whether storage is MongoDB or local fallback. | `local-fallback` means a single development machine, not a shared campus service. |

## Feed time rules

- Every published/live event with valid start/end times remains visible for exactly 30 minutes after its end in Home category rows and full lists, Explore/search, and Hot Events on Campus. Reminder and Anticipating sections remove an event as soon as its end time arrives. Server records remain stored after feed removal for ownership and reporting history.
- Event cards show days remaining while the start is more than 24 hours away, a live countdown during the final 24 hours before start, `LIVE` while the current time is inside the configured start/end range, and `ENDED` from end time until the 30-minute feed grace period expires. The 30-minute interval is intentional so the ended state can be seen before feed removal; reducing it would shorten that state for every feed.
- Event start and end values are serialized as ISO timestamps. The editor interprets the phone's local date/time input before serialization, and the UI formats timestamps in the device's locale/time zone.
- A missing or malformed end time, an invalid start time, or an end time that is not after the start makes an event ineligible for every public feed, including Hot. New published events already require a valid start and end. Legacy means records created before that validation existed: without a valid end, FUTApulse cannot know when the event ended or apply the 30-minute cutoff safely. Such records are preserved in storage but hidden from feeds; do not guess an end time or delete records automatically. An owner/admin can correct a record if an edit path is available, otherwise it needs manual review before migration.
- Drafts are excluded from public feeds and remain visible to their owner. Drafts can be kept in browser storage while offline; publishing/editing the server copy requires a successful API response.

## Verification completed at Phase 1 kickoff

- The retained backup parses and was copied into an isolated temporary location as a restore rehearsal; the temporary copy was removed afterward.
- Server tests cover event scoring, the Hot endpoint's use of the shared 30-minute retention cutoff, RSVP authentication/idempotency, account-bound hype/reminder toggles, profile propagation, owner-only draft deletion, and owned-event cleanup on account deletion. The client uses the shared `publishedEvents` selector for Home, category, Explore, and search feeds.
- A 360×800 mobile viewport smoke run confirmed sign-in, event display in its category, profile ownership, and permanent deletion against an isolated temporary API dataset. An online attendance toggle updated the server-confirmed count; an offline toggle left the count unchanged and showed a reconnect message. The Reminders screen kept the hyped-only event under Anticipating and showed zero scheduled reminders.
- `node --test tests/server.test.js`: 16 passed, 0 failed.
- `npm run build`: passed.
- `npm run lint`: passed with no errors or warnings.

## Phase 1 completion

- Invalid-time legacy records are excluded by the public-feed selector and server contract. The active local dataset has one valid published event and one approved-account draft; the prior invalid-time fixture remains covered by the API tests.
- Local JSON storage remains the source of truth in development. The local API reports `local-fallback`; cloud sharing, native push delivery, and physical Android/PWA installation are later-phase work.
- The isolated mobile smoke run and restore rehearsal are complete. Physical-device and deployed-network checks will be repeated during deployment and mobile packaging, when those targets exist.

**Phase 1 is complete.** Local data ownership, event timing, offline mutation behavior, feed visibility, and recovery expectations are documented and regression-tested. Proceed to Phase 2 cloud database and migration planning.
