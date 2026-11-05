# FUTApulse

## Run the app

Start the API from this folder:

```powershell
npm start
```

The API runs at `http://localhost:3001`. To develop the React app with Vite, open another terminal and run:

```powershell
cd client
npm run dev
```

For Express to serve the production frontend at `http://localhost:3001`, build it first:

```powershell
cd client
npm run build
```

## Search visibility and event sharing

The canonical homepage and public event share links provide crawler-readable
metadata, and `/robots.txt` plus `/sitemap.xml` are served through the API.
Only current public events are included; drafts and expired events are excluded.
See [SEO and search indexing](./docs/SEO_AND_SEARCH_INDEXING.md) for deployment
verification and Google/Bing webmaster setup. Search engines decide whether
and when to index pages or show rich previews.

## Authentication and persistence

- `POST /api/auth/signup` validates email, username, and a password with more than 6 characters, at least one uppercase letter, and at least one number; passwords are hashed with bcrypt.
- `POST /api/auth/login` validates credentials and issues the same session response.
- `POST /api/auth/google` exchanges a Google OAuth authorization code server-side, verifies the ID token, and asks new users to claim a username.
- `GET /api/auth/session` validates a remembered session token.
- `POST /api/profile/setup` saves onboarding details to the authenticated user's account and returns the updated user profile.
- `PATCH /api/auth/profile` saves the authenticated user's profile.
- `POST /api/auth/guidelines/accept` records first-sign-in acceptance of the community guidelines.
- `POST /api/events/:id/report` records one report per signed-in account; five reports send an email review request.
- `GET /api/admin/event-reports` and `POST /api/admin/event-reports/:id/decision` are restricted to the verified developer account.
- `POST /api/auth/forgot-password` issues a short-lived recovery token; `POST /api/auth/reset-password` consumes it once and invalidates existing sessions.
- `GET /api/config/google` returns the public OAuth client configuration required by the browser.

Configure the server environment before starting it:

```powershell
$env:MONGO_URI = "mongodb://127.0.0.1:27017/futapulse"
$env:JWT_SECRET = "replace-with-a-long-random-secret"
$env:GOOGLE_CLIENT_ID = "your-google-oauth-web-client-id"
$env:GOOGLE_CLIENT_SECRET = "your-google-oauth-web-client-secret"
$env:GOOGLE_REDIRECT_URI = "http://localhost:5173"
$env:FUTAPULSE_ADMIN_EMAIL = "immanuelidowu1@gmail.com"
$env:FRONTEND_URL = "http://localhost:5173"
npm start
```

For local development, copy the root `.env.example` to `.env` and put the Google OAuth client ID and client secret in that root file. Keep the secret server-side; never put `GOOGLE_CLIENT_SECRET` in the client app or share it in chat. Google sign-in uses Google's Identity Services authorization-code popup. The browser receives the authorization code and the backend exchanges it using the server-only client secret. The popup code exchange uses the requesting frontend origin as `GOOGLE_REDIRECT_URI`, so use `http://localhost:5173` locally. The canonical production origin is `https://www.futapulse.com.ng` (the apex redirects there); set `FRONTEND_URL` and `GOOGLE_REDIRECT_URI` to that exact HTTPS origin in Render, and set `CORS_ORIGIN` to `https://www.futapulse.com.ng,https://futapulse.com.ng`. Add both HTTPS origins to the Google OAuth client's Authorized JavaScript origins. The popup flow does not use an Authorized redirect URI.

Event posting is open to every signed-in student with a completed profile. Event banners are optional; organizers can add up to five compressed images, which rotate in previews and event cards. Banner images and look-back photos are stored as optimized WebP assets in Cloudinary and are never kept as inline image data in MongoDB. Configure `CLOUDINARY_CLOUD_NAME`, `CLOUDINARY_API_KEY`, and `CLOUDINARY_API_SECRET` on the API host before users upload images; if these are missing, image-bearing event saves fail with an explicit configuration error while text-only drafts and events continue to work. The health endpoint only reports whether these values are present, not whether Cloudinary accepts them. After deployment, the verified FUTApulse admin can open **Profile options → Image storage diagnostics → Verify Cloudinary credentials** to run a read-only authenticated Cloudinary ping. It reports missing variables or a safe error category without returning credential values. Draft edits are saved locally while typing and synchronized to the server when the organizer leaves a field. Look-back uploads accept JPEG, PNG, or WebP images. The first completed sign-in displays the community guidelines; acceptance is stored on the account and the guidelines remain available from Profile options. A duplicate check compares title, category, venue, start and end times, and description. Exact matches are blocked and shown with the existing event; close matches are presented for review before the user confirms a distinct event.

