import { useEffect, useRef, useState } from 'react'
import HouseSponsorCard from './HouseSponsorCard'

function AdSlot({ onHouseAction, compact = false, placement = 'feed-outstream' }) {
  const slotRef = useRef(null)
  const [inView, setInView] = useState(false)

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

  return (
    <div ref={slotRef} className={`feed-ad-slot${compact ? ' feed-ad-slot-compact' : ''}`} data-placement={placement}>
      {inView && <div className="feed-ad-house"><HouseSponsorCard compact={compact} onAction={onHouseAction} /></div>}
    </div>
  )
}

export default AdSlot
