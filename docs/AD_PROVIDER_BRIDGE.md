# FUTApulse Ad Provider Bridge

The React placements are provider-neutral. They use the local house sponsor
card unless `VITE_IS_ADS_LIVE=true`, `VITE_ADS_MODE=admob`, platform app/ad-unit
IDs are configured, and the native runtime exposes `window.FUTApulseAds`.
`VITE_IS_ADS_LIVE` is opt-in and defaults to false; unset or invalid values
keep the app in mock mode, including the launch gate and feed placements.

The current integration is a native AdMob bridge contract, not a web AdSense
integration. A Google AdSense publisher ID by itself does not configure web ad
inventory; approved ad slots, consent/disclosure behavior, and a reviewed web
adapter would also be required. Do not enable live ads by setting the flag
until the matching provider is configured and approved.

## Expected native bridge

The Capacitor plugin should expose these operations:

- `preloadAppOpenAd()`: resolve `true` when a launch ad is ready; reject or
  resolve `false` for errors and no fill.
- `showAppOpenAd({ skipAfterMs })`: present the SDK's app-open format and resolve
  when closed or skipped. The SDK owns its close control; `skipAfterMs: 5000` is
  a request to the provider, not a React overlay or a guarantee for every ad.
- `dismissAppOpenAd()`: best-effort dismissal for the gate watchdog.
- `mountOutstreamVideo(element, { placement, muted, onLoaded, onNoFill, onError })`:
  mount a feed video in the provided host and return a cleanup function when
  possible. Call the lifecycle callback once the result is known.

The launch gate waits at most two seconds for preload. A missing bridge, no fill,
error, or timeout uses the static house card and continues automatically; no
provider response may later interrupt the feed. The SDK's launch format should
be an app-open ad. Interstitials are not used at app launch.

Feed `AdSlot`s begin provider loading only near the viewport. The house sponsor
card remains visible until a video reports success. A no-fill, error, or
two-second timeout leaves the house card in place. Slots are rendered only in
the Home feed's existing category-pair and full-category placements; utility
screens do not mount ad slots.

Ad provider requests and SDK credentials are not proxied through Express. A
future house-campaign API may provide first-party creative metadata, but the
static fallback must remain available when the network is absent. The existing
mock component is `HouseSponsorCard` (with the `native-ad-card` visual shell);
there is no separate `NativeAdCard` component in the current client.
