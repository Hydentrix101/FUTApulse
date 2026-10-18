import { useEffect, useRef, useState } from 'react'
import HouseSponsorCard from './HouseSponsorCard'
import { mountOutstreamVideo } from '../ads/adProviderAdapter'

const VIDEO_LOAD_TIMEOUT_MS = 2000

function AdSlot({ onHouseAction, compact = false, placement = 'feed-outstream' }) {
  const slotRef = useRef(null)
  const videoHostRef = useRef(null)
  const [inView, setInView] = useState(false)
  const [videoReady, setVideoReady] = useState(false)

  useEffect(() => {
    const node = slotRef.current
    if (!node || typeof IntersectionObserver === 'undefined') {
      setInView(true)
      return undefined
    }

    const observer = new IntersectionObserver(([entry]) => {
      if (entry.isIntersecting) {
        setInView(true)
        observer.disconnect()
      }
    }, { rootMargin: '240px 0px' })
    observer.observe(node)
    return () => observer.disconnect()
  }, [])

  useEffect(() => {
    if (!inView || !videoHostRef.current) return undefined

    let active = true
    let settled = false
    let cleanup
    let timeout
    const host = videoHostRef.current

    try {
      cleanup = mountOutstreamVideo(host, {
        placement,
        onLoaded: () => {
          if (!active || settled) return
          settled = true
          window.clearTimeout(timeout)
          setVideoReady(true)
        },
        onNoFill: () => {
          if (!active) return
          settled = true
          window.clearTimeout(timeout)
          setVideoReady(false)
        },
        onError: () => {
          if (!active) return
          settled = true
          window.clearTimeout(timeout)
          setVideoReady(false)
        },
      })

      if (cleanup !== null) {
        timeout = window.setTimeout(() => {
          if (!active || settled) return
          settled = true
          setVideoReady(false)
        }, VIDEO_LOAD_TIMEOUT_MS)
      }
    } catch {
      // The house sponsor remains visible if the provider throws synchronously.
    }

    return () => {
      active = false
      window.clearTimeout(timeout)
      if (typeof cleanup === 'function') cleanup()
    }
  }, [inView, placement])

  return (
    <div ref={slotRef} className={`feed-ad-slot${compact ? ' feed-ad-slot-compact' : ''}`} data-placement={placement}>
      <div className={videoReady ? 'feed-ad-house is-hidden' : 'feed-ad-house'} aria-hidden={videoReady}>
        <HouseSponsorCard compact={compact} onAction={onHouseAction} />
      </div>
      <div ref={videoHostRef} className={`feed-ad-video-host${videoReady ? ' is-active' : ''}`} aria-hidden={!videoReady} aria-label="Sponsored video" />
    </div>
  )
}

export default AdSlot