Each signed-in account can report an event once per review cycle. Five unique reports send a review email to `FUTAPULSE_ADMIN_EMAIL`; reaching the threshold does not automatically remove the event or penalize its owner. Only that verified developer account can open Reported event review and choose to pause the event owner's posting access for seven days or ignore the reports. Email alerts use the same Gmail API configuration as account verification and password recovery. Set `FRONTEND_URL` to `https://www.futapulse.com.ng` so report links use the canonical custom domain.

MongoDB is optional in development only when `MONGO_URI` is not set; in that case users (including their account-scoped profiles) and events use the local `data/futapulse.json` fallback. If `MONGO_URI` is configured but MongoDB cannot connect, the API now stops instead of silently writing to a separate local database. Demo events are tagged with `isDemo`; new user profiles are stored on their authenticated account, not in shared demo/test profile state. Google sign-in requires valid OAuth client ID and secret configuration in all environments; without these values the endpoint fails closed. Set `FUTAPULSE_DATA_FILE` to isolate local data, for example when running tests. Production requires a strong `JWT_SECRET`.

The API compresses eligible responses, uses a Mongoose connection pool of up to 10 connections per process, and configures Socket.IO heartbeat cleanup for stale connections. Mongo-backed feed reads select currently visible events and an owner's recent history before loading engagement data, and the hot-eligibility count is cached briefly. The notification worker atomically claims and processes batches of due jobs, so multiple worker/API instances can safely drain the shared MongoDB queue without claiming the same job. These are application-level optimizations, not an automatic cloud load balancer: scale API instances in the hosting platform. For multi-instance Socket.IO, set `SOCKET_REDIS_URL` to a shared Redis/Redis-compatible service and configure sticky sessions at the load balancer for Socket.IO polling. Without Redis, each instance's live Socket.IO broadcasts only reach its own connections, although Web Push remains independent. Event changes, reports, and recap uploads have per-account rate limits; other interactions do not currently have general account-level caps.

For Render production scaling, add the three Cloudinary variables above and, when running more than one API instance, add `SOCKET_REDIS_URL` as a Render secret/environment variable. Increase the web service instance count in Render's scaling settings and enable session affinity/sticky sessions if polling transport is enabled. Use the same `MONGO_URI`, VAPID keys, JWT secret, and cron secret across all instances. Redis is optional for a single API instance; if configured, startup fails rather than silently disabling cross-instance broadcasts when Redis is unavailable.

Signup verification, password recovery, email changes, event reports, and feedback use the Gmail REST API over HTTPS (`gmail.googleapis.com`); no SMTP transport is used. Enable Gmail API in the Google Cloud project and configure `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `GMAIL_REFRESH_TOKEN`, and `GMAIL_SENDER_EMAIL` in the backend environment. The refresh token must be authorized by the sender account with the `https://www.googleapis.com/auth/gmail.send` scope, and `GMAIL_SENDER_EMAIL` must be that account's address. Keep the refresh token and client secret on the server only.

To mint the refresh token with OAuth 2.0 Playground, add `https://developers.google.com/oauthplayground` to the web OAuth client's Authorized redirect URIs, open the Playground settings gear, enable **Use your own OAuth credentials**, and enter the same client ID and secret used by the server. Authorize only `https://www.googleapis.com/auth/gmail.send`, exchange the code, and copy the resulting refresh token into Render's `GMAIL_REFRESH_TOKEN`. Store the sender account address in `GMAIL_SENDER_EMAIL`. This sender account authorizes the backend; FUTApulse students do not each need to authorize Gmail.

