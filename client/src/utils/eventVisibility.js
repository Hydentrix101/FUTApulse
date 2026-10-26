const RECAP_DISPLAY_WINDOW_MS = 30 * 60_000

export function isPublicRecapVisible(event, now = Date.now()) {
  const endAt = Date.parse(event?.endTime || '')
  const publishedAt = Date.parse(event?.recapPublishedAt || '')
  return ['Published', 'Live'].includes(event?.status)
    && Number.isFinite(endAt)
    && endAt <= now
    && Array.isArray(event?.recapPhotos)
    && event.recapPhotos.length > 0
    && Number.isFinite(publishedAt)
    && publishedAt <= now
    && now - publishedAt <= RECAP_DISPLAY_WINDOW_MS
}

export function matchesProfileAudience(event, profile, now = Date.now()) {
  if (isPublicRecapVisible(event, now) || !profile?.level) return true

  const rawAudience = Array.isArray(event?.audience)
    ? event.audience
    : String(event?.audience || '').split(',')
  const audience = rawAudience.map((level) => String(level).trim().replace(/L$/i, ''))
  if (audience.length === 0 || audience.includes('') || audience.includes('all')) return true

  const profileLevel = String(profile.level).trim().replace(/L$/i, '')
  return audience.includes(profileLevel)
}
