# FUTApulse App Launch Roadmap

This roadmap is the working launch path for FUTApulse. It gives us a safe sequence while leaving room to revise, add, or remove product features before launch. A phase is complete only after its exit conditions are met; the roadmap does not freeze the product backlog.

## Product boundaries

- FUTApulse is a mobile-first app for FUTA students. The first release may be accessed through a phone browser/PWA and later distributed as an Android APK; app-store publication is not required for the initial campus rollout.
- Launch scope prioritizes reliable event discovery, account-bound event ownership, server-confirmed attendance, reminders, reporting, and basic account support.
- Ticket sales are deferred until the app is established on campus.
- Live advertising is deferred. Keep sponsored placements in mock mode until the mobile platform, provider setup, legal disclosures, and privacy review are ready.
- Feature changes remain welcome. Before a phase that depends on a feature, confirm whether that feature is still in scope and update this roadmap.

## Phase 0 - Product decisions and current-state baseline

**Purpose:** Agree on what the first campus release must do, without blocking further design changes.

- Review current Home, Explore, full event, profile, authentication, reminders, and reporting behavior with Immanuel.
- Record launch-critical features, deferred features, known bugs, and any data that must be preserved.
- The first phone delivery targets are both an installable PWA and an Android APK. Build the hosted app foundation once, then package it for Android.
- Keep Remember me checked by default, with a clear way for a user to uncheck it.

### Phase 0 findings from Immanuel

These are accepted product requirements or queued design tasks. They are not all being implemented in one change; dependencies are noted in later phases.

- **Password recovery:** Validate the reset code as soon as the complete code is entered, with clear valid/invalid/expired feedback, before allowing the final password reset. Implement with a server verification endpoint so client-only checks cannot claim a code is valid.
- **Home category inventory and sponsors:** Always render the category rows, including empty states. On Home, place a sponsored ad beneath every two category sections; an empty category counts as a section and keeps its empty state above the ad. In full event lists, place one after every three event cards; if the list has exactly one card, place it beneath that card, and place it beneath an empty state when the list has no events. Explore has no ad placements. Keep ads in clearly labeled mock mode until mobile ad support and policy setup are ready; do not promise ad delivery or revenue.
- **Seminars:** Add Seminars as an event category. When selected in event creation, show an optional meeting URL field. Show a safe, clearly labeled clickable link on the full event card, opening the destination with appropriate external-link protections.
- **Community guidelines:** The first-use and Profile-accessible guidelines should feel prominent and readable while keeping the agreed concise rules.
- **Profile photo framing:** Provide a mobile-friendly crop/position editor with a visible frame and preview, allowing users to move and zoom the image before saving. The attached screenshot is the desired interaction reference.
- **Time picker:** Remove the cyan selection box/background; indicate the selected time only through the selected number's text color and weight.
- **Venue details:** Let the organizer enter a venue and a landmark/navigation note as custom text. Do not imply Google Maps venue integration until FUTA place data and a real mapping integration are researched.
- **Organizer controls:** Let the event owner delete a saved draft or published event after a clear confirmation. A successful delete removes it from the feed and cleans up related app-side reminders and engagement state.
- **Copy cleanup:** Remove the filter-bar “Swipe” hint, unnecessary “Banners are optional” profile copy, profile-capitalization helper copy, and event-category visual-style helper copy. Change search placeholder to “Search event titles or organiser names.”
- **Connectivity:** Students should be online before entering the interactive app, and the UI must say when a server action was not completed. Enforce this after cloud hosting exists. An online gate does not guarantee an ad will be filled or produce revenue; ads remain deferred until the mobile ad setup is approved.
- **Development accounts:** Keep only `immanuelidowu1@gmail.com` and `hydentrix@gmail.com` in the development database. Before removing any other account, back up the database and check whether owned events or reports need to be preserved or reassigned.
- **Auth brand:** Use the tagline “The heartbeat of FUTA.” and make the launch, sign-in, and home-screen heart the same vivid purple color.

### Phase 0 implementation log

