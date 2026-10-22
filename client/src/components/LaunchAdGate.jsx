import { useEffect, useRef, useState } from 'react'
import { Check, SkipForward } from 'lucide-react'
import HouseSponsorCard from './HouseSponsorCard'

const SKIP_AFTER_MS = 5000
const launchVideoUrl = String(import.meta.env.VITE_IS_ADS_LIVE || '').toLowerCase() === 'true'
  ? String(import.meta.env.VITE_LAUNCH_AD_VIDEO_URL || '').trim()
  : ''

function LaunchAdGate({ onComplete, onHouseAction }) {
  const [mode, setMode] = useState(launchVideoUrl ? 'video' : 'sponsor')
  const [skipAvailable, setSkipAvailable] = useState(false)
  const [skipCountdown, setSkipCountdown] = useState(5)
  const completedRef = useRef(false)
  const onCompleteRef = useRef(onComplete)

  useEffect(() => {
    onCompleteRef.current = onComplete
  }, [onComplete])

  useEffect(() => {
    const skipTimer = window.setTimeout(() => setSkipAvailable(true), SKIP_AFTER_MS)
    const countdownTimer = window.setInterval(() => {
      setSkipCountdown((seconds) => Math.max(0, seconds - 1))
    }, 1000)
    return () => {
      window.clearTimeout(skipTimer)
      window.clearInterval(countdownTimer)
    }
  }, [])

  const handleContinue = () => {
    if (!skipAvailable || completedRef.current) return
    if (completedRef.current) return
    completedRef.current = true
    onCompleteRef.current()
  }

  return (
    <div className="app-root launch-ad-root">
      <div className="launch-ad-overlay">
        <section className="launch-ad-panel" aria-label="FUTApulse launch sponsor">
          <span className="launch-ad-sponsored">SPONSORED</span>
          {mode === 'video' && (
            <video
              className="launch-ad-video"
              src={launchVideoUrl}
              autoPlay
              muted
              playsInline
              controls
              preload="auto"
              onEnded={() => {
                if (!completedRef.current) {
                  completedRef.current = true
                  onCompleteRef.current()
                }
              }}
              onError={() => setMode('sponsor')}
              aria-label="FUTApulse sponsor video"
            />
          )}
          {mode !== 'video' && <HouseSponsorCard launch onAction={onHouseAction} />}
          {mode === 'sponsor' && <p className="launch-ad-status" role="status">Watch the sponsor message or skip when the button becomes available.</p>}
          {skipAvailable ? (
            <button type="button" className="launch-ad-skip" onClick={handleContinue}>
              <SkipForward size={16} aria-hidden="true" /> Skip ad
            </button>
          ) : (
            <p className="launch-ad-skip-countdown" role="status"><Check size={14} aria-hidden="true" /> Skip available in {skipCountdown}s</p>
          )}
        </section>
      </div>
    </div>
  )
}

export default LaunchAdGate
