import { isValidElement } from 'react'
import { ArrowUpRight, Sparkles } from 'lucide-react'
import { isMobileAdPlacementConfigured, mobileAdsConfig } from '../config/mobileAds'

function NativeAdCard({ onAction, nativeAdSlot, platform = 'android', compact = false }) {
  const canRenderNativeSlot = mobileAdsConfig.mode === 'admob'
    && isMobileAdPlacementConfigured(platform, 'native')
    && isValidElement(nativeAdSlot)

  if (canRenderNativeSlot) {
    return (
      <article className={`native-ad-card native-ad-card-live${compact ? ' native-ad-card-compact' : ''}`} aria-label="Sponsored content" data-ad-mode="admob">
        {nativeAdSlot}
      </article>
    )
  }

  return (
    <article className={`native-ad-card${compact ? ' native-ad-card-compact' : ''}`} aria-label="Sponsored content preview" data-ad-mode="mock">
      <span className="native-ad-badge">SPONSORED</span>
      <div className="native-ad-banner" role="img" aria-label="Campus life promotional artwork">
        <span className="native-ad-banner-glow" aria-hidden="true" />
        <span className="native-ad-banner-mark"><Sparkles size={30} aria-hidden="true" /></span>
        <span className="native-ad-banner-copy">MADE FOR<br /><strong>CAMPUS LIFE</strong></span>
        <span className="native-ad-banner-orbit" aria-hidden="true" />
      </div>
      <div className="native-ad-copy">
        <span className="native-ad-eyebrow">A FUTApulse partner</span>
        <h2>Make your next campus move count.</h2>
        <p>A sponsored placement preview. Partner offers and links will appear here.</p>
        <button type="button" className="native-ad-action" onClick={onAction}>
          Explore offer <ArrowUpRight size={16} aria-hidden="true" />
        </button>
      </div>
    </article>
  )
}

export default NativeAdCard
