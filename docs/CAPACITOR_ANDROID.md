# FUTApulse Android packaging preparation

The Android Capacitor shell is scaffolded with application ID `ng.edu.futa.futapulse`. The existing `client/public/manifest.json` remains the PWA manifest. The Android shell bundles the client assets and calls the HTTPS Render API directly; it does not load the hosted site in a remote WebView.

The `icon-512.png` file in the current workspace was actually 192×192 despite its filename and manifest declaration. It has been resized to a valid 512×512 resource, and the Android launcher/splash assets use the same FUTApulse artwork. If the original full-resolution icon artwork is available, replace the upscaled file for best sharpness.

## Build and open the Android project

Install Android Studio and its Android SDK, then open the generated project:

```powershell
npm install --prefix client
npm run cap:sync:android --prefix client
npm run cap:open:android --prefix client
```

`cap:sync:android` builds with Vite's `android` mode, using the non-secret API origin in `client/.env.android`, then syncs the output into `client/android`. Build and run a debug app from Android Studio on an emulator or a connected test phone. The generated project targets API 36, uses Gradle 8.14.3, and has a minimum Android SDK level of 24; install compatible SDK and JDK tooling through Android Studio.

Do not commit signing keys, passwords, or production credentials. Configure release signing only in a protected local or CI secret store.

## Required backend and sign-in work before native release

- The Android WebView origin is `https://localhost`. Add that origin to Render's comma-separated `CORS_ORIGIN` allowlist before testing API calls from the native app. Keep the existing production website origin in the list.
- Native builds use `https://futapulse.onrender.com` as the API base. Test signup, username/password sign-in, refresh/session persistence, publishing, and event interactions on Android; web cookies and browser storage may behave differently in a native WebView.
- The server currently sets refresh cookies as `HttpOnly; SameSite=Lax`. A native WebView calling the cross-site Render API from `https://localhost` should not be assumed to send that cookie reliably. Design and test a native session-refresh strategy before release; do not weaken cookie policy globally to work around this.
- Google sign-in currently uses Google Identity Services' browser popup/code flow. Do not assume that flow works in Android WebView. Implement and configure an Android-supported OAuth flow/client before advertising Google sign-in in a native release.
- Shared event links need Android App Links configuration and a domain `assetlinks.json` containing the release signing certificate fingerprint. Add and test link handling before treating native deep links as complete.

## Phase 4 exit checks still required

- Install and launch the branded app on supported Android devices.
- Verify sign-in persistence, event create/edit/delete, engagement, profile photo selection, and browser-back behavior.
- Open a shared event URL from another app and confirm Android routes to the correct event.
- Verify app updates and offline behavior. Only the static shell is cached; event/API data is not promised offline.
- Complete PWA installation/update/shared-link checks on real Android and iOS devices separately from APK testing.
