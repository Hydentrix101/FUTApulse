# Production deployment smoke-test checklist

Use this read-only checklist after deploying the client and API to
`https://www.futapulse.com.ng`. It is intended for a quick check on two mobile
browsers plus one desktop browser. Do not create test accounts or events, or
perform other write actions, in production.

## Before testing

- [ ] Record the deployment date/time, commit or release identifier, and the
      Render and Vercel deployment status.
- [ ] Choose one Android device/browser (Chrome), one iPhone/iPad browser
      (Safari), and one desktop browser (Edge or Chrome). Record browser versions.
- [ ] For any authenticated check, use only a designated, pre-existing smoke
      account. Do not use a student's or administrator's account. If no smoke
      account exists, verify only the public/sign-in screens in production and
      test authenticated flows in staging.
- [ ] Confirm the device is online and open `https://www.futapulse.com.ng`.

## Domain, availability, and account screens

- [ ] The canonical `www` domain loads over HTTPS without a certificate warning.
- [ ] `https://futapulse.com.ng` and the legacy Vercel alias redirect to the
      canonical `www` domain.
- [ ] `GET https://www.futapulse.com.ng/api/health` returns HTTP 200. Review
      `databaseConnected` and the expected service configuration indicators.
- [ ] The sign-up screen loads, its fields and validation hints are visible, and
      the login screen can be opened. **Do not submit a production signup form**
      or request a verification email; test signup and email verification in
      staging.
- [ ] If a designated smoke account is available, sign in and confirm the
      expected profile loads. A sign-in can replace that account's active
      session, so never use a real user's account. Sign out when finished.

## Feed and navigation

- [ ] The event feed loads, category filters respond, and the next feed page
      loads where one is available.
- [ ] Open and close an event detail, and confirm its title, date/time, and
      venue render correctly.
- [ ] Check the primary navigation, legal/about links, and browser back
      navigation.
- [ ] Keep this production pass read-only: do not RSVP, toggle reminders or
      hype, report an event, upload content, or create/edit/delete events.

## Notifications

- [ ] Open notification preferences and confirm provider/device status renders
      without an unexpected error.
- [ ] Do not enable push, register/unregister a device, trigger a broadcast, or
      schedule a test reminder in production.
- [ ] On devices that previously used `fut-apulse.vercel.app`, remove that
      origin's notification permission and installed PWA in browser/site
      settings. Then use only the canonical `www` domain for FUTApulse.
- [ ] Test actual push registration and delivery using a staging account and
      staging device.

## Offline and recovery behavior

- [ ] While online, load the feed and wait for it to finish.
- [ ] Use the browser's offline mode or airplane mode. Confirm the app announces
      offline status and shows cached feed content or the offline shell without
      implying that server actions succeeded.
- [ ] Restore connectivity. Confirm the online state returns and the feed can
      refresh. Do not retry any action that might have been submitted before
      connectivity was lost.

## Record results

| Date/time | Release | Device / browser | Domain & health | Account screens | Feed/navigation | Notifications status | Offline/recovery | Result / follow-up |
|---|---|---|---|---|---|---|---|---|
|  |  |  |  |  |  |  |  |  |

If a critical check fails, stop further testing, record the visible error and
affected release, and follow the deployment rollback/incident procedure. Never
include passwords, verification codes, tokens, or secret headers in the record.
