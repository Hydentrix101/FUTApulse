import { useEffect, useRef, useState } from 'react'
import HouseSponsorCard from './HouseSponsorCard'
import { dismissLaunchAd, preloadLaunchAd, showLaunchAd } from '../ads/adProviderAdapter'

const LOAD_TIMEOUT_MS = 2000
const HOUSE_FALLBACK_MS = 1800
const MAX_VIDEO_DISPLAY_MS = 30000

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
  const completedRef = useRef(false)
  const onCompleteRef = useRef(onComplete)

  useEffect(() => {
    onCompleteRef.current = onComplete
  }, [onComplete])

  useEffect(() => {
    let cancelled = false
    let fallbackTimer
    const finish = () => {
      if (completedRef.current) return
      completedRef.current = true
      onCompleteRef.current()
    }

    const start = async () => {
      try {
        const prepared = await withTimeout(preloadLaunchAd(), LOAD_TIMEOUT_MS)
        if (cancelled) return

        if (prepared) {
          setMode('video')
          const shown = await withTimeout(showLaunchAd(), MAX_VIDEO_DISPLAY_MS)
          if (cancelled) return
          if (shown) {
            finish()
            return
          }
          await dismissLaunchAd().catch(() => {})
        }
      } catch {
        // Missing SDK, no fill, provider errors, and load errors all use the
        // same non-blocking house-card path.
      }

      if (cancelled) return
      setMode('fallback')
      fallbackTimer = window.setTimeout(finish, HOUSE_FALLBACK_MS)
    }

    start()
    return () => {
      cancelled = true
      window.clearTimeout(fallbackTimer)
    }
  }, [])

  const handleContinue = async () => {
    if (mode === 'video') {
      try {
        await dismissLaunchAd()
      } catch {
        // Completing the web gate must not depend on a native dismissal hook.
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
          <HouseSponsorCard launch onAction={onHouseAction} />
          {mode === 'video' && <p className="launch-ad-status" role="status">Sponsored video is playing. Use the ad provider's skip or close control to continue.</p>}
          {mode !== 'video' && <button type="button" className="launch-ad-skip" onClick={handleContinue}>Continue to FUTApulse</button>}
        </section>
      </div>
    </div>
  )
}

export default LaunchAdGate
