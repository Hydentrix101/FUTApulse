# Phase 3 staging/mobile workflow check

This Playwright flow exercises signup with email verification, profile setup, remembered sign-in, mobile date entry, event publishing, event discovery, and attendance synchronization between two independent Android-sized browser contexts. It creates a temporary account and event, then deletes the account through the authenticated account-deletion API.

**Never point this test at production.** It writes data and sends a real signup verification email. The runner rejects the known production Vercel and Render hosts, requires the target hostname to be explicitly allowlisted, requires an isolated-database attestation, and checks that `/api/ready` reports a ready MongoDB service. The staging frontend's `/api` route must point to the staging API, and that API must use a separate MongoDB database from production. These checks cannot prove database isolation; the operator must verify the staging Render/Vercel routing and database configuration before setting the allowlist and confirmation variables. Never add a production hostname to the allowlist.

## Configure staging

1. Deploy a staging frontend and API. Configure the staging frontend's `/api` proxy to reach the staging API; do not reuse the production rewrite target.
2. Give the staging API a separate `MONGO_URI` database and its own staging environment values. Keep production credentials and database data out of staging.
3. Configure staging email delivery so verification mail reaches a dedicated QA mailbox. Use a throwaway account and password reserved for this test.
4. Install client dependencies and Chromium:

   ```powershell
   cd client
   npm install
   npx playwright install chromium
   ```

## Run on Windows PowerShell

Set values in the same PowerShell window used to start the test. Do not save credentials or OTPs in source files, `.env` files, screenshots, or issue reports.

```powershell
$env:PHASE3_STAGING_URL = "https://your-staging-frontend.example"
$env:PHASE3_STAGING_ALLOWED_HOSTS = "your-staging-frontend.example"
$env:PHASE3_STAGING_DATABASE_ISOLATED = "true"
$env:PHASE3_STAGING_CONFIRMATION = "I_CONFIRM_THIS_IS_ISOLATED_STAGING"
$env:PHASE3_TEST_EMAIL = "your-dedicated-qa-mailbox@example.com"

$securePassword = Read-Host "Throwaway QA account password" -AsSecureString
$passwordPointer = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($securePassword)
try {
  $env:PHASE3_TEST_PASSWORD = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($passwordPointer)
} finally {
  [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($passwordPointer)
}

npm run phase3:e2e
```

`PHASE3_STAGING_ALLOWED_HOSTS` is a comma-separated exact hostname allowlist (without scheme, path, or port); it may include `localhost` for a local staging stack. The URL hostname must match one of its entries, and the known production hostnames remain blocked even if listed.

The test prompts for the six-digit email code in the terminal. `PHASE3_VERIFICATION_CODE` is an optional one-run alternative when terminal input is unavailable; unset it immediately after use. The test has a 12-minute limit, below the verification code's 15-minute lifetime.

After the run, remove the password and any one-run code from the current shell:

```powershell
Remove-Item Env:\PHASE3_TEST_PASSWORD -ErrorAction SilentlyContinue
Remove-Item Env:\PHASE3_VERIFICATION_CODE -ErrorAction SilentlyContinue
```

## What it verifies and what remains manual

- Uses two separate Pixel 7-emulated browser contexts at a 390×844 viewport, both on the staging origin.
- Checks ready MongoDB-backed staging, signup and email verification, profile completion, remembered login, text-entry date controls (`inputmode="numeric"`), publishing, search/browse, and a server-backed attendance update visible after the other context reloads.
- Deletes the temporary QA account at the end; the API removes its owned events. If the run fails before receiving a session, any unverified challenge expires after 15 minutes. If cleanup reports an error, manually delete the temporary account and event from staging before another run.
- This is browser emulation, not a physical phone or cellular-network test. The owner has since confirmed Phase 3 production verification complete; keep this harness pointed only at isolated staging if it is used again.
