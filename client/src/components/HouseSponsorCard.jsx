import { ArrowUpRight, Sparkles } from 'lucide-react'

function HouseSponsorCard({ onAction, compact = false }) {
  return (
    <article
      className={`native-ad-card house-sponsor-card${compact ? ' native-ad-card-compact' : ''}`}
      aria-label="FUTApulse sponsor message"
      data-ad-mode="house"
    >
      <span className="native-ad-badge">FUTAPULSE</span>
      <div className="native-ad-banner" role="img" aria-label="Campus life promotional artwork">
        <span className="native-ad-banner-glow" aria-hidden="true" />
        <span className="native-ad-banner-mark"><Sparkles size={30} aria-hidden="true" /></span>
        <span className="native-ad-banner-copy">MADE FOR<br /><strong>CAMPUS LIFE</strong></span>
        <span className="native-ad-banner-orbit" aria-hidden="true" />
      </div>
      <div className="native-ad-copy">
        <span className="native-ad-eyebrow">FUTApulse house sponsor</span>
        <h2>Make your next campus move count.</h2>
        <p>Campus promotions and partner offers will appear here.</p>
        <button type="button" className="native-ad-action" onClick={onAction}>
          Explore offer <ArrowUpRight size={16} aria-hidden="true" />
        </button>
      </div>
    </article>
  )
}

export default HouseSponsorCard
