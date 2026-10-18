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

For local development, copy the root `.env.example` to `.env` and put the Google OAuth client ID and client secret in that root file. Keep the secret server-side; never put `GOOGLE_CLIENT_SECRET` in the client app or share it in chat. Google sign-in uses Google's Identity Services authorization-code popup. The browser receives the authorization code and the backend exchanges it using the server-only client secret. The popup code exchange uses the requesting frontend origin as `GOOGLE_REDIRECT_URI`, so use `http://localhost:5173` locally and set the deployed frontend's exact HTTPS origin in the production server environment. Add each frontend origin to the Google OAuth client's Authorized JavaScript origins. The popup flow does not use an Authorized redirect URI.

Event posting is open to every signed-in student with a completed profile. Event banners are optional. The first completed sign-in displays the community guidelines; acceptance is stored on the account and the guidelines remain available from Profile options. A duplicate check compares title, category, venue, start and end times, and description. Exact matches are blocked and shown with the existing event; close matches are presented for review before the user confirms a distinct event.

Each signed-in account can report an event once per review cycle. Five unique reports send a review email to `FUTAPULSE_ADMIN_EMAIL`; reaching the threshold does not automatically remove the event or penalize its owner. Only that verified developer account can open Reported event review and choose to pause the event owner's posting access for seven days or ignore the reports. Email alerts use the same SMTP configuration as account verification and password recovery. Set `FRONTEND_URL` to the hosted app origin so review emails link to the correct event after deployment.

MongoDB is optional in development only when `MONGO_URI` is not set; in that case users (including their account-scoped profiles) and events use the local `data/futapulse.json` fallback. If `MONGO_URI` is configured but MongoDB cannot connect, the API now stops instead of silently writing to a separate local database. Demo events are tagged with `isDemo`; new user profiles are stored on their authenticated account, not in shared demo/test profile state. Google sign-in requires valid OAuth client ID and secret configuration in all environments; without these values the endpoint fails closed. Set `FUTAPULSE_DATA_FILE` to isolate local data, for example when running tests. Production requires a strong `JWT_SECRET`.

Email signup requires a real inbox that can receive the verification code. Configure `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, and `SMTP_PASS` (and optionally `SMTP_SECURE` and `MAIL_FROM`) before testing signup or password recovery; an email-shaped string alone is not proof that the address exists. Remember Me stores the signed token in local storage; without it, the token stays in session storage. In non-production mode, the recovery endpoint returns its token directly so the full reset flow can be tested. Production never returns the token, and email delivery must be configured before production password recovery can be used.

## API foundation

- `GET /api/health`
- `GET /api/events?level=200`
- `POST /api/events`
- `PATCH /api/events/:id`
- `POST /api/profiles`
- `GET /api/profiles/:id`

Without `MONGO_URI`, development API data is stored locally in `data/futapulse.json`. If a configured MongoDB connection is unavailable, the API exits rather than splitting data across Atlas and local storage.

Signed-in students with a completed profile may publish campus events without a banner. Exact duplicates (title, venue, category, start time, end time, and event activity) are blocked; close matches are shown so the author can inspect them before confirming that the event is distinct. An edited event is excluded from its own comparison. Event edits are restricted to the account that created the event; legacy events without verified ownership remain read-only.

Draft events are not included in public event or trending feeds. Authenticated event-list requests may retrieve only the requesting user's own drafts.