For ongoing use, publish the OAuth consent screen instead of leaving an external app in Testing: Google-issued refresh tokens for Gmail scopes expire after seven days while the app remains in Testing. Google may require sensitive-scope verification before the app is broadly available. Gmail API delivery avoids Render Free's blocked SMTP ports 25, 465, and 587 and does not require a custom sender domain, but it is a low-volume launch route, not a bulk transactional-mail guarantee. Consumer Gmail accounts have a sending limit of about 500 messages per rolling 24 hours; account restrictions, OAuth revocation, and deliverability controls can still interrupt mail. The current Gmail API quota documentation says `messages.send` uses 100 units and usage below 80 million quota units per project per day is not billed; at the consumer sending limit this app would use about 50,000 units/day. Google's billing terms and limits may change, so this is not an unlimited or permanent no-cost guarantee. Provider failures are logged with sanitized status/code/message so they can be diagnosed without exposing recipient addresses or credentials.

## Background PWA notifications

The PWA's service worker (`client/public/push-sw.js`) displays Web Push notifications while the site is backgrounded or closed, and forwards them to the open app for in-app display. This is separate from CORS and Socket.IO: those support browser API/live connections, but cannot wake a closed app.

Each notification is queued once per eligible account. Socket.IO displays an actionable in-app toast for connected users; Web Push is also sent to every enabled browser subscription currently linked to that account. Push permission and the browser subscription belong to the device, not the account: when a different account signs into that browser, FUTApulse reassigns the existing subscription to the newly active account without asking for permission again. Device status is checked against that browser's subscription endpoint, not merely whether the account has any registered device. One account can have only one active sign-in session; signing into that account on another device invalidates the previous session and signs out its live app connection. The service worker forwards a push to a visible FUTApulse session only when that session is signed into the intended recipient account; otherwise it displays the operating-system notification. Notification actions deep-link to the event in the home feed. The server-side rules cover category-matched event publications, critical event changes, RSVP/custom reminders, privacy-preserving faculty/department milestones, RSVP trend spikes, organizer announcements/cancellations, and event recaps.

Background delivery requires that the recipient has enabled notifications on that browser/device. If a queued job is processed when the recipient has neither an active FUTApulse session nor an enabled Web Push subscription, it is recorded as `undeliverable` rather than reported as sent; check the worker response and Render logs when diagnosing audience delivery.

The API validates that the VAPID public key is a valid uncompressed P-256 point and that it matches the 32-byte private key. A malformed key, wrong curve, or mismatched pair disables Web Push and is reported in Render startup logs and notification setup status. If either VAPID key is rotated, each existing browser subscription must be renewed from that device's notification settings. FUTApulse compares the browser subscription's application-server key with the current public key and replaces a mismatched subscription when notifications are enabled again. Push subscriptions are restricted to the supported public Web Push services (FCM, Mozilla, and Apple); invalid or expired endpoints (HTTP 404/410) are disabled automatically. Temporary provider/network failures receive short in-dispatch exponential retries and longer queue retries, while permanent HTTP 4xx rejections fail immediately. A partial dispatch retries only devices that have not already accepted the notification.

The queue uses a unique per-recipient idempotency key and stores dispatch progress to avoid resending to devices that already accepted the notification. Browser and service-worker notification IDs are retained for deduplication. Before queueing and again before dispatch, recipients must have a verified account, have completed the app tour, and have notifications enabled for the event category. Event create/publish, critical edit, cancellation, and first recap-photo publication persist a transactional outbox entry with the event change. This requires MongoDB transactions (a replica set or sharded cluster); standalone MongoDB deployments cannot provide this guarantee and event writes with outbox intents fail explicitly. Campus-local event timestamps are interpreted and displayed as `Africa/Lagos` (WAT, UTC+1); instants are stored in UTC and explicit offsets are preserved. The worker isolates failures per job, renews leases, limits concurrency, retries with jitter, removes expired jobs, and cancels overdue reminders for events that have ended. Exhausted jobs are recorded in `notification_dead_letters`.

The backend supports separate Web Push and native FCM device adapters. For native FCM, configure `FIREBASE_SERVICE_ACCOUNT_JSON` with a Firebase service-account JSON value and optionally `FIREBASE_PROJECT_ID` (otherwise the project ID in the credentials is used). Keep this credential server-side. An authenticated native client registers a Firebase registration token with `POST /api/notifications/devices/fcm` using `{ "token": "..." }`; browser subscriptions continue to use `/api/notifications/devices/web`. The repository does not include a native Capacitor application/FCM client, so native clients must obtain and refresh their own FCM tokens and call the registration endpoint. Unregistered/mismatched FCM tokens are disabled, and FCM requests have provider-specific authentication, retry, and invalid-token handling.

Production delivery requires all of the following:

