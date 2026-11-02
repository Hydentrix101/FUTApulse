export const CAMPUS_TIME_ZONE = 'Africa/Lagos'
const LOCAL_CAMPUS_DATE_TIME = /^(\d{4})-(\d{2})-(\d{2})(?:T(\d{2}):(\d{2})(?::(\d{2})(?:\.(\d{1,3}))?)?)?$/

const DATE_TIME_FORMATTER = new Intl.DateTimeFormat('en-GB', {
  timeZone: CAMPUS_TIME_ZONE,
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  hourCycle: 'h23',
})

export function parseCampusDateTime(value) {
  if (value instanceof Date) return Number.isFinite(value.getTime()) ? value : null
  if (typeof value !== 'string') return null
  const candidate = value.trim()
  const match = LOCAL_CAMPUS_DATE_TIME.exec(candidate)
  const instant = match
    ? new Date(`${match[1]}-${match[2]}-${match[3]}T${match[4] || '00'}:${match[5] || '00'}:${match[6] || '00'}${match[7] ? `.${match[7]}` : ''}+01:00`)
    : new Date(candidate)
  if (!Number.isFinite(instant.getTime())) return null
  if (match) {
    const parts = Object.fromEntries(DATE_TIME_FORMATTER.formatToParts(instant).map(({ type, value: part }) => [type, part]))
    if (`${parts.year}-${parts.month}-${parts.day}` !== `${match[1]}-${match[2]}-${match[3]}`
      || match[4] && `${parts.hour}:${parts.minute}` !== `${match[4]}:${match[5]}`) return null
  }
  return instant
}

export function getCampusDateTimeParts(value) {
  const instant = parseCampusDateTime(value)
  if (!instant) return null
  const parts = Object.fromEntries(DATE_TIME_FORMATTER.formatToParts(instant).map(({ type, value: part }) => [type, part]))
  return {
    date: `${parts.year}-${parts.month}-${parts.day}`,
    time: `${parts.hour}:${parts.minute}`,
  }
}

export function formatCampusDateTime(value, options = {}) {
  const instant = parseCampusDateTime(value)
  if (!instant) return ''
  return new Intl.DateTimeFormat('en-NG', {
    timeZone: CAMPUS_TIME_ZONE,
    dateStyle: 'medium',
    timeStyle: 'short',
    ...options,
  }).format(instant)
}
