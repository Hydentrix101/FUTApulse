import { Fragment, lazy, startTransition, Suspense, useCallback, useDeferredValue, useEffect, useMemo, useRef, useState } from 'react'
import {
  Bell, Building2, Check, ChevronLeft, ChevronRight, Clock3, Download, Eye, EyeOff, Flame, Heart, Home, LogOut,
  MapPin, Search, Shield, Sparkles, Trash2, User, X,
} from 'lucide-react'
import AuthScreen from './components/AuthScreen'
import CountdownPill from './components/CountdownPill'
import AdSlot from './components/AdSlot'
import LaunchAdGate from './components/LaunchAdGate'
import BrandHeart from './components/BrandHeart'
import { API_BASE_URL } from './config/api'

const EventCard = lazy(() => import('./components/EventCard'))
const EventEditor = lazy(() => import('./components/EventEditor'))
const ProfileSetupModal = lazy(() => import('./components/ProfileSetupModal'))
const ProfilePhotoCropper = lazy(() => import('./components/ProfilePhotoCropper'))

function LazyEventCard(props) {
  return <Suspense fallback={<div className="event-card-loading-placeholder" aria-hidden="true" />}><EventCard {...props} /></Suspense>
}

const CATEGORY_DATA = [
  { id: 'academic', label: 'Academic', className: 'category-academic', description: 'Study sessions and workshops' },
  { id: 'tech', label: 'Tech & Innovation', className: 'category-tech', description: 'Build, learn, and create' },
  { id: 'social', label: 'Social & Vibes', className: 'category-social', description: 'Find your campus people' },
  { id: 'religious', label: 'Religious & Fellowship', className: 'category-religious', description: 'Faith and fellowship' },
  { id: 'sports', label: 'Sports & Athletics', className: 'category-sports', description: 'Match days and tournaments' },
  { id: 'seminars', label: 'Seminars', className: 'category-seminars', description: 'Online talks and learning sessions' },
]
const NAV_ITEMS = [
  { id: 'home', label: 'Home', Icon: Home },
  { id: 'search', label: 'Explore', Icon: Search },
  { id: 'reminders', label: 'Reminders', Icon: Bell },
  { id: 'profile', label: 'Profile', Icon: User },
]
const FUTAPULSE_ADMIN_EMAIL = 'immanuelidowu1@gmail.com'
const EVENT_LIST_PAGE_SIZE = 12
const MAX_CACHED_EVENTS = 40
const MAX_EVENT_CACHE_CHARACTERS = 360_000
const REPORT_REASON_LABELS = {
  misleading: 'Misleading or false details',
  inappropriate: 'Inappropriate or harmful content',
  duplicate: 'Duplicate event',
  other: 'Other concern',
}

function readStored(key, fallback) {
  try {
    const value = JSON.parse(localStorage.getItem(key) || 'null')
    return value ?? fallback
  } catch {
    return fallback
  }
}

function readStoredValue(key, fallback = '') {
  try {
    return localStorage.getItem(key) ?? fallback
  } catch {
    return fallback
  }
}

function readInitialEventCache() {
  const cacheVersion = '3'
  if (readStoredValue('futapulse-events-cache-version') !== cacheVersion) {
    try {
      for (const key of Object.keys(localStorage)) {
        if (key === 'futapulse-events' || key === 'futapulse-organizer-events'
          || key === 'futapulse-auth-user' || key === 'futapulse-profile'
          || key.startsWith('futapulse-profile-')) localStorage.removeItem(key)
      }
      localStorage.setItem('futapulse-events-cache-version', cacheVersion)
    } catch {
      // The server remains the source of truth if browser storage is unavailable.
    }
    return []
  }
  const cachedEvents = readStored('futapulse-events', [])
  return Array.isArray(cachedEvents) ? cachedEvents.slice(0, MAX_CACHED_EVENTS) : []
}
const reportedStorageWriteFailures = new Set()

function safeSetStored(key, value) {
  try {
    localStorage.setItem(key, value)
    return true
  } catch (error) {
    if (!reportedStorageWriteFailures.has(key)) {
      reportedStorageWriteFailures.add(key)
      console.warn(`Could not save ${key} in browser storage.`, error)
    }
    return false
  }
}

function hasRememberedSession() {
  const rememberMe = readStoredValue('futapulse-remember-me')
  if (rememberMe === 'true') return true
  if (rememberMe === 'false') return false

  // Older releases used the remembered username as the persistence marker.
  if (!readStoredValue('futapulse-remembered-username')) return false
  safeSetStored('futapulse-remember-me', 'true')
  return true
}

function withoutInlineImages(value) {
  if (typeof value === 'string') return value.startsWith('data:image/') ? '' : value
  if (Array.isArray(value)) return value.map(withoutInlineImages)
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, withoutInlineImages(item)]))
  }
  return value
}

function storeEventCache(events) {
  const compactEvents = []
  let cacheCharacters = 2
  for (const event of (Array.isArray(events) ? events : []).slice(0, MAX_CACHED_EVENTS)) {
    const serializedEvent = JSON.stringify(withoutInlineImages(event))
    const nextSize = cacheCharacters + serializedEvent.length + (compactEvents.length ? 1 : 0)
    if (nextSize > MAX_EVENT_CACHE_CHARACTERS) break
    compactEvents.push(serializedEvent)
    cacheCharacters = nextSize
  }
  return safeSetStored('futapulse-events', `[${compactEvents.join(',')}]`)
}

async function compressEventBanner(file) {
  const sourceUrl = URL.createObjectURL(file)
  try {
    const image = new Image()
    await new Promise((resolve, reject) => {
      image.onload = resolve
      image.onerror = () => reject(new Error('Unable to open that event banner.'))
      image.src = sourceUrl
    })
    const scale = Math.min(1, 1280 / Math.max(image.naturalWidth, image.naturalHeight))
    const canvas = document.createElement('canvas')
    canvas.width = Math.max(1, Math.round(image.naturalWidth * scale))
    canvas.height = Math.max(1, Math.round(image.naturalHeight * scale))
    const context = canvas.getContext('2d')
    if (!context) throw new Error('Your phone could not prepare this banner. Try another image.')
    context.drawImage(image, 0, 0, canvas.width, canvas.height)
    const blob = await new Promise((resolve) => canvas.toBlob(resolve, 'image/webp', 0.78))
    if (!blob) throw new Error('Unable to prepare this banner. Try another image.')
    if (blob.size > 600 * 1024) throw new Error('This banner is still too large after compression. Choose a smaller image.')
    const dataUrl = await new Promise((resolve, reject) => {
      const reader = new FileReader()
      reader.onload = () => resolve(reader.result)
      reader.onerror = () => reject(new Error('Unable to read the compressed banner.'))
      reader.readAsDataURL(blob)
    })
    return String(dataUrl)
  } finally {
    URL.revokeObjectURL(sourceUrl)
  }
}
function getEventId(event) {
  return event.id ?? event._id
}

function syncEventOrganizerProfile(event, user, profile) {
  if (String(event.createdByUserId || '') !== String(user?.id || '')) return event
  return {
    ...event,
    organizerName: profile.name || user.username,
    organizerUsername: user.username,
    organizerFaculty: profile.faculty || '',
    organizerPicture: profile.picture || `/Faculty%20Logo/${encodeURIComponent(profile.faculty || 'SEET')}.png`,
  }
}

function isValidNewPassword(password) {
  return password.length > 6 && /[A-Z]/.test(password) && /\d/.test(password)
}

function getCurrentTimestamp() {
  return Date.now()
}

function getStartTime(event) {
  const time = typeof event.startTime === 'string' ? event.startTime.trim() : ''
  if (time && /^\d{1,2}:\d{2}(:\d{2})?$/.test(time) && event.date) {
    return `${String(event.date).slice(0, 10)}T${time.length === 5 ? `${time}:00` : time}`
  }
  return time || event.date
}

function hasEventEnded(event, now = Date.now()) {
  const endTime = Date.parse(event?.endTime || '')
  return Number.isFinite(endTime) && endTime <= now
}

function isWithinEventDisplayWindow(event, now = Date.now()) {
  const startTime = Date.parse(getStartTime(event) || '')
  const endTime = Date.parse(event?.endTime || '')
  return Number.isFinite(startTime)
    && Number.isFinite(endTime)
    && endTime > startTime
    && endTime + (30 * 60 * 1000) > now
}

function formatEventTimeRange(event) {
  const start = new Date(getStartTime(event))
  const end = new Date(event.endTime)
  if (!Number.isFinite(start.getTime())) return ''
  const dateLabel = start.toLocaleDateString([], { month: 'short', day: 'numeric' })
  const startLabel = start.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })
  if (!Number.isFinite(end.getTime())) return `${dateLabel} · ${startLabel}`
  const endDateLabel = end.toLocaleDateString([], { month: 'short', day: 'numeric' })
  const endLabel = end.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })
  return `${dateLabel} · ${startLabel}–${dateLabel === endDateLabel ? endLabel : `${endDateLabel} · ${endLabel}`}`
}

function getHotScore(event) {
  const rsvps = Number(event.rsvpCount ?? event.turnoutCount) || 0
  const reminders = Number(event.reminderCount) || 0
  const flames = Number(event.flameCount ?? event.hypeCount) || 0
  return (rsvps * 2) + (reminders * 3) + flames
}

function matchesProfileAudience(event, profile) {
  if (!profile?.level) return true
  const audience = Array.isArray(event.audience) ? event.audience : String(event.audience || 'all').split(',').map((item) => item.trim())
  return audience.includes('all') || audience.includes(String(profile.level))
}

async function apiRequest(endpoint, options = {}, token = '') {
  const { timeoutMs = 45000, ...requestOptions } = options
  let response
  try {
    response = await fetch(`${API_BASE_URL}${endpoint}`, {
      ...requestOptions,
      credentials: 'include',
      headers: {
        ...(options.body ? { 'Content-Type': 'application/json' } : {}),
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
        ...(options.headers || {}),
      },
      signal: requestOptions.signal || AbortSignal.timeout(timeoutMs),
    })
  } catch (error) {
    if (error.name === 'TimeoutError' || error.name === 'AbortError') {
      throw new Error('FUTApulse did not confirm this request in time. Check the feed before retrying.', { cause: error })
    }
    throw error
  }
  const result = await response.json().catch(() => ({}))
  if (!response.ok) {
    const error = new Error(result.error || `Request failed (${response.status}).`)
    error.status = response.status
    error.code = result.code
    error.matches = Array.isArray(result.matches) ? result.matches : []
    throw error
  }
  return result
}

function EventPreview({ event, reminded, hyped, onOpen, onHype, onRemind, onRsvp, homeVariant = '' }) {
  const category = CATEGORY_DATA.find((item) => item.id === event.category)
  const [avatarFailed, setAvatarFailed] = useState(false)
  const [bannerFailed, setBannerFailed] = useState(false)
  const fallback = `/Faculty%20Logo/${encodeURIComponent(event.organizerFaculty || event.faculty || 'SEET')}.png`

  return (
    <article className={`event-card-preview ${event.category || 'social'}-platform ${homeVariant ? `home-preview ${homeVariant}` : ''}`} onClick={onOpen} onKeyDown={(keyEvent) => {
      if (keyEvent.key === 'Enter' || keyEvent.key === ' ') {
        keyEvent.preventDefault()
        onOpen()
      }
    }} tabIndex={0} role="button" aria-label={`Event preview for ${event.title}`}>
      {homeVariant === 'home-featured-preview' ? (
        <>
          <div className="home-featured-banner" style={event.banner || event.image ? { backgroundImage: `linear-gradient(90deg, rgba(2,6,23,.94), rgba(2,6,23,.64) 54%, rgba(2,6,23,.22)), url("${event.banner || event.image}")` } : undefined}>
            <span className="preview-category-badge">{category?.label || String(event.category || 'EVENT').toUpperCase()}</span>
            <div className="home-preview-organizer">
            <span className="organizer-micro-avatar">{avatarFailed ? <Building2 size={16} /> : <img loading="lazy" decoding="async" src={event.organizerPicture || fallback} alt="" onError={(error) => { const image = error.currentTarget; if (image.dataset.fallback) { setAvatarFailed(true); return } image.dataset.fallback = 'true'; image.src = fallback }} />}</span>
              <span className="home-organizer-name">{event.organizerName || event.organizer?.name || 'Campus Organizer'}</span>
            </div>
            <h3 className="preview-title">{event.title}</h3>
            <span className="home-featured-venue"><MapPin size={13} /> {event.venue || 'Venue TBA'}</span>
            <div className="home-featured-meta"><CountdownPill startTime={getStartTime(event)} endTime={event.endTime} /><span><Clock3 size={12} /> {formatEventTimeRange(event)}</span></div>
            <div className="home-featured-attendance" aria-label={`People coming: ${Number(event.turnoutCount ?? event.attendeeCount ?? event.rsvpCount) || 0}`}><strong>{Number(event.turnoutCount ?? event.attendeeCount ?? event.rsvpCount) || 0}</strong><span>People are coming</span></div>
          </div>
        </>
      ) : homeVariant === 'home-category-preview' ? (
        <>
          <div className="home-category-banner">
            {bannerFailed || !(event.banner || event.image) ? <span className="preview-fallback"><Sparkles size={24} /></span> : <img loading="lazy" decoding="async" src={event.banner || event.image} alt="" onError={() => setBannerFailed(true)} />}
            <span className="home-preview-organizer"><span className="organizer-micro-avatar">{avatarFailed ? <Building2 size={14} /> : <img loading="lazy" decoding="async" src={event.organizerPicture || fallback} alt="" onError={(error) => { const image = error.currentTarget; if (image.dataset.fallback) { setAvatarFailed(true); return } image.dataset.fallback = 'true'; image.src = fallback }} />}</span><span className="home-organizer-name">{event.organizerName || event.organizer?.name || 'Campus Organizer'}</span></span>
            <span className="home-category-countdown"><CountdownPill startTime={getStartTime(event)} endTime={event.endTime} /></span>
          </div>
          <h3 className="preview-title">{event.title}</h3>
          <span className="home-category-venue"><MapPin size={11} /> {event.venue || 'Venue TBA'}</span>
          <p className="home-category-attendance">People coming: <strong>{Number(event.turnoutCount ?? event.attendeeCount ?? event.rsvpCount) || 0}</strong></p>
        </>
      ) : <>
      <span className="preview-category-badge">{category?.label || String(event.category || 'EVENT').toUpperCase()}</span>
      <div className="preview-heading">
        <span className="organizer-micro-avatar">
          {avatarFailed ? <Building2 size={16} /> : <img loading="lazy" decoding="async" src={event.organizerPicture || fallback} alt="" onError={(error) => {
            const image = error.currentTarget
            if (image.dataset.fallback) {
              setAvatarFailed(true)
              return
            }
            image.dataset.fallback = 'true'
            image.src = fallback
          }} />}
        </span>
        <div className="min-w-0">
          <h3 className="preview-title">{event.title}</h3>
          <p>{event.organizerName || event.organizer?.name || 'Campus Organizer'}</p>
        </div>
      </div>
      <div className="preview-content">
        <div className="preview-thumbnail">
          {bannerFailed || !(event.banner || event.image) ? (
            <span className="preview-fallback"><Sparkles size={22} /></span>
          ) : (
            <img loading="lazy" decoding="async" src={event.banner || event.image} alt="" onError={() => setBannerFailed(true)} />
          )}
        </div>
        <div className="preview-info">
          <span className="preview-location"><MapPin size={12} /> {event.venue || 'Venue TBA'}</span>
          <span className="preview-time-range"><Clock3 size={12} /> {formatEventTimeRange(event)}</span>
          <CountdownPill startTime={getStartTime(event)} endTime={event.endTime} />
          <div className="preview-actions">
            <button type="button" className={`preview-action hype ${hyped ? 'is-active' : ''}`} disabled={hyped} aria-label="Hype event" onClick={(clickEvent) => { clickEvent.stopPropagation(); onHype() }}>
              <Flame size={15} /> <span>{Number(event.flameCount ?? event.hypeCount) || 0}</span>
            </button>
            <button type="button" className={`preview-action rsvp ${event.isGoing ? 'is-active' : ''}`} aria-label="Toggle attending" aria-pressed={Boolean(event.isGoing)} onClick={(clickEvent) => { clickEvent.stopPropagation(); onRsvp() }}>
              <span>＋</span>
            </button>
            <button type="button" className={`preview-action reminder ${reminded ? 'is-active' : ''}`} aria-label={reminded ? 'Turn reminder off' : 'Turn reminder on'} aria-pressed={reminded} onClick={(clickEvent) => { clickEvent.stopPropagation(); onRemind() }}>
              <Bell size={14} />
            </button>
          </div>
        </div>
      </div>
      </>}
    </article>
  )
}

