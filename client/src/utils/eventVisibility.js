const RECAP_DISPLAY_WINDOW_MS = 30 * 60_000

function normalizeAudienceLevel(value) {
  return String(value).trim().toLowerCase().replace(/^(\d+)\s*l$/, '$1')
}

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
  const audience = rawAudience.map(normalizeAudienceLevel)
  if (audience.length === 0 || audience.includes('') || audience.some((level) => ['all', 'all levels', 'all students', 'everyone'].includes(level))) return true

  const profileLevel = normalizeAudienceLevel(profile.level)
  return audience.includes(profileLevel)
}
