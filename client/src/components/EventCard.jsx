import { useEffect, useRef, useState } from 'react'
import { Bell, Building2, CircleHelp, Clock3, ExternalLink, Flame, MapPin, Share2, TriangleAlert, X } from 'lucide-react'
import CountdownPill from './CountdownPill'

const categoryStyles = {
  tech: 'tech-badge',
  academic: 'academic-badge',
  social: 'social-badge',
  religious: 'religious-badge',
  sports: 'sports-badge',
  seminars: 'seminars-badge',
}

const categoryLabels = {
  tech: 'TECH / HACKATHON',
  academic: 'ACADEMIC',
  social: 'SOCIAL / VIBES',
  religious: 'RELIGIOUS / FELLOWSHIP',
  sports: 'SPORTS / ATHLETICS',
  seminars: 'SEMINARS',
}

function safeHttpUrl(value) {
  try {
    const url = new URL(String(value || ''))
    return ['http:', 'https:'].includes(url.protocol) && !url.username && !url.password ? url.href : ''
  } catch {
    return ''
  }
}

const DEFAULT_FACULTY_LOGO = '/Faculty%20Logo/SEET.png'
const FACULTY_LOGO_FALLBACK = `data:image/svg+xml;charset=UTF-8,${encodeURIComponent(
  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 128 128"><rect width="128" height="128" rx="24" fill="#10253d"/><path d="M64 18 104 34v28c0 25-16 40-40 50C40 102 24 87 24 62V34z" fill="#2563eb"/><path d="M64 31 92 42v20c0 18-10 29-28 37-18-8-28-19-28-37V42z" fill="#f8fafc"/><text x="64" y="69" text-anchor="middle" font-family="Arial,sans-serif" font-size="18" font-weight="700" fill="#10253d">FUTA</text></svg>',
)}`

function getFacultyLogoPath(faculty) {
  return `/Faculty%20Logo/${encodeURIComponent(faculty || 'SEET')}.png`
}

function getTargetLabel(audience) {
  const levels = Array.isArray(audience)
    ? audience
    : typeof audience === 'string'
      ? audience.split(',').map((level) => level.trim())
      : []
  if (levels.length === 0 || levels.includes('all')) return 'ALL LEVELS'
  return levels.map((level) => `${String(level).replace(/L$/i, '')}L`).join('–')
}

function FacultyBadge({ faculty, count }) {
  const [imageFallbackStage, setImageFallbackStage] = useState(0)
  const facultyLogo = getFacultyLogoPath(faculty)
  const logoSrc = imageFallbackStage === 0
    ? facultyLogo
    : imageFallbackStage === 1
      ? DEFAULT_FACULTY_LOGO
      : FACULTY_LOGO_FALLBACK

  return (
    <div className="faculty-badge flex min-w-[64px] flex-col items-center gap-1 rounded-xl border border-slate-600/70 bg-slate-800/90 px-2 py-2 text-center">
      <span className="flex h-9 w-9 items-center justify-center overflow-hidden rounded-full border border-slate-500/70 bg-slate-700 text-slate-200">
        {imageFallbackStage >= 3 ? (
          <Building2 size={17} aria-hidden="true" />
        ) : (
          <img
            src={logoSrc}
            alt={`${faculty} crest`}
            className="h-full w-full object-cover"
            onError={() => setImageFallbackStage((stage) => Math.min(stage + 1, 3))}
          />
        )}
      </span>
      <span className="text-[10px] font-semibold tracking-wide text-slate-300">{faculty}</span>
      <strong className="text-sm leading-none text-white">{count}</strong>
    </div>
  )
}