function App() {
  const hasSharedEventLink = new URLSearchParams(window.location.search).has('event')
  const [launchVisible, setLaunchVisible] = useState(true)
  const [launchSequenceReady, setLaunchSequenceReady] = useState(false)
  const [isLaunchAdActive, setIsLaunchAdActive] = useState(false)
  const [session, setSession] = useState(null)
  const [sessionLoading, setSessionLoading] = useState(true)
  const [user, setUser] = useState(null)
  const [guestSignInRequested, setGuestSignInRequested] = useState(false)
  const isGuestSharedView = hasSharedEventLink && (!session?.token || !user) && !guestSignInRequested
  const [profile, setProfile] = useState(null)
  const [profileOpen, setProfileOpen] = useState(false)
  const [profileSaving, setProfileSaving] = useState(false)
  const [hasDeviceAccount, setHasDeviceAccount] = useState(() => {
    const knownAccounts = readStored('futapulse-known-accounts', [])
    return Boolean((Array.isArray(knownAccounts) && knownAccounts.length) || readStoredValue('futapulse-remembered-username'))
  })
  const [activeTab, setActiveTab] = useState(() => new URLSearchParams(window.location.search).has('event')
    ? 'home'
    : window.location.hash.replace('#', '') || 'home')
  const [events, setEvents] = useState([])
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState('')
  const [theme, setTheme] = useState(() => readStoredValue('futapulse-theme') || readStoredValue('futapulse-client-theme') || 'light')
  const [homeCategory, setHomeCategory] = useState('all')
  const [expandedHomeCategory, setExpandedHomeCategory] = useState('')
  const [pendingFullEventId, setPendingFullEventId] = useState('')
  const homeSectionRefs = useRef({})
  const categoryFilterBarRef = useRef(null)
  const categoryFilterButtonRefs = useRef({})
  const skipFilterAutoCenterRef = useRef(false)
  const hotCarouselRef = useRef(null)
  const reminderCarouselRefs = useRef({})
  const autoScrollResumeTimersRef = useRef({})
  const [pausedAutoScrollTracks, setPausedAutoScrollTracks] = useState({})
  const [documentVisible, setDocumentVisible] = useState(() => !document.hidden)
  const handledSharedEventId = useRef('')
  const [search, setSearch] = useState('')
  const [searchFocused, setSearchFocused] = useState(false)
  const [recentSearches, setRecentSearches] = useState(() => {
    const savedSearches = readStored('futapulse-recent-searches', [])
    return Array.isArray(savedSearches) ? savedSearches.filter((item) => typeof item === 'string').slice(0, 6) : []
  })
  const [reminderIds, setReminderIds] = useState([])
  const [goingIds, setGoingIds] = useState([])
  const [reminderTimes, setReminderTimes] = useState(() => {
    const stored = readStored('futapulse-reminders', {})
    return stored && typeof stored === 'object' && !Array.isArray(stored)
      ? Object.fromEntries(Object.entries(stored).slice(-500))
      : {}
  })
  const [reminderClock, setReminderClock] = useState(() => Date.now())
  const [feedClock, setFeedClock] = useState(() => Date.now())
  const [clockNow, setClockNow] = useState(() => Date.now())
  const onlineEngagementsInFlight = useRef(new Set())
  const [engagementQueue, setEngagementQueue] = useState(() => {
    const queued = readStored('futapulse-engagement-sync-queue', [])
    return Array.isArray(queued)
      ? queued.filter((action) => action && typeof action.actionId === 'string'
        && typeof action.eventId === 'string' && action.type === 'reminder'
        && typeof action.accountId === 'string' && typeof action.enabled === 'boolean').slice(-100)
      : []
  })
  const [networkOnline, setNetworkOnline] = useState(() => navigator.onLine)
  const [engagementRetryTick, setEngagementRetryTick] = useState(0)
  const [reminderTarget, setReminderTarget] = useState(null)
  const [detailEvent, setDetailEvent] = useState(null)
  const [reportTarget, setReportTarget] = useState(null)
  const [reportReason, setReportReason] = useState('inappropriate')
  const [reportDetails, setReportDetails] = useState('')
  const [reportSending, setReportSending] = useState(false)
  const [guidelinesOpen, setGuidelinesOpen] = useState(false)
  const [guidelinesSaving, setGuidelinesSaving] = useState(false)
  const [reportReviewCases, setReportReviewCases] = useState([])
  const [reportReviewBusyId, setReportReviewBusyId] = useState('')
  const [activeEventAlert, setActiveEventAlert] = useState(null)
  const [profileMenuOpen, setProfileMenuOpen] = useState(false)
  const [settingsPage, setSettingsPage] = useState('menu')
  const [notifications, setNotifications] = useState(() => readStored('futapulse-notification-preferences', { reminders: true, updates: true }))
  const [organizerTab, setOrganizerTab] = useState('events')
  const organizerTouchStart = useRef(null)
  const [eventDeleteTarget, setEventDeleteTarget] = useState(null)
  const [eventDeleting, setEventDeleting] = useState(false)
  const [eventEditor, setEventEditor] = useState(null)
  const [visibleFullFeedCount, setVisibleFullFeedCount] = useState(EVENT_LIST_PAGE_SIZE)
  const [visibleSearchCount, setVisibleSearchCount] = useState(EVENT_LIST_PAGE_SIZE)
  const [visibleOrganizerCount, setVisibleOrganizerCount] = useState(EVENT_LIST_PAGE_SIZE)
  const [visibleReportCount, setVisibleReportCount] = useState(8)
  const [visibleAnticipatingCount, setVisibleAnticipatingCount] = useState(EVENT_LIST_PAGE_SIZE)
  const [visibleReminderCount, setVisibleReminderCount] = useState(EVENT_LIST_PAGE_SIZE)
  const [eventDuplicateState, setEventDuplicateState] = useState({ code: '', matches: [] })
  const [eventSaving, setEventSaving] = useState(false)
  const [toast, setToast] = useState(null)
  const [feedbackTab, setFeedbackTab] = useState('bug')
  const [avatarUploading, setAvatarUploading] = useState(false)
  const [avatarPhotoSource, setAvatarPhotoSource] = useState('')
  const [profileAvatarFailed, setProfileAvatarFailed] = useState(false)
  const [rememberedUsername, setRememberedUsername] = useState(readStoredValue('futapulse-remembered-username'))
  const [facultyLogoOpen, setFacultyLogoOpen] = useState(false)
  const [failedFacultyLogo, setFailedFacultyLogo] = useState('')
  const [securityAction, setSecurityAction] = useState('')
  const [emailChangePending, setEmailChangePending] = useState(false)
  const [pendingNewEmail, setPendingNewEmail] = useState('')
  const [feedbackSending, setFeedbackSending] = useState(false)
  const isFutapulseAdmin = Boolean(user?.emailVerified && String(user.email || '').toLowerCase() === FUTAPULSE_ADMIN_EMAIL)
  const toastTimer = useRef(null)
  const alarmAudioContextRef = useRef(null)
  const alarmSoundTimerRef = useRef(null)
  const avatarInput = useRef(null)
  const eventBannerInput = useRef(null)
  const engagementInFlight = useRef(false)

  const notify = useCallback((message, type = 'info') => {
    setToast({ message, type })
    window.clearTimeout(toastTimer.current)
    toastTimer.current = window.setTimeout(() => setToast(null), 3600)
  }, [])

  const pauseAutoScroll = useCallback((trackId) => {
    window.clearTimeout(autoScrollResumeTimersRef.current[trackId])
    setPausedAutoScrollTracks((current) => current[trackId] ? current : { ...current, [trackId]: true })
  }, [])

  const resumeAutoScroll = useCallback((trackId) => {
    window.clearTimeout(autoScrollResumeTimersRef.current[trackId])
    autoScrollResumeTimersRef.current[trackId] = window.setTimeout(() => {
      setPausedAutoScrollTracks((current) => current[trackId] ? { ...current, [trackId]: false } : current)
      delete autoScrollResumeTimersRef.current[trackId]
    }, 6500)
  }, [])

  const autoScrollInteractionProps = (trackId) => ({
    onPointerEnter: (event) => { if (event.pointerType === 'mouse') pauseAutoScroll(trackId) },
    onPointerLeave: (event) => { if (event.pointerType === 'mouse' && !event.buttons) resumeAutoScroll(trackId) },
    onPointerDown: () => pauseAutoScroll(trackId),
    onPointerUp: (event) => { if (event.pointerType !== 'mouse' || !event.currentTarget.matches(':hover')) resumeAutoScroll(trackId) },
    onPointerCancel: (event) => { if (event.pointerType === 'mouse') resumeAutoScroll(trackId) },
    onTouchStart: () => pauseAutoScroll(trackId),
    onTouchEnd: () => resumeAutoScroll(trackId),
    onTouchCancel: () => resumeAutoScroll(trackId),
    onWheel: () => { pauseAutoScroll(trackId); resumeAutoScroll(trackId) },
    onFocusCapture: () => pauseAutoScroll(trackId),
    onBlurCapture: (event) => { if (!event.currentTarget.contains(event.relatedTarget)) resumeAutoScroll(trackId) },
  })

  useEffect(() => () => {
    Object.values(autoScrollResumeTimersRef.current).forEach((timer) => window.clearTimeout(timer))
  }, [])

  const eventExpiryScheduleKey = events.map((event) => `${getEventId(event)}:${event.endTime || ''}`).join('|')
  const feedExpiryEventsRef = useRef(events)
  useEffect(() => { feedExpiryEventsRef.current = events }, [events])

  useEffect(() => {
    const updateVisibility = () => setDocumentVisible(!document.hidden)
    document.addEventListener('visibilitychange', updateVisibility)
    return () => document.removeEventListener('visibilitychange', updateVisibility)
  }, [])

  const primeAlarmAudio = useCallback(() => {
    const AudioContextConstructor = window.AudioContext || window.webkitAudioContext
    if (!AudioContextConstructor) return
    try {
      if (!alarmAudioContextRef.current || alarmAudioContextRef.current.state === 'closed') {
        alarmAudioContextRef.current = new AudioContextConstructor()
      }
      if (alarmAudioContextRef.current.state === 'suspended') {
        void alarmAudioContextRef.current.resume().catch(() => {})
      }
    } catch (error) {
      console.warn('Alarm audio is unavailable in this browser.', error)
    }
  }, [])

  const playAlarmTone = useCallback(() => {
    const audioContext = alarmAudioContextRef.current
    if (!audioContext || audioContext.state !== 'running') return
    const tones = [880, 660, 880]
    tones.forEach((frequency, index) => {
      const startAt = audioContext.currentTime + (index * 0.34)
      const oscillator = audioContext.createOscillator()
      const gain = audioContext.createGain()
      oscillator.type = 'sine'
      oscillator.frequency.setValueAtTime(frequency, startAt)
      gain.gain.setValueAtTime(0.001, startAt)
      gain.gain.linearRampToValueAtTime(0.2, startAt + 0.035)
      gain.gain.exponentialRampToValueAtTime(0.001, startAt + 0.26)
      oscillator.connect(gain)
      gain.connect(audioContext.destination)
      oscillator.start(startAt)
      oscillator.stop(startAt + 0.28)
    })
  }, [])

  const stopAlarmRingtone = useCallback(() => {
    window.clearInterval(alarmSoundTimerRef.current)
    alarmSoundTimerRef.current = null
  }, [])

  const startAlarmRingtone = useCallback(() => {
    stopAlarmRingtone()
    playAlarmTone()
    alarmSoundTimerRef.current = window.setInterval(playAlarmTone, 4200)
  }, [playAlarmTone, stopAlarmRingtone])

  useEffect(() => () => {
    window.clearInterval(alarmSoundTimerRef.current)
    alarmAudioContextRef.current?.close().catch(() => {})
  }, [])

  const closeEventDetail = useCallback(() => {
    stopAlarmRingtone()
    setActiveEventAlert(null)
    setDetailEvent(null)
  }, [stopAlarmRingtone, setActiveEventAlert, setDetailEvent])

  const requestEventNotificationPermission = useCallback(() => {
    if (!('Notification' in window)) {
      return
    }
    if (Notification.permission !== 'default') {
      return
    }
    try {
      void Notification.requestPermission()
        .catch((error) => console.warn('Unable to request notification permission.', error))
    } catch (error) {
      console.warn('Unable to request notification permission.', error)
    }
  }, [])

  const rememberSearch = useCallback((value) => {
    const query = String(value || '').trim().replace(/\s+/g, ' ')
    if (!query) return
    setRecentSearches((current) => {
      const next = [query, ...current.filter((item) => item.toLowerCase() !== query.toLowerCase())].slice(0, 6)
      safeSetStored('futapulse-recent-searches', JSON.stringify(next))
      return next
    })
  }, [])

  const syncOwnedEventsProfile = (owner, nextProfile) => {
    setEvents((current) => current.map((event) => syncEventOrganizerProfile(event, owner, nextProfile)))
  }

  const persistSession = useCallback((auth, remember = false) => {
    const nextSession = { token: auth.token, user: auth.user }
    setSession(nextSession)
    setUser(auth.user)
    const nextProfile = auth.user.profile || null
    setProfile(nextProfile)
    localStorage.removeItem('futapulse-auth-session')
    sessionStorage.removeItem('futapulse-auth-session')
    const knownAccounts = readStored('futapulse-known-accounts', [])
    const accounts = Array.isArray(knownAccounts) ? knownAccounts : []
    safeSetStored('futapulse-known-accounts', JSON.stringify([...new Set([...accounts, auth.user.username])].slice(-10)))
    setHasDeviceAccount(true)
    if (remember) {
      safeSetStored('futapulse-remember-me', 'true')
      safeSetStored('futapulse-remembered-username', auth.user.username)
      setRememberedUsername(auth.user.username)
    } else {
      safeSetStored('futapulse-remember-me', 'false')
      localStorage.removeItem('futapulse-remembered-username')
      setRememberedUsername('')
    }
    setSessionLoading(false)
  }, [])

  const logout = useCallback(() => {
    fetch(`${API_BASE_URL}/api/auth/logout`, { method: 'POST', credentials: 'include' })
      .catch((error) => console.error('Unable to clear the server session cookie.', error))
    localStorage.removeItem('futapulse-auth-session')
    localStorage.removeItem('futapulse-auth-user')
    localStorage.removeItem('futapulse-remember-me')
    localStorage.removeItem('futapulse-remembered-username')
    localStorage.removeItem('futapulse-profile')
    sessionStorage.removeItem('futapulse-auth-session')
    setSession(null)
    setUser(null)
    setProfile(null)
    setProfileMenuOpen(false)
    setProfileOpen(false)
    notify('You have been logged out.')
  }, [notify, setProfileMenuOpen])

  useEffect(() => {
    let splashFrame = 0
    let adFrame = 0
    const timer = window.setTimeout(() => {
      setLaunchVisible(false)
      splashFrame = window.requestAnimationFrame(() => {
        setLaunchSequenceReady(true)
        adFrame = window.requestAnimationFrame(() => setIsLaunchAdActive(true))
      })
    }, 2500)
    return () => {
      window.clearTimeout(timer)
      if (splashFrame) window.cancelAnimationFrame(splashFrame)
      if (adFrame) window.cancelAnimationFrame(adFrame)
    }
  }, [])

  useEffect(() => {
    const timer = window.setTimeout(() => {
      const cachedEvents = readInitialEventCache()
      startTransition(() => setEvents((current) => current.length ? current : cachedEvents))
    }, 0)
    return () => window.clearTimeout(timer)
  }, [])

  useEffect(() => {
    if (!facultyLogoOpen) return undefined
    const previousOverflow = document.body.style.overflow
    const closeOnEscape = (event) => {
      if (event.key === 'Escape') setFacultyLogoOpen(false)
    }
    document.body.style.overflow = 'hidden'
    window.addEventListener('keydown', closeOnEscape)
    return () => {
      document.body.style.overflow = previousOverflow
      window.removeEventListener('keydown', closeOnEscape)
    }
  }, [facultyLogoOpen])

  useEffect(() => {
    const updateOnlineStatus = () => setNetworkOnline(navigator.onLine)
    window.addEventListener('online', updateOnlineStatus)
    window.addEventListener('offline', updateOnlineStatus)
    return () => {
      window.removeEventListener('online', updateOnlineStatus)
      window.removeEventListener('offline', updateOnlineStatus)
    }
  }, [])

  useEffect(() => {
    safeSetStored('futapulse-engagement-sync-queue', JSON.stringify(engagementQueue))
    const accountId = String(session?.user?.id || '')
    const action = accountId ? engagementQueue.find((item) => item.accountId === accountId) : null
    if (!networkOnline || !session?.token || !action || engagementInFlight.current) return undefined

    const waitMs = Math.max(0, Number(action.nextAttemptAt) - Date.now())
    if (waitMs > 0) {
      const retryTimer = window.setTimeout(() => setEngagementRetryTick((tick) => tick + 1), waitMs)
      return () => window.clearTimeout(retryTimer)
    }

    engagementInFlight.current = true
    apiRequest(`/api/events/${encodeURIComponent(action.eventId)}/engagement`, {
      method: 'PATCH',
      body: JSON.stringify({ type: action.type, enabled: action.enabled }),
    }, session.token).then((result) => {
      if (result.event) {
        setEvents((current) => current.map((event) => String(getEventId(event)) === String(action.eventId)
          ? { ...event, ...result.event }
          : event))
        if (action.type === 'reminder') {
          setReminderIds((current) => result.event.isReminded
            ? [...new Set([...current, String(action.eventId)])]
            : current.filter((item) => item !== String(action.eventId)))
        }
      }
      setEngagementQueue((current) => current.filter((item) => item.actionId !== action.actionId))
    }).catch((error) => {
      if (error.status && error.status < 500 && error.status !== 408 && error.status !== 429) {
        console.error('The server rejected a queued engagement update.', error)
        notify(`An event update could not be synced: ${error.message}`, 'error')
        setEngagementQueue((current) => current.filter((item) => item.actionId !== action.actionId))
        return
      }
      const attempts = (Number(action.attempts) || 0) + 1
      const baseDelay = Math.min(60_000, 1000 * (2 ** Math.min(attempts - 1, 6)))
      const retryDelay = baseDelay + Math.floor(Math.random() * baseDelay * 0.25)
      console.warn(`Unable to sync ${action.type} engagement; it remains queued for retry.`, error)
      setEngagementQueue((current) => current.map((item) => item.actionId === action.actionId
        ? { ...item, attempts, nextAttemptAt: Date.now() + retryDelay }
        : item))
    }).finally(() => {
      engagementInFlight.current = false
    })

    return undefined
  }, [engagementQueue, networkOnline, engagementRetryTick, notify, session?.token, session?.user?.id])

  useEffect(() => {
    const controller = new AbortController()
    const restoreSession = async () => {
      if (!hasRememberedSession()) {
        setSessionLoading(false)
        return
      }
      try {
        const response = await fetch(`${API_BASE_URL}/api/auth/refresh`, {
          method: 'POST',
          credentials: 'include',
          signal: controller.signal,
        })
        if (response.status === 401) {
          safeSetStored('futapulse-remember-me', 'false')
          localStorage.removeItem('futapulse-remembered-username')
          setRememberedUsername('')
          return
        }
        const result = await response.json().catch(() => ({}))
        if (!response.ok) throw new Error(result.error || `Session restore failed (${response.status}).`)
        if (!result.token || !result.user) throw new Error('The server returned an incomplete session.')
        setSession({ token: result.token, user: result.user })
        setUser(result.user)
        setProfile(result.user.profile || null)
        setRememberedUsername(result.user.username || '')
        safeSetStored('futapulse-remember-me', 'true')
        safeSetStored('futapulse-remembered-username', result.user.username || '')
        setHasDeviceAccount(true)
        setProfileOpen(!result.user.profile || !['name', 'faculty', 'department', 'level'].every((field) => result.user.profile[field]))
      } catch (error) {
        if (!controller.signal.aborted) {
          console.warn('Unable to restore the FUTApulse session.', error)
          notify('We could not restore your session. Sign in again when the server is available.', 'error')
        }
      } finally {
        if (!controller.signal.aborted) setSessionLoading(false)
      }
    }
    restoreSession()
    return () => controller.abort()
  }, [notify])

  useEffect(() => {
    if (!session?.token) return undefined
    const refreshTimer = window.setInterval(async () => {
      try {
        const response = await fetch(`${API_BASE_URL}/api/auth/refresh`, { method: 'POST', credentials: 'include' })
        if (response.status === 401) {
          logout()
          return
        }
        const result = await response.json().catch(() => ({}))
        if (!response.ok || !result.token || !result.user) throw new Error(result.error || 'Session refresh was not confirmed.')
        setSession({ token: result.token, user: result.user })
      } catch (error) {
        console.warn('Unable to refresh the active FUTApulse session.', error)
      }
    }, 10 * 60 * 1000)
    return () => window.clearInterval(refreshTimer)
  }, [session?.token, logout])

  useEffect(() => {
    if (!session?.token || !isFutapulseAdmin) return undefined
    const controller = new AbortController()
    apiRequest('/api/admin/event-reports', { signal: controller.signal }, session.token)
      .then((result) => {
        setReportReviewCases(Array.isArray(result.reports) ? result.reports : [])
      })
      .catch((error) => {
        if (controller.signal.aborted) return
        setReportReviewCases([])
        if (error.status !== 403) console.error('Unable to load event report review cases.', error)
      })
    return () => controller.abort()
  }, [session?.token, isFutapulseAdmin])

  useEffect(() => {
    if (!session?.token || !profile || !['name', 'faculty', 'department', 'level'].every((key) => profile[key])) return
    const timer = window.setTimeout(() => setGuidelinesOpen(!profile.communityGuidelinesAcceptedAt), 0)
    return () => window.clearTimeout(timer)
  }, [session?.token, profile, user?.id, user?.email])

  useEffect(() => {
    if (!session?.token || (profile && ['name', 'faculty', 'department', 'level'].every((key) => profile[key]))) return
    const timeout = window.setTimeout(() => setProfileOpen(true), 0)
    return () => window.clearTimeout(timeout)
  }, [session?.token, profile])

  useEffect(() => {
    if (window.location.hash !== `#${activeTab}`) {
      window.history.replaceState({}, '', `${window.location.pathname}${window.location.search}#${activeTab}`)
    }
  }, [activeTab])

  useEffect(() => {
    const controller = new AbortController()
    const loadEvents = async () => {
      setLoading(true)
      setLoadError('')
      try {
        const response = await fetch(`${API_BASE_URL}/api/events`, {
          signal: controller.signal,
          headers: session?.token ? { Authorization: `Bearer ${session.token}` } : {},
          cache: 'no-cache',
        })
        if (!response.ok) throw new Error(`Could not load events (${response.status}).`)
        const data = await response.json()
        if (!Array.isArray(data.events)) throw new Error('The events endpoint returned an invalid response.')
        const serverEvents = data.events
        startTransition(() => setEvents(serverEvents))
        const serverGoingIds = serverEvents.filter((event) => event.isGoing).map((event) => String(getEventId(event)))
        setGoingIds((current) => current.join('|') === serverGoingIds.join('|') ? current : serverGoingIds)
        setReminderIds(serverEvents.filter((event) => event.isReminded).map((event) => String(getEventId(event))))
        storeEventCache(serverEvents)
      } catch (error) {
        if (error.name !== 'AbortError') {
          console.error('Unable to load campus events.', error)
          setLoadError('Campus events could not be loaded. Check your connection and try again.')
        }
      } finally {
        if (!controller.signal.aborted) setLoading(false)
      }
    }
    loadEvents()
    return () => controller.abort()
  }, [session?.token, session?.user?.id])

  useEffect(() => {
    let timer
    const scheduleFeedExpiry = () => {
      window.clearTimeout(timer)
      const now = Date.now()
      setFeedClock(now)
      setReminderClock(now)
      const nextExpiry = feedExpiryEventsRef.current
        .flatMap((event) => {
          const endTime = Date.parse(event.endTime || '')
          return Number.isFinite(endTime) ? [endTime, endTime + (30 * 60 * 1000)] : []
        })
        .filter((boundary) => boundary > now)
        .sort((first, second) => first - second)[0]
      timer = window.setTimeout(scheduleFeedExpiry, nextExpiry ? nextExpiry - now : 60_000)
    }
    scheduleFeedExpiry()
    document.addEventListener('visibilitychange', scheduleFeedExpiry)
    return () => {
      window.clearTimeout(timer)
      document.removeEventListener('visibilitychange', scheduleFeedExpiry)
    }
  }, [eventExpiryScheduleKey])

  useEffect(() => {
    if (!networkOnline || !documentVisible) return undefined
    let cancelled = false
    let refreshing = false
    const refreshLiveEvents = async () => {
      if (refreshing) return
      refreshing = true
      try {
        const response = await fetch(`${API_BASE_URL}/api/events/engagement`, {
          headers: session?.token ? { Authorization: `Bearer ${session.token}` } : {},
          signal: AbortSignal.timeout(8_000),
        })
        if (!response.ok) return
        const data = await response.json()
        if (cancelled || !Array.isArray(data.updates)) return
        const updatesById = new Map(data.updates.map((event) => [String(getEventId(event)), event]))
        const activeIds = new Set(updatesById.keys())
        startTransition(() => setEvents((current) => current
          .filter((event) => event.status === 'Draft' || activeIds.has(String(getEventId(event))))
          .map((event) => ({ ...event, ...(updatesById.get(String(getEventId(event))) || {}) }))))
        const serverGoingIds = data.updates.filter((event) => event.isGoing).map((event) => String(getEventId(event)))
        setGoingIds((current) => current.join('|') === serverGoingIds.join('|') ? current : serverGoingIds)
        setReminderIds(data.updates.filter((event) => event.isReminded).map((event) => String(getEventId(event))))

      } catch {
        // A failed refresh never overwrites the last confirmed server snapshot.
      } finally {
        refreshing = false
      }
    }
    const timer = window.setInterval(refreshLiveEvents, 10_000)
    return () => {
      cancelled = true
      window.clearInterval(timer)
    }
  }, [networkOnline, documentVisible, session?.token])

  useEffect(() => {
    if (!networkOnline || !documentVisible) return undefined
    let cancelled = false
    const refreshFeed = async () => {
      try {
        const response = await fetch(`${API_BASE_URL}/api/events`, {
          headers: session?.token ? { Authorization: `Bearer ${session.token}` } : {},
          signal: AbortSignal.timeout(20000),
        })
        if (!response.ok) return
        const data = await response.json()
        if (cancelled || !Array.isArray(data.events)) return
        startTransition(() => setEvents(data.events))
        setGoingIds(data.events.filter((event) => event.isGoing).map((event) => String(getEventId(event))))
        setReminderIds(data.events.filter((event) => event.isReminded).map((event) => String(getEventId(event))))
        storeEventCache(data.events)
      } catch {
        // Keep the last confirmed feed snapshot if the periodic refresh fails.
      }
    }
    const timer = window.setInterval(refreshFeed, 60_000)
    return () => {
      cancelled = true
      window.clearInterval(timer)
    }
  }, [networkOnline, documentVisible, session?.token])

  useEffect(() => {
    const linkParams = new URLSearchParams(window.location.search)
    const requestedEventId = linkParams.get('event')
    if (!requestedEventId || handledSharedEventId.current === requestedEventId) return
    const sharedEvent = events.find((item) => String(getEventId(item)) === requestedEventId)
    if (!sharedEvent) return
    const requestedCategory = linkParams.get('category')
    const selectedCategory = CATEGORY_DATA.some((item) => item.id === sharedEvent.category)
      ? sharedEvent.category
      : CATEGORY_DATA.some((item) => item.id === requestedCategory)
        ? requestedCategory
        : 'all'
    const frame = window.requestAnimationFrame(() => {
      handledSharedEventId.current = requestedEventId
      if (activeTab !== 'home') skipFilterAutoCenterRef.current = true
      setActiveTab('home')
      setExpandedHomeCategory(selectedCategory)
      setVisibleFullFeedCount(EVENT_LIST_PAGE_SIZE)
      setPendingFullEventId(requestedEventId)
    })
    return () => window.cancelAnimationFrame(frame)
  }, [events, activeTab])

  useEffect(() => {
    if (activeTab !== 'reminders') return undefined
    const initialFrame = window.requestAnimationFrame(() => setReminderClock(Date.now()))
    const timer = window.setInterval(() => setReminderClock(Date.now()), 30_000)
    return () => {
      window.cancelAnimationFrame(initialFrame)
      window.clearInterval(timer)
    }
  }, [activeTab])

  useEffect(() => {
    document.documentElement.dataset.theme = theme
    safeSetStored('futapulse-theme', theme)
    safeSetStored('futapulse-client-theme', theme)
  }, [theme])

  useEffect(() => {
    if (!detailEvent && !profileMenuOpen && !profileOpen && !eventEditor && !reminderTarget && !reportTarget) return undefined
    const onKeyDown = (event) => {
      if (event.key === 'Escape') {
        if (detailEvent) {
          closeEventDetail()
          return
        }
        closeEventDetail()
        if (profile && profileOpen) setProfileOpen(false)
        setProfileMenuOpen(false)
        setEventEditor(null)
        setReminderTarget(null)
        setReportTarget(null)
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [detailEvent, profileMenuOpen, profileOpen, eventEditor, reminderTarget, reportTarget, profile, closeEventDetail])

  useEffect(() => {
    const onHashChange = () => {
      const page = window.location.hash.slice(1)
      if (NAV_ITEMS.some((item) => item.id === page)) setActiveTab(page)
    }
    window.addEventListener('hashchange', onHashChange)
    return () => window.removeEventListener('hashchange', onHashChange)
  }, [])

  const publishedEvents = useMemo(
    () => events.filter((event) => {
      if (!['Published', 'Live', undefined].includes(event.status)) return false
      return isWithinEventDisplayWindow(event, feedClock)
    }),
    [events, feedClock],
  )
  const hotEvent = useMemo(() => {
    return [...publishedEvents]
      .filter((event) => getHotScore(event) >= 10)
      .sort((first, second) => getHotScore(second) - getHotScore(first))[0] || null
  }, [publishedEvents])
  const hotEvents = useMemo(() => {
    const ranked = publishedEvents
      .filter((event) => getHotScore(event) >= 10)
      .sort((first, second) => getHotScore(second) - getHotScore(first))
    return ranked.filter((event) => String(getEventId(event)) !== String(getEventId(hotEvent || {}))).slice(0, 7)
  }, [publishedEvents, hotEvent])
  const homeCategories = useMemo(() => CATEGORY_DATA.map((category) => ({
    ...category,
    events: publishedEvents.filter((event) => event.category === category.id && matchesProfileAudience(event, profile)),
  })), [publishedEvents, profile])
  const hotEventCount = hotEvent ? hotEvents.length + 1 : 0
  const expandedFeedEventCount = expandedHomeCategory === 'hot'
    ? [hotEvent, ...hotEvents].filter((event) => event && matchesProfileAudience(event, profile)).length
    : publishedEvents.filter((event) => (expandedHomeCategory === 'all' || event.category === expandedHomeCategory) && matchesProfileAudience(event, profile)).length
  const hotCarouselKey = [hotEvent ? getEventId(hotEvent) : '', ...hotEvents.map(getEventId)].join('|')

  useEffect(() => {
    if (activeTab !== 'home') return undefined
    if (skipFilterAutoCenterRef.current) {
      skipFilterAutoCenterRef.current = false
      return undefined
    }
    const filterBar = categoryFilterBarRef.current
    const selectedButton = categoryFilterButtonRefs.current[homeCategory]
    if (!filterBar || !selectedButton) return undefined

    const frame = window.requestAnimationFrame(() => {
      const barRect = filterBar.getBoundingClientRect()
      const buttonRect = selectedButton.getBoundingClientRect()
      const centeredLeft = filterBar.scrollLeft + buttonRect.left - barRect.left
        - (filterBar.clientWidth - selectedButton.clientWidth) / 2
      const maxLeft = filterBar.scrollWidth - filterBar.clientWidth
      filterBar.scrollTo({ left: Math.max(0, Math.min(centeredLeft, maxLeft)), behavior: 'smooth' })
    })
    return () => window.cancelAnimationFrame(frame)
  }, [activeTab, homeCategory])

  useEffect(() => {
    const track = hotCarouselRef.current
    const shouldRotate = activeTab === 'home'
      ? !expandedHomeCategory
      : activeTab === 'search' && !search.trim() && !searchFocused
    if (!shouldRotate || !documentVisible || pausedAutoScrollTracks.hot || !track || track.children.length < 2) return undefined

    const advanceCarousel = () => {
      const cards = Array.from(track.children)
      if (cards.length < 2) return
      const trackLeft = track.getBoundingClientRect().left
      let currentIndex = 0
      let closestDistance = Number.POSITIVE_INFINITY
      cards.forEach((card, index) => {
        const distance = Math.abs(card.getBoundingClientRect().left - trackLeft)
        if (distance < closestDistance) {
          closestDistance = distance
          currentIndex = index
        }
      })
      const nextCard = cards[(currentIndex + 1) % cards.length]
      const nextLeft = track.scrollLeft + nextCard.getBoundingClientRect().left - trackLeft
      track.scrollTo({ left: nextLeft, behavior: 'smooth' })
    }

    const timer = window.setInterval(advanceCarousel, 5000)
    return () => window.clearInterval(timer)
  }, [activeTab, expandedHomeCategory, hotCarouselKey, search, searchFocused, pausedAutoScrollTracks.hot, documentVisible])
  const remindEventIds = useCallback((id, enabled) => {
    const eventId = String(id)
    setReminderIds((current) => {
      return enabled ? [...new Set([...current, eventId])] : current.filter((item) => item !== eventId)
    })
  }, [])

  useEffect(() => {
    const clockTimer = window.setInterval(() => setClockNow(Date.now()), 60_000)
    return () => window.clearInterval(clockTimer)
  }, [])

  const queueEngagement = useCallback((eventId, type, enabled) => {
    const accountId = String(session?.user?.id || '')
    if (!accountId || typeof enabled !== 'boolean') return
    const actionId = globalThis.crypto?.randomUUID?.()
      || `${Date.now()}-${Math.random().toString(36).slice(2)}`
    setEngagementQueue((current) => [...current, {
      actionId,
      accountId,
      eventId: String(eventId),
      type,
      enabled,
      attempts: 0,
      nextAttemptAt: 0,
    }].slice(-100))
  }, [session])

  const handleReminder = useCallback(async (id, explicitValue, { silent = false } = {}) => {
    const eventId = String(id)
    const nextValue = typeof explicitValue === 'boolean' ? explicitValue : !reminderIds.includes(eventId)
    if (!session?.token || !session?.user?.id) {
      notify('Sign in to set or remove an event reminder.', 'error')
      return
    }
    if (nextValue === reminderIds.includes(eventId)) return
    remindEventIds(eventId, nextValue)
    setEvents((current) => current.map((event) => String(getEventId(event)) === eventId
      ? { ...event, isReminded: nextValue, reminderCount: Math.max(0, (Number(event.reminderCount) || 0) + (nextValue ? 1 : -1)) }
      : event))
    if (!nextValue) {
      setReminderTimes((current) => {
        const next = { ...current }
        delete next[eventId]
        safeSetStored('futapulse-reminders', JSON.stringify(next))
        return next
      })
    }
    queueEngagement(eventId, 'reminder', nextValue)
    if (!silent) notify(nextValue ? 'Event reminder saved.' : 'Event reminder removed.', nextValue ? 'success' : 'info')
  }, [reminderIds, remindEventIds, notify, queueEngagement, session])

  const handleRsvp = useCallback(async (id) => {
    if (id === undefined || id === null) return
    const eventId = String(id)
    if (onlineEngagementsInFlight.current.has(`rsvp:${eventId}`)) return
    if (!navigator.onLine) {
      notify('Connect to the internet to update the attendance count. No change was made.', 'error')
      return
    }
    const isGoing = goingIds.includes(eventId)
    onlineEngagementsInFlight.current.add(`rsvp:${eventId}`)
    try {
      const result = await apiRequest(`/api/events/${encodeURIComponent(eventId)}/engagement`, {
        method: 'PATCH',
        body: JSON.stringify({ type: 'rsvp', attending: !isGoing }),
      }, session?.token)
      if (!result.event) throw new Error('The server did not confirm the attendance update.')
      const nextIds = isGoing ? goingIds.filter((item) => item !== eventId) : [...goingIds, eventId]
      setGoingIds(nextIds)
      setEvents((current) => current.map((event) => String(getEventId(event)) === eventId
        ? { ...event, ...result.event, isGoing: !isGoing }
        : event))
      if (!isGoing && notifications.reminders !== false) {
        primeAlarmAudio()
        requestEventNotificationPermission()
      }
      notify(isGoing ? 'Your attendance update was removed.' : 'Your attendance was confirmed by the server.', 'success')
    } catch (error) {
      notify(error.message || 'The server could not confirm the attendance update. No change was made.', 'error')
    } finally {
      onlineEngagementsInFlight.current.delete(`rsvp:${eventId}`)
    }
  }, [goingIds, notifications.reminders, primeAlarmAudio, requestEventNotificationPermission, notify, session])

  const showEventAlert = useCallback((event, kind) => {
    if (!event) return
    const eventId = String(getEventId(event))
    const alertEvent = { ...event, startTime: getStartTime(event) }
    setReminderClock(Date.now())
    setActiveTab('home')
    setActiveEventAlert({ eventId, kind })
    setDetailEvent(alertEvent)
    startAlarmRingtone()

    if (document.hidden && 'Notification' in window && Notification.permission === 'granted') {
      try {
        const notification = new Notification(
          kind === 'live' ? `🔥 ${event.title} is live` : `Reminder: ${event.title}`,
          {
            body: kind === 'live' ? `${event.venue || 'Your event'} is happening now. Tap to view the event.` : `Your event starts soon at ${event.venue || 'the listed venue'}.`,
            tag: `futapulse-${eventId}-${kind}`,
            requireInteraction: true,
          },
        )
        notification.onclick = () => {
          window.focus()
          setActiveTab('home')
          setActiveEventAlert({ eventId, kind })
          setDetailEvent(alertEvent)
          startAlarmRingtone()
          notification.close()
        }
      } catch (error) {
        console.error('Unable to display the event alert.', error)
      }
    }
  }, [startAlarmRingtone, setActiveEventAlert, setDetailEvent])

  useEffect(() => {
    const timers = []
    const now = Date.now()
    const maxTimeout = 2_147_000_000
    const manualReminderTimes = new Map()

    Object.entries(reminderTimes).forEach(([eventId, reminder]) => {
      const event = events.find((item) => String(getEventId(item)) === eventId)
      const reminderAt = Date.parse(reminder?.notifyAt || '')
      if (!event || !Number.isFinite(reminderAt)) return
      manualReminderTimes.set(eventId, reminderAt)

      if (reminderAt <= now) {
        void handleReminder(eventId, false, { silent: true })
        return
      }

      const scheduleReminder = () => {
        const remaining = reminderAt - Date.now()
        if (remaining <= 0) {
          void handleReminder(eventId, false, { silent: true })
          if (notifications.reminders !== false) showEventAlert(event, 'reminder')
          return
        }
        timers.push(window.setTimeout(scheduleReminder, Math.min(remaining, maxTimeout)))
      }
      scheduleReminder()
    })

    if (notifications.reminders !== false) {
      goingIds.forEach((eventId) => {
        const event = events.find((item) => String(getEventId(item)) === eventId)
        const startAt = Date.parse(getStartTime(event || {}))
        const reminderAt = manualReminderTimes.get(eventId)
        if (!event || !Number.isFinite(startAt) || startAt <= now || (Number.isFinite(reminderAt) && reminderAt > now)) return

        const scheduleLiveAlert = () => {
          const remaining = startAt - Date.now()
          if (remaining <= 0) {
            showEventAlert(event, 'live')
            return
          }
          timers.push(window.setTimeout(scheduleLiveAlert, Math.min(remaining, maxTimeout)))
        }
        scheduleLiveAlert()
      })
    }

    return () => timers.forEach((timer) => window.clearTimeout(timer))
  }, [events, goingIds, reminderTimes, notifications.reminders, handleReminder, showEventAlert])

  const toggleTheme = () => setTheme((current) => current === 'dark' ? 'light' : 'dark')
  const acknowledgeGuidelines = async () => {
    if (!session?.token || guidelinesSaving) return
    setGuidelinesSaving(true)
    try {
      const result = await apiRequest('/api/auth/guidelines/accept', { method: 'POST' }, session.token)
      setProfile(result.profile)
      const updatedUser = { ...user, profile: result.profile }
      setUser(updatedUser)
      setSession((current) => current ? { ...current, user: updatedUser } : current)
      setGuidelinesOpen(false)
    } catch (error) {
      notify(error.message || 'Unable to save your acknowledgment. Please try again.', 'error')
    } finally {
      setGuidelinesSaving(false)
    }
  }
  const switchTab = (id) => {
    if (isGuestSharedView && id !== 'home') {
      notify('Sign in to access personal FUTApulse features.', 'info')
      return
    }
    if (id !== activeTab) {
      Object.values(autoScrollResumeTimersRef.current).forEach((timer) => window.clearTimeout(timer))
      autoScrollResumeTimersRef.current = {}
      setPausedAutoScrollTracks({})
    }
    setActiveTab(id)
    if (id === 'profile' && !profile) setProfileOpen(true)
  }

  const saveProfile = async (nextProfile) => {
    if (!session?.token) throw new Error('Sign in again before saving your profile.')
    setProfileSaving(true)
    try {
      const result = await apiRequest('/api/profile/setup', {
        method: 'POST',
        body: JSON.stringify({
          username: nextProfile.username,
          role: nextProfile.role,
          displayName: nextProfile.name,
          faculty: nextProfile.faculty,
          department: nextProfile.department,
          level: String(nextProfile.level),
          picture: nextProfile.picture,
        }),
      }, session.token)
      const saved = result.user.profile
      const updatedUser = { ...user, ...result.user, profile: saved }
      const updatedSession = { ...session, user: updatedUser }
      setProfile(saved)
      setUser(updatedUser)
      setSession(updatedSession)
      syncOwnedEventsProfile(updatedUser, saved)
      setProfileOpen(false)
      notify('Profile saved successfully.', 'success')
    } finally {
      setProfileSaving(false)
    }
  }

  const saveEditedProfile = async (nextProfile) => {
    if (!session?.token) throw new Error('Sign in again before saving your profile.')
    setProfileSaving(true)
    try {
      const result = await apiRequest('/api/auth/profile', {
        method: 'PATCH',
        body: JSON.stringify({ username: nextProfile.username, profile: nextProfile }),
      }, session.token)
      const saved = result.user.profile
      const updatedUser = { ...user, ...result.user, profile: saved }
      const updatedSession = { ...session, user: updatedUser }
      setProfile(saved)
      setUser(updatedUser)
      setSession(updatedSession)
      syncOwnedEventsProfile(updatedUser, saved)
      const savedAccounts = readStored('futapulse-known-accounts', [])
      safeSetStored('futapulse-known-accounts', JSON.stringify([...new Set([
        ...(Array.isArray(savedAccounts) ? savedAccounts : []),
        updatedUser.username,
      ])].slice(-10)))
      if (rememberedUsername && user.username !== updatedUser.username) {
        safeSetStored('futapulse-remembered-username', updatedUser.username)
        setRememberedUsername(updatedUser.username)
      }
      setProfileOpen(false)
      notify('Profile saved successfully.', 'success')
    } finally {
      setProfileSaving(false)
    }
  }

  const submitEventReport = async (event) => {
    if (!session?.token) {
      notify('Sign in before reporting an event.', 'error')
      return
    }
    setReportSending(true)
    try {
      const result = await apiRequest(`/api/events/${encodeURIComponent(getEventId(event))}/report`, {
        method: 'POST',
        body: JSON.stringify({ reason: reportReason, details: reportDetails }),
      }, session.token)
      setReportTarget(null)
      setReportReason('inappropriate')
      setReportDetails('')
      notify(result.sentForReview ? 'Report received. The event has been sent for review.' : 'Thanks. Your report has been recorded.', 'success')
    } catch (error) {
      notify(error.message || 'Unable to submit this report.', 'error')
    } finally {
      setReportSending(false)
    }
  }

  const decideEventReport = async (eventId, decision) => {
    if (!session?.token || !isFutapulseAdmin) return
    setReportReviewBusyId(eventId)
    try {
      const result = await apiRequest(`/api/admin/event-reports/${encodeURIComponent(eventId)}/decision`, {
        method: 'POST',
        body: JSON.stringify({ decision }),
      }, session.token)
      setReportReviewCases((current) => current.filter((item) => item.eventId !== eventId))
      notify(result.message, 'success')
    } catch (error) {
      notify(error.message || 'Unable to apply that review decision.', 'error')
    } finally {
      setReportReviewBusyId('')
    }
  }

  const changeAccountEmail = async (event) => {
    event.preventDefault()
    const form = event.currentTarget
    const data = new FormData(form)
    try {
      if (!emailChangePending) {
        const email = String(data.get('email') || '').trim().toLowerCase()
        const result = await apiRequest('/api/auth/change-email', {
          method: 'POST',
          body: JSON.stringify({
            email,
            currentPassword: String(data.get('currentPassword') || ''),
          }),
        }, session.token)
        setPendingNewEmail(email)
        setEmailChangePending(true)
        notify(result.message || 'A verification code was sent to your new email.', 'success')
        return
      }
      const result = await apiRequest('/api/auth/change-email/confirm', {
        method: 'POST',
        body: JSON.stringify({
          email: pendingNewEmail,
          code: String(data.get('code') || ''),
        }),
      }, session.token)
      persistSession(result, Boolean(rememberedUsername))
      setEmailChangePending(false)
      setPendingNewEmail('')
      setSecurityAction('')
      form.reset()
      notify(result.message || 'Email updated.', 'success')
    } catch (error) {
      notify(error.message || 'Unable to change your email.', 'error')
    }
  }

  const changeAccountPassword = async (event) => {
    event.preventDefault()
    const form = event.currentTarget
    const data = new FormData(form)
    const newPassword = String(data.get('newPassword') || '')
    if (!isValidNewPassword(newPassword)) {
      notify('Use more than 6 characters, at least one uppercase letter, and at least one number.', 'error')
      return
    }
    if (newPassword !== String(data.get('confirmPassword') || '')) {
      notify('Your new passwords do not match.', 'error')
      return
    }
    try {
      const result = await apiRequest('/api/auth/change-password', {
        method: 'POST',
        body: JSON.stringify({
          currentPassword: String(data.get('currentPassword') || ''),
          newPassword,
        }),
      }, session.token)
      const keepSignedIn = Boolean(rememberedUsername)
      persistSession(result, keepSignedIn)
      form.reset()
      setSecurityAction('')
      notify(result.message || 'Password updated successfully.', 'success')
    } catch (error) {
      notify(error.message || 'Unable to change your password.', 'error')
    }
  }

  const deleteAccount = async (event) => {
    event.preventDefault()
    const data = new FormData(event.currentTarget)
    try {
      const result = await apiRequest('/api/auth/account', {
        method: 'DELETE',
        body: JSON.stringify({
          password: String(data.get('password') || ''),
          confirmation: String(data.get('confirmation') || ''),
        }),
      }, session.token)
      logout()
      setSecurityAction('')
      notify(result.message || 'Your account has been deleted.', 'success')
    } catch (error) {
      notify(error.message || 'Unable to delete your account.', 'error')
    }
  }

  const selectProfilePhoto = async (file) => {
    if (!file) return
    if (!file.type.startsWith('image/')) {
      notify('Choose an image file for your profile photo.', 'error')
      if (avatarInput.current) avatarInput.current.value = ''
      return
    }
    if (file.size > 2 * 1024 * 1024) {
      notify('Choose an image smaller than 2 MB.', 'error')
      if (avatarInput.current) avatarInput.current.value = ''
      return
    }
    if (!session?.token || !profile) {
      notify('Complete your profile before adding a photo.', 'error')
      return
    }
    try {
      const source = await new Promise((resolve, reject) => {
        const reader = new FileReader()
        reader.addEventListener('load', () => resolve(reader.result))
        reader.addEventListener('error', () => reject(new Error('Unable to read that image file.')))
        reader.readAsDataURL(file)
      })
      setAvatarPhotoSource(String(source))
    } catch (error) {
      notify(error.message || 'This image could not be opened.', 'error')
    } finally {
      if (avatarInput.current) avatarInput.current.value = ''
    }
  }

  const uploadProfilePhoto = async (picture) => {
    if (!picture || !session?.token || !profile) return
    setAvatarUploading(true)
    try {
      const nextProfile = { ...profile, picture }
      const result = await apiRequest('/api/auth/profile', {
        method: 'PATCH',
        body: JSON.stringify({ profile: nextProfile }),
      }, session.token)
      setProfile(result.user.profile)
      setProfileAvatarFailed(false)
      const updatedUser = { ...user, ...result.user, profile: result.user.profile }
      setUser(updatedUser)
      setSession((current) => current ? { ...current, user: updatedUser } : current)
      syncOwnedEventsProfile(updatedUser, result.user.profile)
      setAvatarPhotoSource('')
      notify('Profile photo updated.', 'success')
    } catch (error) {
      console.error('Unable to save profile photo.', error)
      notify(error.message || 'This image could not be saved. Try a smaller file.', 'error')
    } finally {
      setAvatarUploading(false)
      if (avatarInput.current) avatarInput.current.value = ''
    }
  }

  const deferredSearch = useDeferredValue(search)
  const searchEvents = useMemo(() => {
    const query = deferredSearch.trim().toLowerCase()
    if (!query) return []
    const keywords = query.split(/\s+/).filter(Boolean)
    const getFields = (event) => ({
      title: String(event.title || '').toLowerCase(),
      organizer: String(event.organizerName || event.organizer?.name || '').toLowerCase(),
    })
    const getMatchPriority = (event) => {
      const { title, organizer } = getFields(event)
      if (title === query) return 0
      if (title.includes(query)) return 1
      if (keywords.every((word) => title.includes(word))) return 2
      if (organizer.includes(query)) return 3
      if (keywords.every((word) => organizer.includes(word))) return 4
      return 5
    }
    return publishedEvents
      .filter((event) => {
        const { title, organizer } = getFields(event)
        return keywords.every((word) => title.includes(word) || organizer.includes(word))
      })
      .sort((first, second) => getMatchPriority(first) - getMatchPriority(second)
        || Number(Boolean(second.isHot)) - Number(Boolean(first.isHot))
        || getHotScore(second) - getHotScore(first))
  }, [publishedEvents, deferredSearch])

  const remindedEvents = useMemo(() => publishedEvents.filter((event) => {
    const id = String(getEventId(event))
    const scheduledReminder = reminderTimes[id]
    const notifyAt = Date.parse(scheduledReminder?.notifyAt || '')
    return !hasEventEnded(event, reminderClock) && Number.isFinite(notifyAt) && notifyAt > reminderClock
  }), [publishedEvents, reminderTimes, reminderClock])
  const anticipatedEvents = useMemo(() => {
    const remindedEventIds = new Set(remindedEvents.map((event) => String(getEventId(event))))
    return publishedEvents.filter((event) => {
      const id = String(getEventId(event))
      return !hasEventEnded(event, reminderClock)
        && goingIds.includes(id)
        && !remindedEventIds.has(id)
    })
  }, [publishedEvents, reminderClock, goingIds, remindedEvents])

  useEffect(() => {
    if (activeTab !== 'reminders' || !documentVisible) return undefined
    const timers = []
    const tracks = [
      ['anticipating', reminderCarouselRefs.current.anticipating],
      ['reminders', reminderCarouselRefs.current.reminders],
    ]
    tracks.forEach(([trackId, track]) => {
      if (!track || track.children.length < 2 || pausedAutoScrollTracks[trackId]) return
      const advanceCarousel = () => {
        const cards = Array.from(track.children)
        if (cards.length < 2) return
        const trackLeft = track.getBoundingClientRect().left
        let currentIndex = 0
        let closestDistance = Number.POSITIVE_INFINITY
        cards.forEach((card, index) => {
          const distance = Math.abs(card.getBoundingClientRect().left - trackLeft)
          if (distance < closestDistance) {
            closestDistance = distance
            currentIndex = index
          }
        })
        const nextCard = cards[(currentIndex + 1) % cards.length]
        const nextLeft = track.scrollLeft + nextCard.getBoundingClientRect().left - trackLeft
        track.scrollTo({ left: nextLeft, behavior: 'smooth' })
      }
      timers.push(window.setInterval(advanceCarousel, 5000))
    })
    return () => timers.forEach((timer) => window.clearInterval(timer))
  }, [activeTab, anticipatedEvents.length, remindedEvents.length, pausedAutoScrollTracks, documentVisible])

  const hasPublishedEvent = events.some((event) =>
    String(event.createdByUserId || '') === String(user?.id || '')
    && ['Published', 'Live'].includes(event.status)
  )
  const eventPostingPaused = Boolean(user?.postingBanUntil && new Date(user.postingBanUntil).getTime() > clockNow)
  const hasTrendingEvent = events.some((event) =>
    String(event.createdByUserId || '') === String(user?.id || '')
    && ['Published', 'Live'].includes(event.status)
    && (event.isHot === true || getHotScore(event) >= 10)
  )
  const organizerEvents = useMemo(() => events
    .filter((event) => String(event.createdByUserId || '') === String(user?.id || ''))
    .filter((event) => organizerTab === 'drafts' ? event.status === 'Draft' : ['Published', 'Live'].includes(event.status)), [events, user?.id, organizerTab])

  const changeSearch = (value) => {
    setSearch(value)
    setVisibleSearchCount(EVENT_LIST_PAGE_SIZE)
  }

  const changeOrganizerTab = (tab) => {
    setOrganizerTab(tab)
    setVisibleOrganizerCount(EVENT_LIST_PAGE_SIZE)
  }

  const chooseCategory = (category) => {
    setHomeCategory(category)
    setExpandedHomeCategory('')
    setVisibleFullFeedCount(EVENT_LIST_PAGE_SIZE)
    switchTab('home')
    window.setTimeout(() => {
      if (category === 'all') {
        document.querySelector('.app-main')?.scrollTo({ top: 0, behavior: 'smooth' })
        return
      }
      homeSectionRefs.current[category]?.scrollIntoView({ behavior: 'smooth', block: 'start' })
    }, 80)
  }

  const chooseExploreCategory = (category) => {
    setSearchFocused(false)
    chooseCategory(category)
  }

  const openCategoryFeed = (category, eventId = '') => {
    if (!eventId) setHomeCategory(category === 'hot' ? 'all' : category)
    else {
      resumeAutoScroll('hot')
      if (activeTab !== 'home') skipFilterAutoCenterRef.current = true
    }
    setExpandedHomeCategory(category)
    setVisibleFullFeedCount(EVENT_LIST_PAGE_SIZE)
    setPendingFullEventId(eventId ? String(eventId) : '')
    switchTab('home')
    if (!eventId) window.setTimeout(() => document.querySelector('.app-main')?.scrollTo({ top: 0, behavior: 'smooth' }), 0)
  }

  useEffect(() => {
    if (activeTab !== 'home' || !expandedHomeCategory || !pendingFullEventId) return undefined
    const frame = window.requestAnimationFrame(() => {
      const target = document.getElementById(`home-full-event-${pendingFullEventId}`)
      if (target) {
        target.scrollIntoView({ behavior: 'smooth', block: 'start' })
        setPendingFullEventId('')
      } else if (!loading) {
        setPendingFullEventId('')
      }
    })
    return () => window.cancelAnimationFrame(frame)
  }, [activeTab, expandedHomeCategory, pendingFullEventId, events, loading])

  const saveReminderTime = async (minutesBefore, label) => {
    if (!reminderTarget) return
    primeAlarmAudio()
    const event = events.find((item) => String(getEventId(item)) === String(reminderTarget))
    const eventStart = new Date(getStartTime(event || {})).getTime()
    if (!event || !Number.isFinite(eventStart)) {
      notify('Unable to schedule a reminder for this event.', 'error')
      setReminderTarget(null)
      return
    }
    const notifyAt = eventStart - minutesBefore * 60 * 1000
    if (notifyAt <= getCurrentTimestamp()) {
      notify('That reminder time has already passed for this event.', 'error')
      return
    }
    const reminder = { label, notifyAt: new Date(notifyAt).toISOString() }
    const next = { ...reminderTimes, [String(reminderTarget)]: reminder }
    setReminderTimes(next)
    safeSetStored('futapulse-reminders', JSON.stringify(next))
    if (!reminderIds.includes(String(reminderTarget))) {
      void handleReminder(reminderTarget, true, { silent: true })
    }
    setReminderTarget(null)
    if ('Notification' in window && notifications.reminders !== false) {
      try {
        const permission = Notification.permission === 'default' ? await Notification.requestPermission() : Notification.permission
        if (permission === 'granted') {
          notify(`Reminder set for ${label}.`, 'success')
        } else {
          notify(`Saved ${label} reminder. Enable notifications to receive an alert when FUTApulse is open in the background.`, 'info')
        }
      } catch (error) {
        console.error('Unable to enable event notification.', error)
        notify('Reminder saved, but browser alerts could not be enabled.', 'error')
      }
    } else if (notifications.reminders === false) {
      notify(`Saved ${label} reminder. Alerts are currently turned off in notification preferences.`, 'info')
    } else {
      notify(`Reminder set for ${label}.`, 'success')
    }
  }

  const autosaveEventDraft = async (eventData, banner) => {
    if (!profile || !session?.token) throw new Error('Sign in and complete your profile to save an event draft.')
    const editing = Boolean(eventData.id)
    const startAt = eventData.date ? new Date(eventData.date) : null
    const endAt = eventData.endDateTime ? new Date(eventData.endDateTime) : null
    const validStart = Boolean(startAt && Number.isFinite(startAt.getTime()))
    const validEnd = Boolean(endAt && Number.isFinite(endAt.getTime()))
    const payload = {
      ...Object.fromEntries(Object.entries(eventData).filter(([key]) => !['allowSimilar', 'createdByUserId'].includes(key))),
      ...(editing ? { id: String(eventData.id) } : {}),
      date: validStart ? startAt.toISOString() : '',
      startTime: validStart ? startAt.toISOString() : '',
      endTime: validEnd ? endAt.toISOString() : '',
      banner: banner || eventData.banner || '',
      audience: eventData.audience?.length ? eventData.audience : ['all'],
      venueLandmark: eventData.venueLandmark || '',
      turnoutCount: Number(eventData.turnoutCount) || 0,
      turnoutBreakdown: Array.isArray(eventData.turnoutBreakdown) ? eventData.turnoutBreakdown : [],
      status: 'Draft',
    }
    const response = await apiRequest(`/api/events${editing ? `/${encodeURIComponent(eventData.id)}` : ''}`, {
      method: editing ? 'PATCH' : 'POST',
      body: JSON.stringify(payload),
    }, session.token)
    const resultEvent = response.event || payload
    const savedId = String(getEventId(resultEvent))
    setEvents((current) => current.some((item) => String(getEventId(item)) === savedId)
      ? current.map((item) => String(getEventId(item)) === savedId ? resultEvent : item)
      : [...current, resultEvent])
    return resultEvent
  }

  const deleteOwnedEvent = async (event) => {
    const eventId = String(getEventId(event) || '')
    if (!eventId || !session?.token) return
    if (!networkOnline) {
      notify('Connect to the internet before deleting an event.', 'error')
      return
    }
    setEventDeleting(true)
    try {
      const result = await apiRequest(`/api/events/${encodeURIComponent(eventId)}`, { method: 'DELETE' }, session.token)
      setEvents((current) => current.filter((item) => String(getEventId(item)) !== eventId))
      setGoingIds((current) => {
        const next = current.filter((id) => String(id) !== eventId)
          return next
      })
      setReminderIds((current) => {
        const next = current.filter((id) => String(id) !== eventId)
        return next
      })
      setReminderTimes((current) => {
        const next = { ...current }
        delete next[eventId]
        safeSetStored('futapulse-reminders', JSON.stringify(next))
        return next
      })
      setEngagementQueue((current) => {
        const next = current.filter((action) => String(action.eventId) !== eventId)
        safeSetStored('futapulse-engagement-sync-queue', JSON.stringify(next))
        return next
      })
      const draftOwner = user?.username || 'guest'
      try {
        localStorage.removeItem(`futapulse-event-editor-draft:${draftOwner}:${eventId}`)
        localStorage.removeItem(`futapulse-event-editor-draft:${draftOwner}:new`)
      } catch { /* The server deletion already succeeded. */ }
      if (String(getEventId(detailEvent || {})) === eventId) setDetailEvent(null)
      setEventDeleteTarget(null)
      notify(result.message || (event.status === 'Draft' ? 'Draft deleted.' : 'Event deleted.'), 'success')
    } catch (error) {
      notify(error.message || 'Unable to delete this event right now.', 'error')
    } finally {
      setEventDeleting(false)
    }
  }

  const saveEvent = async (eventData, banner) => {
    if (!profile || !session?.token) {
      notify('Please sign in and complete your profile before creating events.', 'error')
      setEventEditor(null)
      return false
    }
    setEventSaving(true)
    const editing = Boolean(eventData.id)
    const eventId = eventData.id || ''
    const allowSimilar = eventData.allowSimilar === true
    try {
      const startAt = eventData.date ? new Date(eventData.date) : null
      const validStart = Boolean(startAt && Number.isFinite(startAt.getTime()))
      const endAt = eventData.endDateTime ? new Date(eventData.endDateTime) : null
      const status = eventData.status || 'Draft'
      if (status === 'Published') {
        if (!validStart) throw new Error('Choose a valid event start date and time before publishing.')
        if (!endAt || !Number.isFinite(endAt.getTime())) throw new Error('Choose a valid event end time before publishing.')
        if (endAt.getTime() <= startAt.getTime()) throw new Error('The event end time must be later than the start time.')
      }
      const savedEvent = {
        ...Object.fromEntries(Object.entries(eventData).filter(([key]) => !['allowSimilar', 'createdByUserId'].includes(key))),
        ...(editing ? { id: eventId } : {}),
        date: validStart ? startAt.toISOString() : '',
        startTime: validStart ? startAt.toISOString() : '',
        endTime: endAt && Number.isFinite(endAt.getTime()) ? endAt.toISOString() : '',
        banner: banner || eventData.banner || '',
        audience: eventData.audience?.length ? eventData.audience : ['all'],
        venueLandmark: eventData.venueLandmark || '',
        turnoutCount: Number(eventData.turnoutCount) || 0,
        turnoutBreakdown: Array.isArray(eventData.turnoutBreakdown) ? eventData.turnoutBreakdown : [],
        status,
        allowSimilar,
      }
      const response = await apiRequest(`/api/events${editing ? `/${encodeURIComponent(eventId)}` : ''}`, {
        method: editing ? 'PATCH' : 'POST',
        body: JSON.stringify(savedEvent),
      }, session.token)
      const resultEvent = response.event || savedEvent
      const savedId = String(getEventId(resultEvent))
      setEvents((current) => current.some((item) => String(getEventId(item)) === savedId)
        ? current.map((item) => String(getEventId(item)) === savedId ? resultEvent : item)
        : [...current, resultEvent])
      setEventDuplicateState({ code: '', matches: [] })
      setEventEditor(null)
      const hasAdvisoryMatches = Array.isArray(response.similarEvents) && response.similarEvents.length > 0
      notify(resultEvent.status === 'Published'
        ? hasAdvisoryMatches ? 'Event published. Review the similar-event note in your organizer feed.' : 'Event published to campus feed!'
        : 'Event draft saved successfully.', 'success')
      return true
    } catch (error) {
      console.error('Unable to save event.', error)
      if (error.code === 'DUPLICATE_EVENT' || error.code === 'POSSIBLE_DUPLICATE') {
        setEventDuplicateState({ code: error.code, matches: error.matches })
        return false
      }
      notify(error.message || 'Unable to save event.', 'error')
      return false
    } finally {
      setEventSaving(false)
    }
  }

  const sendFeedback = async (event) => {
    event.preventDefault()
    const form = event.currentTarget
    const data = new FormData(form)
    const description = String(data.get('description') || '').trim()
    if (!description) return
    setFeedbackSending(true)
    try {
      const result = await apiRequest('/api/feedback', {
        method: 'POST',
        body: JSON.stringify({
          type: feedbackTab,
          category: data.get('category') || '',
          description,
        }),
      }, session.token)
      setProfileMenuOpen(false)
      form.reset()
      notify(result.message || 'Your feedback was emailed to the FUTApulse team.', 'success')
    } catch (error) {
      notify(error.message || 'Unable to send feedback right now.', 'error')
    } finally {
      setFeedbackSending(false)
    }
  }

  const facultyName = profile?.faculty || 'SEET'
  const facultyLogoFailed = failedFacultyLogo === facultyName
  const facultyLogoPath = `/Faculty%20Logo/${encodeURIComponent(facultyName)}.png`

  const themeButton = (
    <button type="button" className="theme-toggle" onClick={toggleTheme} aria-label={`Switch to ${theme === 'dark' ? 'light' : 'dark'} mode`}>
      <span className="toggle-track"><span className="toggle-thumb" /></span>
      <span className="toggle-label">{theme}</span>
    </button>
  )

  if (launchVisible) {
    return (
      <div className="launch-screen" aria-label="Launching FUTApulse">
        <div className="launch-brand" aria-hidden="true">
          <span className="launch-word launch-futa">FUTA</span>
          <span className="launch-word launch-pulse">pulse</span>
          <BrandHeart className="launch-heart" size={40} />
        </div>
      </div>
    )
  }

  if (!launchSequenceReady) return <div className="launch-screen" aria-hidden="true" />

  if (isLaunchAdActive) {
    return (
      <LaunchAdGate
        onComplete={() => setIsLaunchAdActive(false)}
        onHouseAction={() => notify('Sponsored links will be available when ad partners are configured.', 'info')}
      />
    )
  }

  if (sessionLoading) {
    return <div className={`app-root theme-${theme} session-restore-screen`} role="status" aria-live="polite"><BrandHeart size={36} /><span>Connecting to FUTApulse…</span></div>
  }

  if ((!session?.token || !user) && !isGuestSharedView) {
    return (
      <div className={`app-root theme-${theme}`}>
        <div className="auth-app-frame">
          <AuthScreen
            initialUsername={rememberedUsername}
            initialMode={hasDeviceAccount ? 'login' : 'signup'}
            onAuthenticated={(auth, remember, message) => {
              persistSession(auth, remember)
              notify(message, 'success')
              if (auth.user?.profile && ['name', 'faculty', 'department', 'level'].every((key) => auth.user.profile[key])) setProfile(auth.user.profile)
              else setProfileOpen(true)
            }}
          />
        </div>
        {toast && <Toast toast={toast} />}
      </div>
    )
  }

  return (
    <div className={`futa-app theme-${theme}`}>
      <div className="app-frame">
        <header className="app-header">
          <div className="brand-logo">
            <button type="button" className="header-profile-avatar" onClick={() => switchTab('profile')} aria-label="Open your profile">
              {profileAvatarFailed
                ? <User size={17} aria-hidden="true" />
                : profile?.picture || profile?.faculty
                ? <img
                  src={profile.picture || `/Faculty%20Logo/${encodeURIComponent(profile.faculty)}.png`}
                  alt=""
                  onError={(event) => {
                    const facultyFallback = `/Faculty%20Logo/${encodeURIComponent(profile?.faculty || 'SEET')}.png`
                    if (event.currentTarget.dataset.fallback) setProfileAvatarFailed(true)
                    else {
                      event.currentTarget.dataset.fallback = 'true'
                      event.currentTarget.src = facultyFallback
                    }
                  }}
                />
                : <User size={17} aria-hidden="true" />}
            </button>
            <span className="brand-text">FUTApulse</span>
            <BrandHeart className="heart-icon" size={20} />
          </div>
          <div className="header-actions">
            <span
              className={`connection-status ${networkOnline ? 'is-online' : 'is-offline'}`}
              title={networkOnline ? 'Online' : 'Offline; event updates will sync when reconnected'}
              aria-label={networkOnline ? 'Online' : 'Offline; updates queued'}
            />
            {themeButton}
            <button className="profile-menu-trigger" type="button" onClick={() => {
              if (isGuestSharedView) {
                notify('Sign in to manage your account options.', 'info')
                return
              }
              setProfileMenuOpen(true)
              setSettingsPage('menu')
            }} aria-label="Open account options">
              <span>⋮</span>
            </button>
          </div>
        </header>

        <main className="app-main">
          {activeTab === 'home' && (
            <>
              <section className={`category-filter-shell ${homeCategory !== 'all' ? 'is-sticky-category' : ''}`}>
                <div ref={categoryFilterBarRef} className="category-filter-bar" role="tablist" aria-label="Filter events by category">
                  {[{ id: 'all', label: 'All' }, ...CATEGORY_DATA.map(({ id, label }) => ({ id, label }))].map((filter) => (
                    <button ref={(node) => { categoryFilterButtonRefs.current[filter.id] = node }} key={filter.id} type="button" role="tab" aria-selected={homeCategory === filter.id} className={`category-filter ${homeCategory === filter.id ? 'active' : ''}`} onClick={() => chooseCategory(filter.id)}>{filter.label}</button>
                  ))}
                </div>
              </section>
              <div className="feed-container">
                {!expandedHomeCategory ? (
                  <div className="home-discovery-view">
                    {(hotEvent || loading) && <section className="feed-section hot-section" ref={(node) => { homeSectionRefs.current.hot = node }}>
                      <h2 className="home-row-heading"><button type="button" className="home-row-button home-hot-button" aria-label={`Show all hot events, ${hotEventCount} ${hotEventCount === 1 ? 'event' : 'events'}`} onClick={() => openCategoryFeed('hot')}><span className="home-row-button-title"><span className="pulse-dot" />🔥 HOT EVENT ON CAMPUS</span><span className="home-row-count">{hotEventCount} {hotEventCount === 1 ? 'event' : 'events'}</span><span className="home-row-arrow-area"><ChevronRight size={22} /></span></button></h2>
                      {loading && !hotEvent ? <p className="feed-state">Loading live campus feed…</p>
                        : hotEvent ? <div ref={hotCarouselRef} {...autoScrollInteractionProps('hot')} className={`home-event-track home-featured-track ${hotEvents.length ? 'has-many' : 'has-one'}`} aria-label="Hot events">{[hotEvent, ...hotEvents].slice(0, 8).map((event) => <EventPreview key={getEventId(event)} homeVariant="home-featured-preview" event={event} onOpen={() => openCategoryFeed(event.category, getEventId(event))} />)}</div>
                          : loadError ? <p className="feed-error" role="alert">{loadError}</p> : <p className="feed-state">No events are available yet.</p>}
                      {loadError && hotEvent && <p className="feed-error" role="status">Showing saved campus events while offline.</p>}
                    </section>}
                    {homeCategories.map((category, categoryIndex) => (
                      <Fragment key={category.id}>
                      <section className="feed-section home-category-section" ref={(node) => { homeSectionRefs.current[category.id] = node }}>
                        <h2 className="home-row-heading"><button type="button" className={`home-row-button home-category-heading home-category-heading-${category.id}`} aria-label={`Show all ${category.label} events, ${category.events.length} ${category.events.length === 1 ? 'event' : 'events'}`} onClick={() => openCategoryFeed(category.id)}><span className="home-row-button-title">{category.label}</span><span className="home-row-count">{category.events.length} {category.events.length === 1 ? 'event' : 'events'}</span><span className="home-row-arrow-area"><ChevronRight size={22} /></span></button></h2>
                        {category.events.length
                          ? <div className="home-event-track">{category.events.slice(0, 8).map((event) => <EventPreview key={getEventId(event)} homeVariant="home-category-preview" event={event} onOpen={() => openCategoryFeed(event.category, getEventId(event))} />)}</div>
                          : <div className="home-category-empty-track"><div className="home-category-empty-card"><span className="home-category-empty-mark"><Sparkles size={18} aria-hidden="true" /></span><strong>No {category.label} events yet</strong><span>Check back as campus events are added.</span></div></div>}
                      </section>
                      {(categoryIndex + 1) % 2 === 0 && <AdSlot placement="home-category-pairs" onHouseAction={() => notify('Sponsored links will be available when ad partners are configured.', 'info')} />}
                      </Fragment>
                    ))}
                  </div>
                ) : (
                  <section className="home-full-feed-view">
                    <button className={`home-back-button ${homeCategory !== 'all' ? 'is-below-sticky-filter' : ''}`} type="button" onClick={() => {
                      setExpandedHomeCategory('')
                      setVisibleFullFeedCount(EVENT_LIST_PAGE_SIZE)
                      setPendingFullEventId('')
                      window.setTimeout(() => document.querySelector('.app-main')?.scrollTo({ top: 0, behavior: 'smooth' }), 0)
                    }}><ChevronLeft size={18} /> Back to home</button>
                    <div className="home-full-feed-heading"><h1 className="home-full-feed-title">{expandedHomeCategory === 'hot' ? '🔥 Hot Events on Campus' : CATEGORY_DATA.find((item) => item.id === expandedHomeCategory)?.label || 'Events Happening Today & Next 2 Days'}</h1><span className="home-row-count">{expandedFeedEventCount} {expandedFeedEventCount === 1 ? 'event' : 'events'}</span></div>
                    {isGuestSharedView && <div className="shared-event-signin-banner">
                      <p>You’re viewing a shared event. Sign in to mark Coming, set reminders, or report it.</p>
                      <button type="button" onClick={() => setGuestSignInRequested(true)}>Sign in to interact</button>
                    </div>}
                    {(() => {
                      const fullEvents = expandedHomeCategory === 'hot'
                        ? [hotEvent, ...hotEvents].filter((event) => event && matchesProfileAudience(event, profile))
                        : publishedEvents.filter((event) => (expandedHomeCategory === 'all' || event.category === expandedHomeCategory) && matchesProfileAudience(event, profile))
                      return fullEvents.length ? <>{fullEvents.slice(0, visibleFullFeedCount).map((event, index) => <Fragment key={getEventId(event)}>
                        <div id={`home-full-event-${getEventId(event)}`} className={`home-full-event-anchor ${homeCategory !== 'all' ? 'is-below-sticky-filter' : ''}`}>
                          <LazyEventCard isHot={expandedHomeCategory === 'hot' || event.isHot === true || getHotScore(event) >= 10} readOnly={isGuestSharedView} event={{ ...event, startTime: getStartTime(event), isGoing: Boolean(event.isGoing ?? goingIds.includes(String(getEventId(event)))), isReminded: reminderIds.includes(String(getEventId(event))) }} viewerProfile={profile} onComing={(id) => handleRsvp(id)} onRemind={(id) => setReminderTarget(String(id))} onReport={() => { setReportTarget(event); setReportReason('inappropriate'); setReportDetails('') }} />
                        </div>
                        {(fullEvents.length === 1 || (index + 1) % 3 === 0) && <AdSlot placement="category-full-feed" onHouseAction={() => notify('Sponsored links will be available when ad partners are configured.', 'info')} />}
                      </Fragment>)}{visibleFullFeedCount < fullEvents.length && <button type="button" className="feed-load-more" onClick={() => setVisibleFullFeedCount((count) => count + EVENT_LIST_PAGE_SIZE)}>Load more events</button>}</> : loading ? <p className="feed-state">Loading events…</p> : <><div className="filter-empty"><span className="filter-empty-icon">◌</span><strong>No events in this section yet</strong><span>Try another category to explore campus activity.</span></div><AdSlot placement="category-empty-feed" onHouseAction={() => notify('Sponsored links will be available when ad partners are configured.', 'info')} /></>
                      })()}
                  </section>
                )}
              </div>
            </>
          )}

          {activeTab === 'search' && (
            <div className="explore-content">
              <div className="explore-search-header" onBlur={(event) => {
                if (!event.currentTarget.contains(event.relatedTarget)) {
                  setSearchFocused(false)
                  if (searchEvents.length) rememberSearch(search)
                }
              }}>
                <div className={`explore-search ${searchFocused ? 'is-focused' : ''}`}>
                  <Search size={20} aria-hidden="true" />
                  <input
                    type="search"
                    value={search}
                    onFocus={() => setSearchFocused(true)}
                    onChange={(event) => changeSearch(event.target.value)}
                    onKeyDown={(event) => { if (event.key === 'Enter') rememberSearch(search) }}
                    placeholder="Search event titles or organisers' names"
                    autoComplete="off"
                    aria-label="Search events by event title or organizer"
                  />
                  {search && <button type="button" className="explore-search-clear" aria-label="Clear search" onClick={() => changeSearch('')}><X size={18} /></button>}
                </div>
                {searchFocused && !search.trim() && (
                  <div className="explore-search-discovery">
                    {recentSearches.length > 0 && (
                      <section className="explore-recent-searches" aria-label="Recent searches">
                        <div className="explore-discovery-heading"><span>Recent searches</span><button type="button" onClick={() => {
                          setRecentSearches([])
                          safeSetStored('futapulse-recent-searches', JSON.stringify([]))
                        }}>Clear</button></div>
                        <div className="explore-recent-search-list">
                          {recentSearches.map((term) => <button key={term} type="button" className="explore-recent-search" onClick={() => changeSearch(term)}><Clock3 size={14} />{term}</button>)}
                        </div>
                      </section>
                    )}
                    <section aria-label="Browse event categories">
                      <div className="explore-discovery-heading"><span>Browse categories</span></div>
                      <div className="explore-search-category-track">
                        {CATEGORY_DATA.map((category) => (
                          <button key={category.id} type="button" className={`explore-category-card ${category.className}`} onClick={() => chooseExploreCategory(category.id)}>
                            <span>{category.label}</span><small>{category.description}</small><ChevronRight size={19} />
                          </button>
                        ))}
                      </div>
                    </section>
                  </div>
                )}
              </div>
              {search.trim() && (
                <section className="explore-section explore-search-results" aria-label="Search results">
                  <div className="explore-section-heading">
                    <div><span className="explore-eyebrow">SEARCH RESULTS</span><h2>Matches for “{search.trim()}”</h2></div>
                    <span className="explore-search-result-count" role="status" aria-live="polite" aria-atomic="true">{searchEvents.length} {searchEvents.length === 1 ? 'event' : 'events'}</span>
                  </div>
                  {loading && !searchEvents.length ? <p className="feed-state">Searching campus events…</p> : searchEvents.length ? (
                    <>
                    <div className="explore-trending-track home-event-track">
                      {searchEvents.slice(0, visibleSearchCount).map((event) => (
                        <EventPreview
                          key={getEventId(event)}
                          homeVariant="home-category-preview"
                          event={{ ...event, isGoing: Boolean(event.isGoing ?? goingIds.includes(String(getEventId(event)))) }}
                          onOpen={() => { rememberSearch(search); setSearchFocused(false); openCategoryFeed(event.category, getEventId(event)) }}
                        />
                      ))}
                    </div>
                    {visibleSearchCount < searchEvents.length && <button type="button" className="feed-load-more" onClick={() => setVisibleSearchCount((count) => count + EVENT_LIST_PAGE_SIZE)}>Load more results</button>}
                    </>
                  ) : <p className="explore-search-empty">{loadError || `No events or organizers match “${search.trim()}”. Try another keyword.`}</p>}
                  {loadError && searchEvents.length > 0 && <p className="feed-error" role="status">Showing saved events while offline.</p>}
                </section>
              )}
              {!search.trim() && !searchFocused && (hotEvent || loading) && <section className="explore-section explore-hot-section hot-section">
                <div className="explore-section-heading">
                  <button type="button" className="home-row-button home-hot-button" aria-label={`Show all hot events, ${hotEventCount} ${hotEventCount === 1 ? 'event' : 'events'}`} onClick={() => openCategoryFeed('hot')}><span className="home-row-button-title"><span className="pulse-dot" />🔥 HOT EVENT ON CAMPUS</span><span className="home-row-count">{hotEventCount} {hotEventCount === 1 ? 'event' : 'events'}</span><span className="home-row-arrow-area"><ChevronRight size={22} /></span></button>
                </div>
                {loading && !hotEvent ? <p className="feed-state">Loading trending events…</p>
                  : hotEvent ? <div ref={hotCarouselRef} {...autoScrollInteractionProps('hot')} className={`home-event-track home-featured-track ${hotEvents.length ? 'has-many' : 'has-one'}`} aria-label="Hot events">{[hotEvent, ...hotEvents].slice(0, 8).map((event) => <EventPreview key={getEventId(event)} homeVariant="home-featured-preview" event={event} onOpen={() => openCategoryFeed(event.category, getEventId(event))} />)}</div>
                    : loadError ? <p className="feed-error" role="alert">{loadError}</p> : <p className="feed-state">No events are available yet.</p>}
                {loadError && hotEvent && <p className="feed-error" role="status">Showing saved campus events while offline.</p>}
              </section>
              }
              {!search.trim() && !searchFocused && <section className="explore-section">
                <div className="explore-section-heading"><div><span className="explore-eyebrow">FIND YOUR NEXT THING</span><h2>You Don’t Wanna Miss</h2></div></div>
                <div className="explore-category-grid">
                  {CATEGORY_DATA.map((category) => (
                    <button key={category.id} type="button" className={`explore-category-card ${category.className}`} onClick={() => chooseExploreCategory(category.id)}>
                      <span>{category.label}</span><small>{category.description}</small><ChevronRight size={19} />
                    </button>
                  ))}
                </div>
              </section>}
            </div>
          )}

          {activeTab === 'reminders' && (
            <div className="reminders-content">
              <span className="explore-eyebrow">YOUR CAMPUS PLANS</span>
              <h1>Your event plans</h1>
              <p className="reminders-intro">Keep track of events you’re anticipating and the alerts you’ve scheduled.</p>
              {anticipatedEvents.length || remindedEvents.length ? (
                <div className="reminders-sections">
                  <section className="reminders-plan-section" aria-labelledby="anticipating-events-title">
                    <div className="reminders-section-heading">
                      <div><span className="explore-eyebrow">COMING UP</span><h2 id="anticipating-events-title">Anticipating</h2></div>
                      <span className="reminders-section-count">{anticipatedEvents.length}</span>
                    </div>
                    <p className="reminders-section-copy">Events you marked Coming without a separate reminder. We’ll alert you when they go live if notifications are enabled.</p>
                    {anticipatedEvents.length ? (
                      <>
                      <div ref={(node) => { reminderCarouselRefs.current.anticipating = node }} {...autoScrollInteractionProps('anticipating')} className="reminders-event-list">
                        {anticipatedEvents.slice(0, visibleAnticipatingCount).map((event) => (
                          <LazyEventCard
                            key={getEventId(event)}
                            event={{ ...event, startTime: getStartTime(event), isGoing: true, isReminded: false }}
                            viewerProfile={profile}
                            onComing={(id) => handleRsvp(id)}
                            onRemind={(id) => setReminderTarget(String(id))}
                            onReport={() => { setReportTarget(event); setReportReason('inappropriate'); setReportDetails('') }}
                          />
                        ))}
                      </div>
                      {visibleAnticipatingCount < anticipatedEvents.length && <button type="button" className="feed-load-more" onClick={() => setVisibleAnticipatingCount((count) => count + EVENT_LIST_PAGE_SIZE)}>Load more</button>}
                      </>
                    ) : <p className="reminders-section-empty">Events you mark Coming without a separate reminder will appear here.</p>}
                  </section>

                  <section className="reminders-plan-section is-reminder-section" aria-labelledby="scheduled-reminders-title">
                    <div className="reminders-section-heading">
                      <div><span className="explore-eyebrow">ALERTS YOU SET</span><h2 id="scheduled-reminders-title">Reminders</h2></div>
                      <span className="reminders-section-count">{remindedEvents.length}</span>
                    </div>
                    <p className="reminders-section-copy">One scheduled reminder per event. After it fires, you can choose another time if the event hasn’t started.</p>
                    {remindedEvents.length ? (
                      <>
                      <div ref={(node) => { reminderCarouselRefs.current.reminders = node }} {...autoScrollInteractionProps('reminders')} className="reminders-event-list">
                        {remindedEvents.slice(0, visibleReminderCount).map((event) => (
                          <LazyEventCard
                            key={getEventId(event)}
                            event={{ ...event, startTime: getStartTime(event), isGoing: Boolean(event.isGoing ?? goingIds.includes(String(getEventId(event)))), isReminded: true }}
                            viewerProfile={profile}
                            onComing={(id) => handleRsvp(id)}
                            onRemind={(id) => setReminderTarget(String(id))}
                            onReport={() => { setReportTarget(event); setReportReason('inappropriate'); setReportDetails('') }}
                          />
                        ))}
                      </div>
                      {visibleReminderCount < remindedEvents.length && <button type="button" className="feed-load-more" onClick={() => setVisibleReminderCount((count) => count + EVENT_LIST_PAGE_SIZE)}>Load more</button>}
                      </>
                    ) : <p className="reminders-section-empty">Events with a reminder you set will appear here.</p>}
                  </section>
                </div>
              ) : (
                <div className="reminders-empty-state">
                  <Sparkles size={34} className="reminders-empty-icon" />
                  <h2>No event plans yet</h2>
                  <p>Mark an event Coming or set a reminder to keep it here.</p>
                  <button type="button" className="reminders-explore-btn" onClick={() => switchTab('search')}>Explore events</button>
                </div>
              )}
            </div>
          )}

          {activeTab === 'profile' && (
            <div className="profile-view-panel">
              <div className="profile-avatar-block">
                <div className="profile-avatar-circle-wrap">
                  {profileAvatarFailed ? <span className="profile-avatar-fallback"><Building2 size={38} /></span> : (
                    <img src={profile?.picture || `/Faculty%20Logo/${encodeURIComponent(profile?.faculty || 'SEET')}.png`} alt="Profile picture" onError={(error) => {
                      if (error.currentTarget.dataset.fallback) setProfileAvatarFailed(true)
                      else {
                        error.currentTarget.dataset.fallback = 'true'
                        error.currentTarget.src = `/Faculty%20Logo/${encodeURIComponent(profile?.faculty || 'SEET')}.png`
                      }
                    }} />
                  )}
                  <button type="button" className="avatar-edit-badge" aria-label="Change profile photo" disabled={avatarUploading} onClick={() => avatarInput.current?.click()}>✏️</button>
                  <input ref={avatarInput} type="file" accept="image/*" hidden onChange={(event) => { void selectProfilePhoto(event.target.files?.[0]) }} />
                </div>
                <h2 className="profile-user-name">{profile?.name || '-'}</h2>
                <span className={`profile-role-tag ${hasTrendingEvent ? 'is-trending-organizer' : hasPublishedEvent ? 'is-event-organizer' : ''}`}>
                  {hasTrendingEvent ? 'Trending Organizer' : hasPublishedEvent ? 'Organizer' : 'Campus Explorer'}
                </span>
              </div>
              <div className="profile-stats-row">
                <div className="profile-stat-col">
                    <button
                      type="button"
                      className="profile-faculty-logo-trigger"
                      aria-label={`View ${profile?.faculty || 'faculty'} crest`}
                      onClick={() => setFacultyLogoOpen(true)}
                    >
                      {facultyLogoFailed
                        ? <Building2 size={26} aria-hidden="true" />
                        : <img
                          className="stat-faculty-logo"
                          src={facultyLogoPath}
                          alt=""
                          onError={() => setFailedFacultyLogo(facultyName)}
                        />}
                    </button>
                    <span className="stat-val">{profile?.faculty || '-'}</span><span className="stat-lbl">Faculty</span>
                </div>
                <span className="stat-divider" />
                <div className="profile-stat-col"><span className="stat-val">{profile?.department || '-'}</span><span className="stat-lbl">Department</span></div>
                <span className="stat-divider" />
                <div className="profile-stat-col"><span className="stat-val">{profile?.level ? `${profile.level}L` : '-'}</span><span className="stat-lbl">Level</span></div>
              </div>
              <div className="profile-edit-btn-wrap"><button type="button" className="profile-edit-pill" onClick={() => setProfileOpen(true)}>EDIT PROFILE</button></div>
              <section
                className="organizer-hub"
                onTouchStart={(event) => {
                  const touch = event.touches[0]
                  organizerTouchStart.current = touch ? { x: touch.clientX, y: touch.clientY } : null
                }}
                onTouchEnd={(event) => {
                  const start = organizerTouchStart.current
                  const touch = event.changedTouches[0]
                  organizerTouchStart.current = null
                  if (!start || !touch) return
                  const deltaX = touch.clientX - start.x
                  const deltaY = touch.clientY - start.y
                  if (Math.abs(deltaX) < 55 || Math.abs(deltaX) < Math.abs(deltaY) * 1.25) return
                  changeOrganizerTab(deltaX < 0 ? 'drafts' : 'events')
                }}
                onTouchCancel={() => { organizerTouchStart.current = null }}
              >
                  {eventPostingPaused && <p className="event-posting-ban-note" role="status">Event posting is paused for this account until {new Date(user.postingBanUntil).toLocaleString()}.</p>}
                  <div className="organizer-tabs-row">
                    <div className="organizer-tabs-group">
                      {['events', 'drafts'].map((tab) => <button key={tab} type="button" className={`organizer-tab-btn ${organizerTab === tab ? 'active' : ''}`} onClick={() => changeOrganizerTab(tab)}>{tab[0].toUpperCase() + tab.slice(1)}</button>)}
                    </div>
                    <button type="button" className="organizer-create-btn" disabled={eventPostingPaused} onClick={() => { setEventDuplicateState({ code: '', matches: [] }); setEventEditor(emptyEvent()) }}>{eventPostingPaused ? 'Posting paused' : '＋ Create Event'}</button>
                  </div>
                  <p className="organizer-swipe-hint">Swipe left or right to switch between Events and Drafts.</p>
                  {organizerEvents.length ? <div className="profile-events-list">
                    {organizerEvents.slice(0, visibleOrganizerCount).map((event) => <article key={getEventId(event)} className="profile-event-item">
                      <div className="profile-event-item-left"><span className={`profile-event-accent-bar ${event.category}`} /><div className="profile-event-info"><span className={`profile-item-badge ${event.status === 'Draft' ? 'draft' : 'published'}`}>{event.status}</span><strong>{event.title}</strong><span>{event.venue || 'Venue not set'} · {event.date ? new Date(event.date).toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' }) : 'Date not set'}</span></div></div>
                      {String(event.createdByUserId) === String(user.id) && <div className="profile-event-actions"><button type="button" className="btn-item-edit" onClick={() => { setEventDuplicateState({ code: '', matches: [] }); setEventEditor(event) }}>Edit</button><button type="button" className="btn-item-delete" onClick={() => setEventDeleteTarget(event)} aria-label={`Delete ${event.status === 'Draft' ? 'draft' : 'event'} ${event.title}`}><Trash2 size={17} /><span>Delete</span></button></div>}
                    </article>)}
                    {visibleOrganizerCount < organizerEvents.length && <button type="button" className="feed-load-more" onClick={() => setVisibleOrganizerCount((count) => count + EVENT_LIST_PAGE_SIZE)}>Load more</button>}
                  </div> : <p className="profile-events-empty">{organizerTab === 'events' ? 'No uploaded events yet. Create your first campus event!' : 'No saved drafts. All your events have been published.'}</p>}
              </section>
            </div>
          )}
        </main>

        <nav className="app-navbar" aria-label="Primary navigation">
          {NAV_ITEMS.map(({ id, label, Icon }) => (
            <button key={id} type="button" className={`nav-item ${activeTab === id ? 'active' : ''}`} onClick={() => switchTab(id)} aria-current={activeTab === id ? 'page' : undefined}>
              <Icon size={22} aria-hidden="true" /><span className="nav-label">{label}</span>
            </button>
          ))}
        </nav>
      </div>

      <div className="particle-container" aria-hidden="true">
      </div>

      {guidelinesOpen && profile && (
        <div className="modal-backdrop guidelines-backdrop" role="presentation">
          <section className="guidelines-modal glass-panel" role="dialog" aria-modal="true" aria-labelledby="first-guidelines-title">
            <span className="explore-eyebrow">WELCOME TO FUTAPULSE</span>
            <h2 id="first-guidelines-title">Keep campus events useful for everyone</h2>
            <p className="guidelines-intro">FUTApulse helps FUTA students discover events and plan with confidence.</p>
            <CommunityGuidelines />
            <button type="button" className="setup-submit" disabled={guidelinesSaving} onClick={acknowledgeGuidelines}>{guidelinesSaving ? 'Saving…' : 'I understand — continue'} <span>→</span></button>
          </section>
        </div>
      )}

      {reportTarget && (
        <div className="modal-backdrop event-report-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) setReportTarget(null) }}>
          <section className="event-report-modal glass-panel" role="dialog" aria-modal="true" aria-labelledby="report-event-title">
            <button type="button" className="sheet-close" aria-label="Cancel report" onClick={() => setReportTarget(null)}><X size={18} /></button>
            <span className="explore-eyebrow">COMMUNITY REPORT</span>
            <h2 id="report-event-title">Report this event</h2>
            <p className="options-detail-copy"><strong>{reportTarget.title}</strong><br />Tell us what concerns you about this event. Your report will be reviewed.</p>
            <label htmlFor="event-report-reason">Reason</label>
            <select id="event-report-reason" value={reportReason} onChange={(event) => setReportReason(event.target.value)}>
              <option value="misleading">Misleading or false details</option>
              <option value="inappropriate">Inappropriate or harmful content</option>
              <option value="duplicate">Duplicate event</option>
              <option value="other">Other concern</option>
            </select>
            <label htmlFor="event-report-details">Additional details (optional)</label>
            <textarea id="event-report-details" rows={3} maxLength={500} value={reportDetails} onChange={(event) => setReportDetails(event.target.value)} placeholder="Briefly explain your concern" />
            <div className="event-report-modal-actions">
              <button type="button" className="profile-edit-pill" onClick={() => setReportTarget(null)}>Cancel</button>
              <button type="button" className="delete-account-submit" disabled={reportSending} onClick={() => submitEventReport(reportTarget)}>{reportSending ? 'Sending…' : 'Submit report'}</button>
            </div>
          </section>
        </div>
      )}

      {profileOpen && (
        <Suspense fallback={null}><ProfileSetupModal
          profile={profile}
          username={profile?.name || user.profile?.name || user.username}
          editableFields={user.editableFields}
          saving={profileSaving}
          onClose={() => setProfileOpen(false)}
          onSave={profile ? saveEditedProfile : saveProfile}
        /></Suspense>
      )}

      {avatarPhotoSource && <Suspense fallback={null}><ProfilePhotoCropper
        source={avatarPhotoSource}
        saving={avatarUploading}
        onCancel={() => setAvatarPhotoSource('')}
        onSave={uploadProfilePhoto}
      /></Suspense>}

      {reminderTarget && (
        <div className="modal-backdrop reminder-modal-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) setReminderTarget(null) }}>
          <section className="reminder-modal" role="dialog" aria-modal="true" aria-labelledby="reminder-title">
            <h3 id="reminder-title">Set Event Reminder</h3>
            <p className="reminder-current-time">
              {reminderTimes[String(reminderTarget)]
                ? <>Current reminder: <strong>{reminderTimes[String(reminderTarget)].label}</strong>. Choosing another time replaces it.</>
                : 'Choose one reminder time for this event. After it fires, you can set another if the event has not started.'}
            </p>
            <div className="reminder-options">
              {[[1440, '24 hours before', '24 Hours Before'], [120, '2 hours before', '2 Hours Before'], [30, '30 minutes before', '30 Minutes Before']].map(([minutes, label, text]) => (
                <button key={minutes} type="button" className="option-btn" onClick={() => saveReminderTime(minutes, label)}>{text}</button>
              ))}
            </div>
            {reminderIds.includes(String(reminderTarget)) && <button type="button" className="remove-reminder-btn" onClick={() => { void handleReminder(reminderTarget, false); setReminderTarget(null) }}>Remove reminder</button>}
            <button type="button" className="modal-close-btn" onClick={() => setReminderTarget(null)}>Cancel</button>
          </section>
        </div>
      )}

      {detailEvent && (
        <div className={`event-detail-backdrop${eventEditor ? ' event-detail-over-editor' : ''}`} role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) closeEventDetail() }}>
          <section className="event-detail-panel" role="dialog" aria-modal="true" aria-label="Event details">
            <button type="button" className="event-detail-close" aria-label={activeEventAlert?.eventId === String(getEventId(detailEvent)) ? 'Dismiss event alert' : 'Close event details'} onClick={closeEventDetail}><X size={22} /></button>
            {activeEventAlert?.eventId === String(getEventId(detailEvent)) && (
              <div className={`event-live-alert-banner ${activeEventAlert.kind === 'live' ? 'is-live' : ''}`} role="status" aria-live="assertive">
                <span>{activeEventAlert.kind === 'live' ? 'This event is live now.' : 'Your event reminder is due.'}</span>
                <button type="button" onClick={() => { stopAlarmRingtone(); setActiveEventAlert(null) }}>Stop sound</button>
              </div>
            )}
            <LazyEventCard
              event={{ ...detailEvent, startTime: getStartTime(detailEvent), isGoing: Boolean(detailEvent.isGoing ?? goingIds.includes(String(getEventId(detailEvent)))), isReminded: reminderIds.includes(String(getEventId(detailEvent))) }}
              viewerProfile={profile}
              onComing={(id) => handleRsvp(id)}
              onRemind={(id) => setReminderTarget(String(id))}
              onReport={() => { setReportTarget(detailEvent); setReportReason('inappropriate'); setReportDetails('') }}
            />
          </section>
        </div>
      )}

      {profileMenuOpen && (
        <div className="profile-options-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) setProfileMenuOpen(false) }}>
          <section className="profile-options-panel" role="dialog" aria-modal="true" aria-labelledby="options-title">
            <button type="button" className="profile-options-close" aria-label="Close profile options" onClick={() => {
              setProfileMenuOpen(false)
              setSecurityAction('')
              setEmailChangePending(false)
              setPendingNewEmail('')
            }}><X size={20} /></button>
            {settingsPage === 'menu' ? (
              <>
                <span className="explore-eyebrow">YOUR ACCOUNT</span><h2 id="options-title">Profile options</h2>
                <div className="profile-options-list">
                  <button type="button" className="profile-option" onClick={() => setSettingsPage('account')}><Shield size={18} /><span>Account &amp; Security Settings</span><ChevronRight size={18} /></button>
                  <button type="button" className="profile-option" onClick={() => setSettingsPage('notifications')}><Bell size={18} /><span>Notification Preferences</span><ChevronRight size={18} /></button>
                  <button type="button" className="profile-option" onClick={() => setSettingsPage('guidelines')}><Shield size={18} /><span>Community Guidelines</span><ChevronRight size={18} /></button>
                  <button type="button" className="profile-option" onClick={toggleTheme}><Sparkles size={18} /><span>Switch Theme</span><b>{theme}</b></button>
                  <button type="button" className="profile-option" onClick={() => setSettingsPage('feedback')}><Heart size={18} /><span>Feedback &amp; Bug Report</span><ChevronRight size={18} /></button>
                  {isFutapulseAdmin && <button type="button" className="profile-option" onClick={() => setSettingsPage('event-reports')}><Shield size={18} /><span>Reported event review</span><b>{reportReviewCases.length}</b></button>}
                  <button type="button" className="profile-option profile-option-logout" onClick={logout}><LogOut size={18} /><span>Log Out</span><ChevronRight size={18} /></button>
                </div>
              </>
            ) : (
              <>
                <button type="button" className="profile-options-back" onClick={() => {
                  setSettingsPage('menu')
                  setSecurityAction('')
                  setEmailChangePending(false)
                  setPendingNewEmail('')
                }}><ChevronLeft size={16} /> Profile options</button>
                {settingsPage === 'account' && (
                  <>
                    <span className="explore-eyebrow">ACCOUNT &amp; SECURITY</span><h2>Account settings</h2>
                    <p className="options-detail-copy">Signed in as {user.username}{profile?.name ? ` (${profile.name})` : ''}. Account email: {user.email}.</p>
                    {!securityAction ? (
                      <div className="security-action-list">
                        <button type="button" className="security-action-button" onClick={() => setSecurityAction('email')}>Change Email <ChevronRight size={18} /></button>
                        <button type="button" className="security-action-button" onClick={() => setSecurityAction('password')}>Change Password <ChevronRight size={18} /></button>
                        <button type="button" className="security-action-button delete-account-action" onClick={() => setSecurityAction('delete')}>Delete Account <ChevronRight size={18} /></button>
                      </div>
                    ) : (
                      <>
                        <button type="button" className="security-action-back" onClick={() => {
                          setSecurityAction('')
                          setEmailChangePending(false)
                          setPendingNewEmail('')
                        }}><ChevronLeft size={16} /> Account actions</button>
                        {securityAction === 'email' && (
                          <form className="security-form" onSubmit={changeAccountEmail}>
                            <h3>Change email</h3>
                            {emailChangePending ? (
                              <>
                                <p>A verification code was sent to {pendingNewEmail}. Enter it to confirm the new email address.</p>
                                <label htmlFor="security-email-code">Verification code</label>
                                <input id="security-email-code" name="code" inputMode="numeric" autoComplete="one-time-code" minLength={6} maxLength={6} required />
                                <button className="setup-submit" type="submit">Verify and update email <span>→</span></button>
                              </>
                            ) : (
                              <>
                                <label htmlFor="security-new-email">New email address</label>
                                <input id="security-new-email" name="email" type="email" autoComplete="email" required />
                                {user.hasPassword !== false && <AccountPasswordInput name="currentPassword" label="Current password" />}
                                <button className="setup-submit" type="submit">Send verification code <span>→</span></button>
                              </>
                            )}
                          </form>
                        )}
                        {securityAction === 'password' && (
                          <form className="security-form" onSubmit={changeAccountPassword}>
                            <h3>Change password</h3>
                            {user.hasPassword !== false && <AccountPasswordInput name="currentPassword" label="Current password" />}
                            <AccountPasswordInput name="newPassword" label="New password" minLength={7} autoComplete="new-password" />
                            <AccountPasswordInput name="confirmPassword" label="Confirm new password" minLength={7} autoComplete="new-password" />
                            <button className="setup-submit" type="submit">Update password <span>→</span></button>
                          </form>
                        )}
                        {securityAction === 'delete' && (
                          <form className="security-form delete-account-form" onSubmit={deleteAccount}>
                            <h3>Delete account</h3>
                            <p>This permanently deletes your FUTApulse account. This action cannot be undone.</p>
                            {user.hasPassword !== false && <AccountPasswordInput name="password" label="Current password" />}
                            <label htmlFor="delete-account-confirm">Type DELETE to confirm</label>
                            <input id="delete-account-confirm" name="confirmation" autoComplete="off" required pattern="DELETE" />
                            <button className="delete-account-submit" type="submit">Delete my account</button>
                          </form>
                        )}
                      </>
                    )}
                  </>
                )}
                {settingsPage === 'notifications' && <><span className="explore-eyebrow">YOUR ALERTS</span><h2>Notification preferences</h2>{[['reminders', 'Event reminders'], ['updates', 'Campus event updates']].map(([key, label]) => <label key={key} className="preference-toggle"><span>{label}</span><input type="checkbox" checked={notifications[key] !== false} onChange={(event) => setNotifications((current) => { const next = { ...current, [key]: event.target.checked }; safeSetStored('futapulse-notification-preferences', JSON.stringify(next)); return next })} /></label>)}<p className="options-detail-copy">Preferences are saved on this device.</p></>}
                {settingsPage === 'guidelines' && (
                  <>
                    <span className="explore-eyebrow">USING FUTAPULSE WELL</span><h2>Community Guidelines</h2>
                    <p className="options-detail-copy">FUTApulse helps the FUTA community discover useful campus events and make informed plans to attend.</p>
                    <CommunityGuidelines />
                  </>
                )}
                {settingsPage === 'event-reports' && isFutapulseAdmin && (
                  <>
                    <span className="explore-eyebrow">TRUST &amp; SAFETY</span><h2>Reported event review</h2>
                    <p className="options-detail-copy">These events reached five reports. No action is taken until you choose Ban or Ignore.</p>
                    {reportReviewCases.length === 0 ? <p className="options-detail-copy">There are no event reports awaiting review.</p> : (
                      <div className="event-report-review-list">
                        {reportReviewCases.slice(0, visibleReportCount).map((item) => (
                          <article key={item.eventId} className="event-report-review-card">
                            <strong>{item.event.title}</strong>
                            <span>{item.event.organizerName || 'Campus Organizer'} · {item.event.category} · {item.event.venue}</span>
                            <span>{new Date(item.event.date).toLocaleString()} – {new Date(item.event.endTime).toLocaleString()}</span>
                            <p>{item.event.activity}</p>
                            <button type="button" className="event-report-open" onClick={() => { setProfileMenuOpen(false); setDetailEvent(item.event) }}>Open full event</button>
                            <div className="event-report-reasons"><strong>{item.reporterIds.length} reports</strong>{item.reports.map((report, index) => <span key={`${item.eventId}-${report.reporterUserId}`}>{index + 1}. {REPORT_REASON_LABELS[report.reason] || REPORT_REASON_LABELS.other}{report.details ? ` — ${report.details}` : ''}</span>)}</div>
                            <div className="event-review-actions">
                              <button type="button" className="delete-account-submit" disabled={reportReviewBusyId === item.eventId || !item.posterUserId} onClick={() => decideEventReport(item.eventId, 'ban')}>Ban poster for 7 days</button>
                              <button type="button" className="profile-edit-pill" disabled={reportReviewBusyId === item.eventId} onClick={() => decideEventReport(item.eventId, 'ignore')}>Ignore reports</button>
                            </div>
                          </article>
                        ))}
                        {visibleReportCount < reportReviewCases.length && <button type="button" className="feed-load-more" onClick={() => setVisibleReportCount((count) => count + 8)}>Load more reports</button>}
                      </div>
                    )}
                  </>
                )}
                {settingsPage === 'feedback' && <><span className="explore-eyebrow">HELP US IMPROVE</span><h2>Feedback &amp; bug report</h2><div className="feedback-tabs">{[['bug', 'Report a bug'], ['feature', 'Suggest a feature']].map(([tab, label]) => <button key={tab} type="button" className={`feedback-tab ${feedbackTab === tab ? 'active' : ''}`} onClick={() => setFeedbackTab(tab)}>{label}</button>)}</div><form className="feedback-form" onSubmit={sendFeedback}>{feedbackTab === 'bug' && <><label htmlFor="feedback-category">Category</label><select id="feedback-category" name="category" required><option value="">Choose a category</option>{['Display or layout', 'Navigation', 'Event or reminder', 'Account', 'Other'].map((item) => <option key={item}>{item}</option>)}</select></>}<label htmlFor="feedback-description">{feedbackTab === 'bug' ? 'What happened?' : 'What would you like to see?'}</label><textarea id="feedback-description" name="description" rows={5} maxLength={2000} required placeholder={feedbackTab === 'bug' ? 'Describe the issue and steps to reproduce it.' : 'Tell us about your feature idea.'} /><button className="setup-submit" type="submit" disabled={feedbackSending}>{feedbackSending ? 'Sending…' : `Send ${feedbackTab === 'bug' ? 'bug report' : 'suggestion'}`} <span>→</span></button></form></>}
              </>
            )}
          </section>
        </div>
      )}

      {eventDeleteTarget && (
        <div className="modal-backdrop event-delete-backdrop" role="presentation" onMouseDown={(event) => { if (!eventDeleting && event.target === event.currentTarget) setEventDeleteTarget(null) }}>
          <section className="event-delete-modal glass-panel" role="dialog" aria-modal="true" aria-labelledby="delete-event-title">
            <span className="event-delete-icon"><Trash2 size={22} /></span>
            <h2 id="delete-event-title">Delete this {eventDeleteTarget.status === 'Draft' ? 'draft' : 'event'}?</h2>
            <p><strong>{eventDeleteTarget.title || 'Untitled draft'}</strong> will be removed from your account and the app. This cannot be undone.</p>
            <div className="event-delete-actions">
              <button type="button" className="profile-edit-pill" onClick={() => setEventDeleteTarget(null)} disabled={eventDeleting}>Keep it</button>
              <button type="button" className="delete-account-submit" onClick={() => { void deleteOwnedEvent(eventDeleteTarget) }} disabled={eventDeleting}>{eventDeleting ? 'Deleting…' : 'Delete permanently'}</button>
            </div>
          </section>
        </div>
      )}

      {eventEditor && (
        <Suspense fallback={<div className="sheet-backdrop" aria-hidden="true" />}><EventEditor
          categories={CATEGORY_DATA}
          compressBanner={compressEventBanner}
          event={eventEditor}
          saving={eventSaving}
          bannerInput={eventBannerInput}
          owner={user.username}
          duplicateState={eventDuplicateState}
          onClearDuplicates={() => setEventDuplicateState({ code: '', matches: [] })}
          onOpenDuplicate={(event) => setDetailEvent(event)}
          onClose={() => { setEventEditor(null); setEventDuplicateState({ code: '', matches: [] }) }}
          onAutoSave={autosaveEventDraft}
          onSave={saveEvent}
        /></Suspense>
      )}
      {facultyLogoOpen && (
        <div
          className="faculty-logo-viewer-backdrop"
          role="presentation"
          onMouseDown={(event) => { if (event.target === event.currentTarget) setFacultyLogoOpen(false) }}
        >
          <section className="faculty-logo-viewer" role="dialog" aria-modal="true" aria-labelledby="faculty-logo-viewer-title">
            <button type="button" className="faculty-logo-viewer-close" aria-label="Close faculty crest preview" onClick={() => setFacultyLogoOpen(false)}><X size={22} /></button>
            <h2 id="faculty-logo-viewer-title">{profile?.faculty || 'Faculty'} crest</h2>
            {facultyLogoFailed ? (
              <p className="faculty-logo-unavailable" role="status">The faculty crest could not be loaded.</p>
            ) : (
              <>
                <img
                  className="faculty-logo-viewer-image"
                  src={facultyLogoPath}
                  alt={`${profile?.faculty || 'Faculty'} crest`}
                  onError={() => setFailedFacultyLogo(facultyName)}
                />
                <a
                  className="faculty-logo-download"
                  href={facultyLogoPath}
                  download={`${profile?.faculty || 'faculty'}-crest.png`}
                ><Download size={18} /> Save to device</a>
              </>
            )}
          </section>
        </div>
      )}
      {toast && <Toast toast={toast} />}
    </div>
  )
}

function emptyEvent() {
  return { id: '', title: '', category: '', activity: '', date: '', startClock: '', endDateTime: '', endClock: '', venue: '', venueLandmark: '', meetingUrl: '', audience: [], status: 'Draft', banner: '', turnoutCount: 0, turnoutBreakdown: [] }
}

function CommunityGuidelines() {
  return (
    <ul className="guidelines-list">
      <li><strong>Post real campus events</strong><span>Use accurate titles, times, venues, audience details, and descriptions.</span></li>
      <li><strong>Keep listings safe and relevant</strong><span>Do not post misleading, harmful, discriminatory, illegal, unrelated, or repeated events.</span></li>
      <li><strong>Respect other students</strong><span>Protect people’s privacy and use reports only for genuine concerns.</span></li>
      <li><strong>Take responsibility for your posts</strong><span>Organizers should keep event details accurate. FUTApulse may review reports and restrict posting when needed.</span></li>
    </ul>
  )
}

function AccountPasswordInput({ name, label, minLength = 6, autoComplete = 'current-password' }) {
  const [visible, setVisible] = useState(false)
  return (
    <>
      <label htmlFor={`security-${name}`}>{label}</label>
      <span className="security-password-control">
        <input id={`security-${name}`} name={name} type={visible ? 'text' : 'password'} minLength={minLength} maxLength={128} autoComplete={autoComplete} required />
        <button type="button" aria-label={visible ? `Hide ${label.toLowerCase()}` : `Show ${label.toLowerCase()}`} onClick={() => setVisible((current) => !current)}>
          {visible ? <EyeOff size={16} /> : <Eye size={16} />}
        </button>
      </span>
    </>
  )
}

function Toast({ toast }) {
  const Icon = toast.type === 'success' ? Check : toast.type === 'error' ? X : Sparkles
  return <div className={`futa-toast toast-${toast.type}`} role={toast.type === 'error' ? 'alert' : 'status'}><Icon size={17} /><span>{toast.message}</span></div>
}

export default App
