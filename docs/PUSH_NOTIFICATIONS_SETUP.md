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
4. On each phone, open the deployed HTTPS site, sign in, then go to **Profile → Notification Preferences → Enable push on this device** and allow notifications. For iOS, install the site to the Home Screen first; iOS web push requires a supported iOS version and an installed web app.
5. Check the same settings panel. It should show provider configured, permission granted, device registered, and shared notification queue available.

## Delivery requirements

The Render API must remain available to process due notification jobs; MongoDB must be connected for durable scheduling. Push delivery can still be delayed or blocked by device connectivity, browser/OS notification settings, battery restrictions, or provider outages. The Profile notification status panel reports the provider, permission, device-registration, and shared-queue prerequisites separately. FUTApulse currently supports web push for installed and browser-based PWA sessions; native push providers are not included.