- Remember me is checked by default and remains user-toggleable.
- Password recovery now checks a complete six-digit code with the API as soon as it is entered; the final reset still validates the code again on the server.
- The local development fallback contains only the two requested accounts and their two event records (one published event and one draft). Orphan attendance action keys for removed test events were cleared; a pre-cleanup rollback copy is retained in `data/backups/`. The local API health request timed out at that checkpoint, so no claim is made that a separate cloud database was checked or changed.
- Search placeholder wording is updated, and the time wheel no longer paints a background behind the selected value; the selected digits alone use the accent color.
- Home keeps every current category row visible. Mock ads appear beneath every two category sections, regardless of whether each section has events or an empty state. Full lists show a mock ad after each third event, after a one-event list, or beneath an empty state. Explore has no ad placements.
- Event editor input now writes the draft to local storage immediately, flushes again on close or app page exit, and continues attempting server draft sync when available.
- The old browser event caches are invalidated once so deleted demo events cannot linger in search or organizer views; empty server event lists remain empty instead of being reseeded.
- Owner-only event deletion is available for published events and drafts in the Profile organizer list. Deletion requires confirmation and removes the event's reports, engagement keys, local reminders, and owned-event cache entry.
- Seminars is now a category throughout the feed and event editor. Its optional meeting URL is validated by the API and displayed as a safe external link on the full event card.
- The heart is vivid purple across the launch animation, sign-in screen, and home header.
- The auth tagline and vivid purple heart are consistent across launch, sign-in, and home. The requested helper copy and filter-bar swipe hint are not present in the current UI; the separate organizer Events/Drafts swipe hint is not a filter hint and remains.
- Profile photos can be moved and zoomed in a square crop frame before upload. The first-run and Profile guidelines now use the same concise, card-based presentation without exposing the internal report threshold.
- Selecting the **All** filter returns the Home feed to the top; selecting a category continues to take the user to that category.
- Event creation uses organizer-entered venue text and optional landmark/directions instead of a fixed campus venue list.

**Exit condition:** A reviewed launch checklist exists; open feature decisions are marked as decisions, not silently treated as requirements. The remaining Phase 0 product and baseline items above are now implemented or explicitly deferred until their infrastructure dependency exists.

**Phase 0 review outcome:** The product baseline is ready to close. Its infrastructure-dependent items remain explicitly assigned to later phases, and future product changes can still be added at phase boundaries without treating this baseline as a permanent feature freeze.

## Phase 1 - Local app reliability and data contract

**Purpose:** Make existing behavior predictable before changing where data is stored.

- Confirm API contracts for accounts, profiles, events, attendance/hype, reminders, reports, duplicate detection, and developer review.
- Keep account identity as the stable owner of an event so profile name and picture changes appear on older events, and account deletion can remove owned content according to the agreed policy.
- Verify event time-zone handling, the 30-minute post-end feed window, hot-event qualification, and drafts versus published events.
- Enforce the agreed online-entry requirement only once the cloud API is deployed. If connectivity drops after entry, never claim a server action succeeded without confirmation; show a clear reconnect state and retry only safe operations.
- Break up the large client app module where it reduces risk to data and notification behavior; avoid a broad rewrite just for file size.
- Create and verify a restorable backup before any migration or cleanup.
- Keep the approved mobile interaction and content decisions documented while completing local reliability work; revisit the feature scope with Immanuel at each phase boundary.

### Phase 1 kickoff checkpoint

- The current route, ownership, engagement, feed timing, reminder, and moderation contracts are recorded in [PHASE_1_DATA_CONTRACT.md](./PHASE_1_DATA_CONTRACT.md).
- The approved-owner cleanup has a fresh, parseable pre-cleanup JSON backup at `data/backups/futapulse-before-approved-owner-event-prune-2026-10-16T10-08-02-541Z.json`; the earlier backup remains unchanged.
- The API suite passes 16 tests, including owner-only draft deletion, account-owned event cleanup, authenticated attendance, account-bound hype/reminder toggles, legacy invalid-time exclusion, and the Hot endpoint applying the app-wide 30-minute event display window. The client production build and lint pass.
- Invalid-time legacy events are excluded from feeds; the local published event has valid start/end times and the other retained record is an approved account's draft. The fresh backup was copied into an isolated temporary location and parsed successfully, then the temporary copy was removed. A 360×800 mobile viewport smoke run verified sign-in, event ownership and deletion, server-confirmed attendance, and an offline attendance attempt that made no change.

**Exit condition:** The local app behavior and data contract are understood, critical edge cases are addressed, and the source data backup is recoverable.

**Phase 1 review outcome:** Complete. API regressions, lint, build, restore rehearsal, and isolated mobile viewport/network-loss checks passed. Physical Android/PWA and deployed cloud checks belong to the later deployment and packaging phases.

## Phase 2 - Cloud database and migration

**Purpose:** Move shared state from machine-local files into durable cloud storage.

