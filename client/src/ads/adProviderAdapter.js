import { isMobileAdPlacementConfigured, mobileAdsConfig } from '../config/mobileAds'

/**
 * Thin boundary between React and a native/web ad SDK.
 *
 * A Capacitor ad plugin can expose this bridge as `window.FUTApulseAds`.
 * The adapter intentionally treats an absent or incomplete bridge as no fill,
 * so the app always has a local house-ad fallback.
 */
function getBridge() {
  if (typeof window === 'undefined') return null
  const bridge = window.FUTApulseAds
  const platform = window.Capacitor?.getPlatform?.()
  if (!bridge || !['android', 'ios'].includes(platform) || mobileAdsConfig.mode !== 'admob') return null
  return { bridge, platform }
}

export async function preloadLaunchAd() {
  const provider = getBridge()
  if (!provider || !isMobileAdPlacementConfigured(provider.platform, 'app-open')) return false
  const { bridge } = provider
  if (typeof bridge.preloadAppOpenAd !== 'function') return false

  await bridge.preloadAppOpenAd()
  return true
}

export async function showLaunchAd() {
  const provider = getBridge()
  if (!provider || !isMobileAdPlacementConfigured(provider.platform, 'app-open')) return false
  const { bridge } = provider
  if (typeof bridge.showAppOpenAd !== 'function') return false

  // The native SDK owns its close/skip UI and timing. The requested five
  // second delay is passed as a preference; a provider may enforce its own.
  await bridge.showAppOpenAd({ skipAfterMs: 5000 })
  return true
}

export function mountOutstreamVideo(element, options) {
  const provider = getBridge()
  if (!provider || !isMobileAdPlacementConfigured(provider.platform, 'native')) return null
  const { bridge } = provider
  if (typeof bridge.mountOutstreamVideo !== 'function') return null

  return bridge.mountOutstreamVideo(element, {
    placement: options.placement || 'feed-outstream',
    muted: true,
    ...options,
  })
}

export async function dismissLaunchAd() {
  const provider = getBridge()
  const { bridge } = provider || {}
  if (typeof bridge?.dismissAppOpenAd === 'function') {
    await bridge.dismissAppOpenAd()
  }
}
