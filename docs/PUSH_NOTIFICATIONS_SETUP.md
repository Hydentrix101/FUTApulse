# Background push setup

FUTApulse already has a web-push service worker and a server notification queue. OS/browser permission alone is not enough: the Render API also needs provider credentials, and each device must register its push subscription.

## Web/PWA push

1. From the repository root, generate VAPID keys locally:

   ```powershell
   npx web-push generate-vapid-keys
   ```

2. In the Render dashboard, open the FUTApulse API service's **Environment** settings and add:

   | Variable | Value |
   | --- | --- |
   | `WEB_PUSH_PUBLIC_KEY` | Generated VAPID public key |
   | `WEB_PUSH_PRIVATE_KEY` | Generated VAPID private key |
   | `WEB_PUSH_SUBJECT` | `mailto:futapulse.ng@gmail.com` |

   Keep the private key in Render only. Do not commit it, put it in a `VITE_` variable, or send it in chat.

3. Save the environment changes and let Render restart/redeploy the API. Its startup log should say that Web Push delivery is configured.
4. On each phone, open the deployed HTTPS site and sign in. During category onboarding, choose **Save & enable device alerts**, or go to **Profile → Notification Preferences → Enable push on this device**, then allow notifications in the browser/OS prompt. Permission and push registration are per device/account: enabling notifications on a laptop does not enable them on a phone. For iOS, install the site to the Home Screen first; iOS web push requires a supported iOS version and an installed web app.
5. Check the same settings panel. It should show provider configured, permission granted, device registered, and shared notification queue available.

## Delivery requirements

The Render API must remain available to process due notification jobs; MongoDB must be connected for durable scheduling. Broadcasts go to event attendees and users following the event category. Each recipient receives an in-app toast while signed in and connected; closed-app/background delivery additionally requires that recipient's device to have permission and a registered push subscription. The organizer's confirmation reports eligible users and push-enabled devices. Push delivery can still be delayed or blocked by device connectivity, browser/OS notification settings, battery restrictions, or provider outages. The Profile notification status panel reports the provider, permission, device-registration, and shared-queue prerequisites separately. FUTApulse currently supports web push for installed and browser-based PWA sessions; native push providers are not included.