- Select a managed MongoDB-compatible database and configure a separate development/staging database before production.
- Add database models and indexes for events, attendance/hype actions, reports/review decisions, reminders/device subscriptions as needed, while retaining the existing account model.
- Make event mutations and attendance idempotent per account so retries on weak mobile connections cannot create duplicate counts.
- Migrate only the event and account data Immanuel approves for preservation; do not erase the local source. Record migration counts and a rollback path.
- In production, fail clearly if cloud storage is unavailable; never silently write production records to a local JSON file.
- Add readiness/health reporting that distinguishes database connectivity from API process availability.

### Phase 2 kickoff checkpoint

- MongoDB models and indexes are defined for event records, event reports, and account-bound engagement actions. The existing User model remains the account model.
- `node scripts/migrate-local-to-mongo.js` is a read-only dry run by default. It selects only the two approved account emails and their owned events/reports; `--apply` requires `MONGO_URI`, is idempotent, remaps local owner IDs, and does not alter the local source file.
- The dry run selected 2 approved accounts, 2 owned event records, and 0 report cases, with no excluded accounts or events. A current pre-migration backup is retained at `data/backups/futapulse-phase2-pre-migration-2026-10-16T15-04-19-430Z.json`.
- `/api/health` reports database connectivity; `/api/ready` reports production readiness. Production startup is intentionally blocked until event, report, and engagement API routes have switched to MongoDB. This prevents a production API from silently persisting event state to local JSON.
- Phase 2 has since been completed on `phase-2-mongo`: Atlas connection, event/account migration path, Mongo-backed event/report/engagement operations, fallback guards, build, and API verification have been completed. This supersedes the earlier checkpoint above; do not treat the Phase 2 kickoff snapshot as current state.

**Phase 2 review outcome: Complete.** Atlas is the shared database for deployed use. The local JSON path remains available only for deliberate local development without `MONGO_URI`; when MongoDB is configured but unavailable, the API stops instead of silently splitting writes.

**Exit condition:** Met and verified on `phase-2-mongo`: two clients share server-confirmed event and attendance state through MongoDB, and production startup is guarded by the Mongo cutover flag.

## Phase 3 - Deploy the API and phone-accessible client

**Purpose:** Make the app reachable from student phones over the internet.

- **Selected hosts:** Render for the Express API at `https://futapulse.onrender.com` and Vercel for the Vite + React client. Deployment preparation is recorded; the Vercel production origin is still needed for the final OAuth/CORS allowlist.
- Deploy the Express API on Render from the repository root with `npm start`, the platform-provided `PORT`, and health check `/api/ready`. The server binds to `0.0.0.0`; keep `/api/ready` dependent on MongoDB readiness and the cutover flag.
- Deploy the Vite client on Vercel with the project Root Directory set to `client`, build command `npm run build`, and output directory `dist`. Put Vercel routing configuration in `client/vercel.json` because `client/` is the Vercel project root.
- **Use a same-origin API proxy for production cookies.** `client/vercel.json` rewrites `/api/:path*` to `https://futapulse.onrender.com/api/:path*`. This keeps the browser request URL on the Vercel origin while Vercel forwards it to Render.
- In Vercel Production (and Preview only when preview deployments are intentionally supported), leave `VITE_API_BASE_URL` unset or set it to an empty value. The client then sends `/api/...` requests to its own origin, through the rewrite. Do **not** set this variable to the unrelated `*.onrender.com` host for the browser client: that makes auth cross-site and prevents the current `SameSite=Lax` refresh cookie from being sent reliably. Keep `http://localhost:3001` only in local development. Vite variables are embedded at build time, so changes require a new deployment.
- The API uses a host-only, `HttpOnly`, `Secure` production refresh cookie with `SameSite=Lax` and path `/api/auth`. With the Vercel proxy, the browser receives it from and sends it to the Vercel origin; no cross-site cookie relaxation or cookie `Domain` override should be needed. Keep `credentials: 'include'` on client requests.
- Set Render `CORS_ORIGIN` to the exact Vercel production origin (for example, `https://<project>.vercel.app`) and, only if needed, explicitly listed Vercel preview/custom origins. Never use `*` with credentialed requests. The Vercel proxy makes normal API calls same-origin from the browser; the allowlist remains a defense-in-depth configuration for direct requests and future clients.
- For Google Identity Services popup code flow, set Render `GOOGLE_REDIRECT_URI` to the exact Vercel app origin, with no path or trailing slash, and add the same origin to the Google OAuth client's Authorized JavaScript origins. Add a custom domain origin too if students will use it. Keep `GOOGLE_CLIENT_SECRET` only in Render; the client ID may be served publicly by the API. Set Render `FRONTEND_URL` to the canonical Vercel/custom app origin so report links open the app. The OAuth popup's redirect URI must match the origin that initiated sign-in.
- Configure Render secrets only in its Environment settings: `MONGO_URI`, a unique strong `JWT_SECRET`, `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASS`, and `FUTAPULSE_MONGO_CUTOVER_COMPLETE=true`. Set non-secret server settings there too: `NODE_ENV=production`, `CORS_ORIGIN`, `FRONTEND_URL`, `GOOGLE_REDIRECT_URI`, `FUTAPULSE_ADMIN_EMAIL`, and any mail sender settings. Never put server secrets in Vercel variables, `VITE_*` variables, or committed `.env` files.
- Restrict the Atlas IP access list to the API host's outbound IP ranges or a private network path. Do not use `0.0.0.0/0` for production unless there is no alternative and the exposure is explicitly accepted.
- Add a domain when ready; verify HTTPS, account recovery, signup email, Google sign-in, event share links, and server health on real phones.
- Add basic operational visibility: error logs, database backups, uptime checks, and a simple recovery procedure.

