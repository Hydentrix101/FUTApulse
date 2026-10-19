import { useEffect, useRef, useState } from 'react'
import { Check, SkipForward } from 'lucide-react'
import HouseSponsorCard from './HouseSponsorCard'
import { dismissLaunchAd, preloadLaunchAd, showLaunchAd } from '../ads/adProviderAdapter'

const LOAD_TIMEOUT_MS = 2500
const MAX_NATIVE_AD_MS = 120000
const SKIP_AFTER_MS = 5000
const launchVideoUrl = String(import.meta.env.VITE_LAUNCH_AD_VIDEO_URL || '').trim()

function withTimeout(promise, timeoutMs) {
  let timer
  return Promise.race([
    promise,
    new Promise((resolve) => {
      timer = window.setTimeout(() => resolve(false), timeoutMs)
    }),
  ]).finally(() => window.clearTimeout(timer))
}

function LaunchAdGate({ onComplete, onHouseAction }) {
  const [mode, setMode] = useState('loading')
  const [skipAvailable, setSkipAvailable] = useState(false)
  const [skipCountdown, setSkipCountdown] = useState(5)
  const completedRef = useRef(false)
  const onCompleteRef = useRef(onComplete)

  useEffect(() => {
    onCompleteRef.current = onComplete
  }, [onComplete])

  useEffect(() => {
    let cancelled = false
    const finish = () => {
      if (completedRef.current) return
      completedRef.current = true
      onCompleteRef.current()
    }
    const skipTimer = window.setTimeout(() => setSkipAvailable(true), SKIP_AFTER_MS)
    const countdownTimer = window.setInterval(() => {
      setSkipCountdown((seconds) => Math.max(0, seconds - 1))
    }, 1000)
    const start = async () => {
      try {
        const prepared = await withTimeout(preloadLaunchAd(), LOAD_TIMEOUT_MS)
        if (cancelled) return
        if (prepared) {
          setMode('native')
          const shown = await withTimeout(showLaunchAd(), MAX_NATIVE_AD_MS)
          if (cancelled) return
          if (shown) {
            finish()
            return
          }
          await dismissLaunchAd().catch(() => {})
        }
      } catch {
        // A missing ad bridge or a no-fill falls through to the configured
        // launch video, then to the local sponsor card.
      }
      if (!cancelled) setMode(launchVideoUrl ? 'video' : 'sponsor')
    }
    start()
    return () => {
      cancelled = true
      window.clearTimeout(skipTimer)
      window.clearInterval(countdownTimer)
    }
  }, [])

  const handleContinue = async () => {
    if (!skipAvailable || completedRef.current) return
    if (mode === 'native') {
      try {
        await dismissLaunchAd()
      } catch {
        // A native dismissal failure must not trap the user at launch.
      }
    }
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
          {mode === 'native' && <p className="launch-ad-status" role="status">Your sponsor message is playing.</p>}
          {mode === 'loading' && <p className="launch-ad-status" role="status">Preparing today’s campus sponsor…</p>}
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
