# FUTApulse Ad Provider Bridge

The React ad slots are provider-neutral. Until a supported mobile ad SDK is
installed in the Capacitor Android/iOS project, the app uses the local house
sponsor card. The client only activates the native bridge when `VITE_ADS_MODE`
is `admob`, the platform app/ad-unit IDs are configured, and the native runtime
exposes `window.FUTApulseAds`.

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
static fallback must remain available when the network is absent.
