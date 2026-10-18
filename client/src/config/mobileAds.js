const env = import.meta.env

const readValue = (key) => String(env[key] || '').trim()

const platformConfig = (platform) => {
  const prefix = platform === 'ios' ? 'VITE_ADMOB_IOS' : 'VITE_ADMOB_ANDROID'
  return Object.freeze({
    appId: readValue(`${prefix}_APP_ID`),
    nativeAdUnitId: readValue(`${prefix}_NATIVE_AD_UNIT_ID`),
    appOpenAdUnitId: readValue(`${prefix}_APP_OPEN_AD_UNIT_ID`),
  })
}

export const mobileAdsConfig = Object.freeze({
  mode: readValue('VITE_ADS_MODE').toLowerCase() === 'admob' ? 'admob' : 'mock',
  android: platformConfig('android'),
  ios: platformConfig('ios'),
})

export function isMobileAdPlacementConfigured(platform, placement) {
  if (mobileAdsConfig.mode !== 'admob') return false

  const config = mobileAdsConfig[platform]
  if (!config?.appId) return false

  if (placement === 'app-open') return Boolean(config.appOpenAdUnitId)
  return Boolean(config.nativeAdUnitId)
}