function EventCard({ event, onComing, onRemind, onReport, viewerProfile, isHot = false, readOnly = false }) {
  const [isLocationModalOpen, setIsLocationModalOpen] = useState(false)
  const [isTurnoutOpen, setIsTurnoutOpen] = useState(false)
  const [isDescriptionExpanded, setIsDescriptionExpanded] = useState(false)
  const [shareFeedback, setShareFeedback] = useState('')
  const [currentTime, setCurrentTime] = useState(0)
  const [showReminderNudge, setShowReminderNudge] = useState(false)
  const reminderNudgeTimer = useRef(null)
  const isReminded = Boolean(event.isReminded || event.reminded)
  const isComing = Boolean(event.isGoing ?? event.hasHyped)
  const [unavailableBannerSource, setUnavailableBannerSource] = useState('')
  const [organizerFallback, setOrganizerFallback] = useState({ source: '', stage: 0 })

  const category = String(event.category || 'social').toLowerCase()
  const isHotEvent = isHot || event.isHot === true || Number(event.hotScore) >= 10
  const categoryClass = categoryStyles[category] || categoryStyles.social
  const categoryLabel = categoryLabels[category] || category.toUpperCase()
  const title = event.title || 'Untitled event'
  const organizer = event.organizerName || event.organizer?.name || 'Campus Organizer'
  const organizerPicture = event.organizerPicture || event.organizer?.picture || getFacultyLogoPath(event.organizerFaculty || event.faculty)
  const organizerFacultyLogo = getFacultyLogoPath(event.organizerFaculty || event.faculty || 'SEET')
  const organizerFallbackStage = organizerFallback.source === organizerPicture ? organizerFallback.stage : 0
  const organizerImageSrc = organizerFallbackStage === 0
    ? organizerPicture
    : organizerFallbackStage === 1
      ? organizerFacultyLogo
      : FACULTY_LOGO_FALLBACK
  const bannerSource = event.banner || event.image || ''
  const isBannerUnavailable = !bannerSource || unavailableBannerSource === bannerSource
  const description = event.activity || event.description || 'Event details will be announced soon.'
  const venue = event.venue || 'Venue to be announced'
  const landmark = event.venueLandmark || 'Check with the student organizers for venue directions.'
  const meetingUrl = category === 'seminars' ? safeHttpUrl(event.meetingUrl) : ''
  const eventId = event.id ?? event._id
  const attendeeCount = Number(event.turnoutCount ?? event.rsvpCount ?? event.attendeeCount) || 0
  const turnout = Array.isArray(event.turnoutBreakdown) ? event.turnoutBreakdown : []
  const department = String(viewerProfile?.department || '').trim()
  const departmentMatch = department
    ? new RegExp(`(?:^|[,;\\s])${department.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s*[:=-]?\\s*(\\d+)(?=$|[,;\\s])`, 'i')
    : null
  const departmentAttendees = departmentMatch
    ? turnout.reduce((total, item) => {
      const breakdown = typeof item.departments === 'string'
        ? item.departments
        : Object.entries(item.departments || {}).map(([name, count]) => `${name} ${count}`).join(', ')
      const count = Number(departmentMatch.exec(breakdown)?.[1]) || 0
      return total + count
    }, 0)
    : 0
  const startDate = new Date(event.startTime || event.date)
  const endDate = new Date(event.endTime)
  const endDateLabel = Number.isFinite(endDate.getTime())
    ? endDate.toLocaleDateString([], { month: 'short', day: 'numeric' })
    : ''
  const timeRange = Number.isFinite(startDate.getTime())
    ? `${startDate.toLocaleDateString([], { month: 'short', day: 'numeric' })} · ${startDate.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}${endDateLabel ? `–${endDateLabel === startDate.toLocaleDateString([], { month: 'short', day: 'numeric' }) ? '' : `${endDateLabel} · `}${endDate.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}` : ''}`
    : ''
  const eventState = Number.isFinite(endDate.getTime()) && currentTime >= endDate.getTime()
    ? 'participated'
    : Number.isFinite(startDate.getTime()) && currentTime >= startDate.getTime()
      ? 'there'
      : 'going'

  useEffect(() => {
    const initialTimer = window.setTimeout(() => setCurrentTime(Date.now()), 0)
    const timer = window.setInterval(() => setCurrentTime(Date.now()), 30_000)
    return () => {
      window.clearTimeout(initialTimer)
      window.clearInterval(timer)
      window.clearTimeout(reminderNudgeTimer.current)
    }
  }, [])

  const shareEvent = async () => {
    setShareFeedback('')
    const shareUrl = new URL(window.location.pathname, window.location.origin)
    shareUrl.hash = 'home'
    shareUrl.searchParams.set('event', String(eventId || ''))
    shareUrl.searchParams.set('category', category)
    try {
      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(shareUrl.toString())
      } else {
        const copyField = document.createElement('textarea')
        copyField.value = shareUrl.toString()
        copyField.setAttribute('readonly', '')
        copyField.style.position = 'fixed'
        copyField.style.opacity = '0'
        document.body.appendChild(copyField)
        copyField.select()
        const copied = document.execCommand('copy')
        copyField.remove()
        if (!copied) throw new Error('Unable to copy the event link in this browser.')
      }
      setShareFeedback('Event link copied.')
    } catch (error) {
      console.error('Unable to share this event.', error)
      setShareFeedback(error.message || 'Unable to share this event.')
    }
  }

  const handleComing = (clickEvent) => {
    const nextComing = !isComing
    window.clearTimeout(reminderNudgeTimer.current)
    if (nextComing) {
      setShowReminderNudge(true)
      reminderNudgeTimer.current = window.setTimeout(() => setShowReminderNudge(false), 2200)
    } else {
      setShowReminderNudge(false)
    }
    const rect = clickEvent.currentTarget.getBoundingClientRect()
    onComing?.(eventId, { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 })
  }

  const handleRemind = () => {
    onRemind?.(eventId)
  }

  const shareAction = (
    <button
      type="button"
      className="event-action event-icon-action event-share-action"
      onClick={shareEvent}
      aria-label={`Share ${title}`}
      title="Copy event link"
    >
      <Share2 size={18} aria-hidden="true" />
    </button>
  )

  return (
    <>
    <article className={`event-card ${category}-platform ${isHotEvent ? 'is-hot-event' : ''} flex flex-col overflow-hidden p-4 text-slate-100`}>
      <div className="absolute left-1/2 top-2 z-10 -translate-x-1/2 rounded-full border border-slate-600/80 bg-slate-950/90 px-2.5 py-1 text-[9px] font-bold tracking-wide text-slate-100">
        {getTargetLabel(event.audience)}
      </div>
      <span className={`category-badge ${categoryClass}`}>
        {isHotEvent && <><Flame size={12} aria-hidden="true" /> HOT · </>}{categoryLabel}
      </span>

      <header className="card-header grid min-h-[98px] grid-cols-[76px_minmax(0,1fr)_76px] items-end gap-1 pt-7">
        <div className="organizer-info organizer-avatar-wrap flex w-[76px] shrink-0 flex-col items-center gap-1 text-center">
          <span className="relative flex h-14 w-14 items-center justify-center overflow-hidden rounded-full border-2 border-blue-400/70 bg-slate-800 text-blue-200">
            <Building2 className="absolute" size={19} aria-hidden="true" />
            {organizerFallbackStage < 3 && (
              <img
                src={organizerImageSrc}
                alt=""
                className="organizer-avatar relative z-[1] h-full w-full object-cover"
                onError={() => setOrganizerFallback((current) => ({
                  source: organizerPicture,
                  stage: Math.min((current.source === organizerPicture ? current.stage : 0) + 1, 3),
                }))}
              />
            )}
          </span>
          <span className="line-clamp-2 text-[10px] font-semibold leading-tight text-slate-300">
            {organizer}
          </span>
        </div>

        <div className="title-countdown-center col-start-2 row-start-1 min-w-0 pb-1 text-center">
          <h2 className="event-title text-xl font-black leading-tight tracking-tight text-white">{title}</h2>
          <div className="mt-1.5 flex justify-center">
            <CountdownPill startTime={event.startTime || event.date} endTime={event.endTime} />
          </div>
          {timeRange && <p className="event-time-range"><Clock3 size={13} aria-hidden="true" /> <time dateTime={startDate.toISOString()}>{timeRange}</time></p>}
        </div>
        <span className="card-header-balance col-start-3 row-start-1" aria-hidden="true" />
      </header>

      <div className="event-card-media relative h-44 w-full overflow-hidden rounded-xl bg-slate-950">
        {isBannerUnavailable ? (
          <div className="flex h-full w-full flex-col items-center justify-center gap-2 bg-gradient-to-br from-slate-700 to-slate-950 text-slate-400">
            <Building2 size={30} aria-hidden="true" />
            <span className="text-xs">{bannerSource ? 'Event image unavailable' : 'No event banner'}</span>
          </div>
        ) : (
          <img
            src={bannerSource}
            alt={`${title} event`}
            className="h-full w-full object-contain"
            onError={() => setUnavailableBannerSource(bannerSource)}
          />
        )}
      </div>

      <div className="text-center">
        <p className={`event-description text-sm font-bold leading-5 text-slate-200 ${isDescriptionExpanded ? '' : 'line-clamp-2'}`}>
          {description}
        </p>
        {description.length > 100 && (
          <button
            type="button"
            className="mt-1 text-xs font-semibold text-blue-300 hover:text-blue-200"
            onClick={() => setIsDescriptionExpanded((expanded) => !expanded)}
            aria-expanded={isDescriptionExpanded}
          >
            {isDescriptionExpanded ? 'Read Less' : 'Read More'}
          </button>
        )}
      </div>

      <div className="relative flex flex-col items-center gap-2">
        <button
          type="button"
          className="venue-button inline-flex max-w-full items-center gap-1.5 rounded-xl border border-blue-400/60 bg-slate-950/85 px-3 py-1.5 text-sm font-bold text-blue-100 transition hover:border-blue-300/50"
          onClick={() => setIsLocationModalOpen((open) => !open)}
          aria-expanded={isLocationModalOpen}
        >
          <MapPin size={14} className="shrink-0 text-emerald-400" aria-hidden="true" />
          <span className="truncate"><span className="text-emerald-400">at</span> {venue}</span>
          <CircleHelp size={14} className="shrink-0 text-slate-400" aria-hidden="true" />
        </button>

        {isLocationModalOpen && (
          <section
            className="venue-landmark-panel relative w-full rounded-xl border-t-2 border-blue-400 bg-slate-100 p-4 pr-10 text-center text-slate-900 shadow-2xl transition-all duration-200"
            aria-label="Venue landmark"
          >
            <button
              type="button"
              className="absolute right-2 top-2 rounded-full p-1 text-slate-400 transition hover:bg-slate-200 hover:text-slate-700"
              onClick={() => setIsLocationModalOpen(false)}
              aria-label="Close venue landmark"
            >
              <X size={17} aria-hidden="true" />
            </button>
            <h3 className="text-sm font-bold">Venue Landmark:</h3>
            <p className="mt-1 text-sm leading-5 text-slate-700">{landmark}</p>
          </section>
        )}

        {meetingUrl && <a className="seminar-meeting-link" href={meetingUrl} target="_blank" rel="noopener noreferrer" referrerPolicy="no-referrer"><ExternalLink size={16} aria-hidden="true" /><span>Join online seminar</span></a>}

        <button
          type="button"
          className="rounded-xl border border-slate-500/80 bg-slate-950/80 px-3 py-1.5 text-xs font-bold text-slate-100 shadow-[inset_0_1px_0_rgba(255,255,255,0.12)] transition hover:border-slate-300"
          onClick={() => setIsTurnoutOpen((open) => !open)}
          aria-expanded={isTurnoutOpen}
        >
          {attendeeCount} People are coming
        </button>
        {isTurnoutOpen && (
          <section className="turnout-panel w-full rounded-2xl border border-slate-600/80 bg-slate-950/95 px-3 py-3 text-center shadow-lg transition-all duration-200">
            {departmentAttendees > 0 && (
              <div className="department-turnout-cloud" role="status">
                <span className="department-turnout-cloud-point" aria-hidden="true" />
                {departmentAttendees} {departmentAttendees === 1 ? 'person' : 'people'} from {department || 'your department'} {eventState}
              </div>
            )}
            <h3 className="mb-2 text-[10px] font-bold tracking-[0.12em] text-cyan-200">
              FACULTY TURNOUT
            </h3>
            {turnout.length > 0 ? (
              <div className="flex flex-wrap justify-center gap-2">
                {turnout.map((item) => (
                  <FacultyBadge key={item.faculty} faculty={item.faculty} count={Number(item.count) || 0} />
                ))}
              </div>
            ) : (
              <p className="text-xs text-slate-400">Faculty turnout is not available yet.</p>
            )}
          </section>
        )}
      </div>

      <footer className="event-card-actions-grid">
        {readOnly ? (
          <div className="event-action-row event-action-row-share event-card-read-only-actions">
            {shareAction}
            <p>Sign in to mark Coming, set reminders, or report this event.</p>
          </div>
        ) : (
          <div className="event-action-row event-action-row-all">
            {shareAction}
            <button
              type="button"
              className={`event-action event-primary-action inline-flex items-center justify-center gap-2 rounded-full border px-3 text-sm font-bold transition ${
                isComing
                  ? 'is-coming border-red-300/80 bg-gradient-to-br from-red-500 to-orange-600 text-white shadow-[0_0_18px_rgba(239,68,68,.35)]'
                  : 'border-slate-600 bg-slate-800/80 text-slate-100 hover:border-orange-300/70 hover:text-orange-100'
              }`}
              onClick={handleComing}
              aria-pressed={isComing}
              aria-label={isComing ? `You are coming to ${title}; click to undo` : `Mark that you are coming to ${title}`}
            >
              <Flame size={17} aria-hidden="true" />
              <span>{isComing ? 'Coming!' : 'Coming?'}</span>
            </button>
            <button
              type="button"
              className={`event-action event-primary-action inline-flex items-center justify-center gap-2 rounded-full border px-3 text-sm font-bold transition ${
                isReminded
                  ? 'border-blue-400/50 bg-blue-500/20 text-blue-100'
                  : 'border-slate-600 bg-slate-800/80 text-slate-200 hover:border-blue-400/40'
              } ${showReminderNudge ? 'reminder-button-nudge' : ''}`}
              onClick={handleRemind}
              aria-pressed={isReminded}
              aria-describedby={showReminderNudge ? `event-reminder-hint-${eventId}` : undefined}
            >
              <Bell size={16} aria-hidden="true" />
              {isReminded ? 'Reminder Set' : 'Remind Me'}
            </button>
            <button
              type="button"
              className="event-action event-icon-action event-report-action"
              onClick={onReport}
              aria-label={`Report ${title}`}
              title="Report inappropriate event"
            >
              <TriangleAlert size={18} aria-hidden="true" />
            </button>
          </div>
        )}
      </footer>
      {showReminderNudge && <p id={`event-reminder-hint-${eventId}`} className="event-reminder-suggestion" role="status">Want a reminder? Tap Remind Me.</p>}
      {shareFeedback && <p className="px-1 text-center text-xs text-cyan-200" role="status">{shareFeedback}</p>}
    </article>
    </>
  )
}

export default EventCard