### Phase 3 deployment values still needed

- Vercel production origin, used in Render `CORS_ORIGIN`, `FRONTEND_URL`, `GOOGLE_REDIRECT_URI`, and Google Authorized JavaScript origins.
- Optional custom app domain and any preview origins that should be allowed to sign in.

**Exit condition:** A phone on mobile data can sign in, browse, publish, and interact with events through the deployed service, with records shared across accounts/devices.

## Phase 4 - Mobile install and app packaging

**Purpose:** Choose and deliver the phone installation experience.

- If PWA is the first route, add the manifest, icons, install experience, and a service worker with a conservative cache policy. Do not cache private API responses as public app-shell data.
- If distributing an APK, add Capacitor after confirming the hosted client works; configure app identity, icons, permissions, deep links, and secure API origins.
- Keep the app usable on narrow screens, touch input, mobile keyboards, interrupted connections, and lower-bandwidth networks.
- Test install, update, sign-in persistence, event sharing/deep links, and back navigation on supported Android phones. Add iOS packaging only if it becomes a launch target.

**Exit condition:** Students can install/open the chosen mobile form, update it safely, and reach the correct event from a shared link.

## Phase 5 - Notifications and event updates

**Purpose:** Deliver reminders and important event changes through a real mobile delivery path.

- Decide notification requirements separately for event reminders, event going-live alerts, and organizer changes to time/venue.
- Select browser push for PWA, native push for Capacitor/Android, or both. Store device subscriptions/tokens on the server and let users manage them.
- Schedule reminders on the server and make delivery idempotent; local timers may supplement an open app but must not be presented as dependable background delivery.
- Send important event-change notices only when meaningful fields change; include the event deep link and changed details.
- Respect OS permission, quiet/sound settings, battery restrictions, and user preferences. A push can alert and deep-link to the full event; the OS controls whether it can play a sound or open the app automatically.

**Exit condition:** Push delivery, opt-out, token renewal, duplicate prevention, and deep-link behavior are confirmed on supported devices with the app backgrounded and closed.

## Phase 6 - Privacy, moderation, and launch readiness

**Purpose:** Prepare the service and its operators for a small campus pilot.

- Finish accurate Privacy Policy, Terms, About/Contact, data-retention and account-deletion information before enabling monetization or broad public use.
- Confirm reporting thresholds, developer-only review access, email delivery, ban/ignore behavior, and account recovery in the deployed environment.
- Define backup retention, restore steps, incident contact, and a way to pause event publishing if moderation or infrastructure fails.
- Run an invite-only FUTA pilot, collect feedback, fix high-impact mobile issues, and then expand distribution with a QR/deep-link campaign.
- Keep ads in mock mode at launch unless and until the selected native ad SDK, disclosures, consent needs, and provider review are complete. Keep ticket payments deferred.

**Exit condition:** Immanuel approves the pilot checklist, essential flows work on phones, support and rollback steps are known, and no launch-critical data/security issue remains.

## Working order

`Product baseline -> local reliability -> cloud data -> API/client deployment -> mobile install -> push notifications -> pilot and launch`

We can revisit scope at each phase boundary. A new feature request should be added to the current phase only if launch depends on it; otherwise it can remain in the post-launch backlog without holding up core reliability work.