- MongoDB connected to persist the notification queue and device subscriptions.
- `WEB_PUSH_PUBLIC_KEY` and `WEB_PUSH_PRIVATE_KEY` configured on the API host; optionally set `WEB_PUSH_SUBJECT` to a valid `mailto:` or HTTPS contact.
- The user explicitly allows notifications and registers that browser/device from the FUTApulse notification settings.
- A running server-side worker. The API runs an internal due-job poller while MongoDB is connected. The scheduled GitHub Actions workflow is a backup trigger, not a guaranteed real-time scheduler; GitHub may delay scheduled jobs. It calls **`POST /api/internal/notifications/worker`** with the `x-cron-secret` header and processes up to 50 due jobs per request.
- Set `CRON_SECRET_KEY` in the Render API environment and set the same value as the GitHub Actions repository secret named `CRON_SECRET_KEY`. The endpoint returns 503 when the secret or MongoDB-backed queue is unavailable and rejects requests without the secret. Do not use `/api/ready` as a notification trigger; it is only a keep-alive check that returns a small `{ ok, timestamp }` payload and requires the `x-cron-secret` header whenever `CRON_SECRET_KEY` is configured.
- Monitor the worker response fields `oldestDueAgeMs`, `retried`, `failed`, `outboxRetried`, `outboxFailed`, and `expiredDevicesDeactivated`; completed jobs store delivery latency. Queue lag over five minutes is logged as a warning. A dead-letter can be replayed after its cause is corrected with `POST /api/internal/notifications/dead-letter/:id/replay` and the same `x-cron-secret`; replay is transactionally recorded and reuses the original notification ID.

For reliable production timing, keep the Render API/worker continuously running or move the poller to a dedicated always-on Render Background Worker. The five-minute GitHub schedule is only a recovery/fallback path and should not be used to keep a sleeping free web service alive. On iPhone/iPad, Web Push generally requires FUTApulse to be added to the Home Screen and notification permission granted; browser and operating-system settings can still suppress or delay alerts. Native FCM delivery requires a separately integrated native client; the PWA uses Web Push.

References: [Gmail API quota and billing threshold](https://developers.google.com/workspace/gmail/api/reference/quota), [Google OAuth refresh-token expiration](https://developers.google.com/identity/protocols/oauth2#expiration), and [Gmail sending limits](https://support.google.com/mail/answer/22839?hl=en).

## API foundation

- `GET /api/health`
- `GET /api/events?level=200&limit=30`
- `POST /api/events`
- `PATCH /api/events/:id`
- `POST /api/profiles`
- `GET /api/profiles/:id`

The event feed returns a cursor-paginated response (`events`, `nextCursor`, and `hasMore`). `limit` defaults to 30 and accepts values from 1 to 100; pass the opaque `nextCursor` as `cursor` to load the next page. Event responses include a `revision`. `PATCH /api/events/:id` accepts only editable event fields and requires the current `expectedRevision`; a missing revision returns 428 and a stale revision returns 409. Creation and edits use the same server-side validation rules.

Signup and login are limited to 10 attempts per IP per 15 minutes. Event creation/edits/announcements are limited to 120 requests per account per hour, event reports to 10 per account per hour, and recap-photo uploads to 10 per account per hour; unauthenticated requests are keyed by IP. Mongo-backed deployments persist counters in a TTL-cleaned collection so limits are shared across API instances. Local development uses in-memory counters.

Without `MONGO_URI`, development API data is stored locally in `data/futapulse.json`. If a configured MongoDB connection is unavailable, the API exits rather than splitting data across Atlas and local storage.

Signed-in students with a completed profile may publish campus events without a banner. Exact duplicates (title, venue, category, start time, end time, and event activity) are blocked; close matches are shown so the author can inspect them before confirming that the event is distinct. An edited event is excluded from its own comparison. Event edits are restricted to the account that created the event; legacy events without verified ownership remain read-only.

Draft events are not included in public event or trending feeds. Authenticated event-list requests may retrieve only the requesting user's own drafts.

MongoDB transaction integration coverage is opt-in. Set `FUTAPULSE_TEST_MONGO_URI` to a disposable database on a MongoDB replica set, then run `npm run test:integration`. The test verifies concurrent event edit conflicts and that publishing an event durably writes and processes its notification outbox intent. It is skipped when the variable is unset; do not point it at production data.
