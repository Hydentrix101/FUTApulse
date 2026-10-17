import { useEffect, useState } from 'react'

const DAY_IN_MS = 24 * 60 * 60 * 1000
const MAX_TIMEOUT = 2_147_000_000

function toTimestamp(value) {
  if (value instanceof Date) return value.getTime()
  if (typeof value === 'number' || typeof value === 'string') return new Date(value).getTime()
  return Number.NaN
}

function CountdownPill({ startTime, endTime }) {
  const startTimestamp = toTimestamp(startTime)
  const endTimestamp = endTime === undefined ? Number.NaN : toTimestamp(endTime)
  const [now, setNow] = useState(() => Date.now())

  useEffect(() => {
    if (!Number.isFinite(startTimestamp)) return undefined

    let boundaryTimeout
    let ticker

    const tick = () => {
      const currentTime = Date.now()
      setNow(currentTime)
      if (
        ticker &&
        currentTime >= startTimestamp &&
        (!Number.isFinite(endTimestamp) || currentTime >= endTimestamp)
      ) {
        window.clearInterval(ticker)
        ticker = undefined
      }
    }

    const startTicker = () => {
      tick()
      ticker = window.setInterval(tick, 1000)
    }

    const scheduleCountdown = () => {
      const remaining = startTimestamp - Date.now()
      if (remaining > DAY_IN_MS) {
        boundaryTimeout = window.setTimeout(
          scheduleCountdown,
          Math.min(remaining - DAY_IN_MS, MAX_TIMEOUT),
        )
        return
      }
      startTicker()
    }

    const currentTime = Date.now()
    if (startTimestamp - currentTime > DAY_IN_MS) {
      scheduleCountdown()
    } else if (Number.isFinite(endTimestamp) && endTimestamp <= currentTime) {
      boundaryTimeout = window.setTimeout(() => setNow(Date.now()), 0)
    } else if (startTimestamp > currentTime || (Number.isFinite(endTimestamp) && endTimestamp > currentTime)) {
      startTicker()
    } else {
      boundaryTimeout = window.setTimeout(() => setNow(Date.now()), 0)
    }

    return () => {
      window.clearTimeout(boundaryTimeout)
      window.clearInterval(ticker)
    }
  }, [startTimestamp, endTimestamp])

  if (!Number.isFinite(startTimestamp)) {
    return (
      <span className="inline-flex rounded-full border border-slate-500/30 bg-slate-500/15 px-3 py-1 text-xs font-semibold text-slate-300">
        TIME TO BE ANNOUNCED
      </span>
    )
  }

  if (Number.isFinite(endTimestamp) && now >= endTimestamp) {
    return (
      <span className="inline-flex rounded-full border border-slate-500/30 bg-slate-500/15 px-3 py-1 text-xs font-semibold text-slate-300">
        ENDED
      </span>
    )
  }

  const remaining = startTimestamp - now
  if (remaining <= 0) {
    return (
      <span className="inline-flex rounded-full border border-emerald-500/30 bg-emerald-500/15 px-3 py-1 text-xs font-semibold text-emerald-300">
        LIVE NOW
      </span>
    )
  }

  if (remaining > DAY_IN_MS) {
    const days = Math.ceil(remaining / DAY_IN_MS)
    return (
      <span className="inline-flex rounded-full border border-amber-500/30 bg-amber-500/20 px-3 py-1 text-xs font-semibold text-amber-400">
        STARTS ON {days} {days === 1 ? 'DAY' : 'DAYS'}
      </span>
    )
  }

  const totalSeconds = Math.floor(remaining / 1000)
  const hours = String(Math.floor(totalSeconds / 3600)).padStart(2, '0')
  const minutes = String(Math.floor((totalSeconds % 3600) / 60)).padStart(2, '0')
  const seconds = String(totalSeconds % 60).padStart(2, '0')

  return (
    <span className="inline-flex rounded-full border border-amber-500/30 bg-amber-500/20 px-3 py-1 text-xs font-semibold tabular-nums text-amber-400">
      STARTS IN {hours}:{minutes}:{seconds}
    </span>
  )
}

export default CountdownPill
