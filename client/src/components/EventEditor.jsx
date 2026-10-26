import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { CalendarDays, Clock3, Sparkles, X } from 'lucide-react'

const MAX_LOCAL_DRAFT_CHARACTERS = 3_500_000
const MAX_EVENT_BANNERS = 5

function readStored(key, fallback) {
  try {
    const value = JSON.parse(localStorage.getItem(key) || 'null')
    return value ?? fallback
  } catch {
    return fallback
  }
}

function safeSetStored(key, value) {
  try {
    localStorage.setItem(key, value)
    return true
  } catch (error) {
    console.warn('Could not save the event draft in browser storage.', error)
    return false
  }
}

function createClientRequestId() {
  return globalThis.crypto?.randomUUID?.()
    || `event-${Date.now()}-${Math.random().toString(36).slice(2)}`
}

function createEmptyEvent() {
  return { id: '', title: '', category: '', activity: '', date: '', startClock: '', endDateTime: '', endClock: '', venue: '', venueLandmark: '', meetingUrl: '', audience: [], status: 'Draft', banner: '', bannerImages: [], turnoutCount: 0, turnoutBreakdown: [] }
}

function getEventId(event) {
  return event.id ?? event._id
}
function toLocalDateAndTime(value) {
  const date = new Date(value)
  if (!Number.isFinite(date.getTime())) return { date: '', time: '' }
  const pad = (number) => String(number).padStart(2, '0')
  return {
    date: `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`,
    time: `${pad(date.getHours())}:${pad(date.getMinutes())}`,
  }
}

function formatDateForEntry(value) {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value || '')
  return match ? `${match[3]}/${match[2]}/${match[1]}` : ''
}

function EventDateField({ id, label, value, onChange, required = false }) {
  const [dateText, setDateText] = useState(() => formatDateForEntry(value))
  const entryRef = useRef(null)
  const pickerRef = useRef(null)

  const updateDateText = (rawValue) => {
    const digits = rawValue.replace(/\D/g, '').slice(0, 8)
    const formatted = digits.length > 4
      ? `${digits.slice(0, 2)}/${digits.slice(2, 4)}/${digits.slice(4)}`
      : digits.length > 2 ? `${digits.slice(0, 2)}/${digits.slice(2)}` : digits
    setDateText(formatted)
    if (digits.length !== 8) {
      onChange('')
      return
    }
    const day = Number(digits.slice(0, 2))
    const month = Number(digits.slice(2, 4))
    const year = Number(digits.slice(4, 8))
    const parsed = new Date(year, month - 1, day)
    if (parsed.getFullYear() === year && parsed.getMonth() === month - 1 && parsed.getDate() === day) {
      onChange(`${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`)
    } else {
      onChange('')
    }
  }

  return (
    <div className="event-date-control">
      <input
        id={id}
        ref={entryRef}
        type="text"
        inputMode="numeric"
        autoComplete="off"
        value={dateText}
        onChange={(event) => updateDateText(event.target.value)}
        placeholder="DD/MM/YYYY"
        aria-label={label}
        aria-describedby={`${id}-hint`}
        required={required}
      />
      <button type="button" aria-label={`Choose ${label.toLowerCase()} from calendar`} onClick={() => {
        const focusEntry = () => entryRef.current?.focus({ preventScroll: false })
        try {
          if (typeof pickerRef.current?.showPicker === 'function') pickerRef.current.showPicker()
          else focusEntry()
        } catch {
          focusEntry()
        }
      }}><CalendarDays size={17} aria-hidden="true" /></button>
      <input
        ref={pickerRef}
        className="event-date-native-picker"
        type="date"
        tabIndex={-1}
        aria-hidden="true"
        value={value || ''}
        onChange={(event) => {
          setDateText(formatDateForEntry(event.target.value))
          onChange(event.target.value)
        }}
      />
      <span id={`${id}-hint`} className="event-date-hint">Enter day, month, year or choose from calendar</span>
    </div>
  )
}

function TimeWheelPicker({ label, value, onChange }) {
  const [open, setOpen] = useState(false)
  const [hour, setHour] = useState('00')
  const [minute, setMinute] = useState('00')
  const hoursRef = useRef(null)
  const minutesRef = useRef(null)
  const previousFocusRef = useRef(null)
  const initialSelectionRef = useRef({ hour: '00', minute: '00' })
  const hours = useMemo(() => Array.from({ length: 24 }, (_, index) => String(index).padStart(2, '0')), [])
  const minutes = useMemo(() => Array.from({ length: 60 }, (_, index) => String(index).padStart(2, '0')), [])
  const openPicker = () => {
    const valueMatch = /^((?:[01]\d|2[0-3])):([0-5]\d)$/.exec(value || '')
    const selectedHour = valueMatch?.[1] || '00'
    const selectedMinute = valueMatch?.[2] || '00'
    initialSelectionRef.current = { hour: selectedHour, minute: selectedMinute }
    previousFocusRef.current = document.activeElement
    setHour(selectedHour)
    setMinute(selectedMinute)
    setOpen(true)
  }

  useEffect(() => {
    if (!open) return undefined
    const previousOverflow = document.body.style.overflow
    let frameId = 0
    const closeOnEscape = (event) => {
      if (event.key === 'Escape') setOpen(false)
    }
    document.body.style.overflow = 'hidden'
    window.addEventListener('keydown', closeOnEscape)
    frameId = requestAnimationFrame(() => {
      if (hoursRef.current) hoursRef.current.scrollTop = Number(initialSelectionRef.current.hour) * 44
      if (minutesRef.current) minutesRef.current.scrollTop = Number(initialSelectionRef.current.minute) * 44
      hoursRef.current?.focus({ preventScroll: true })
    })
    return () => {
      cancelAnimationFrame(frameId)
      window.removeEventListener('keydown', closeOnEscape)
      document.body.style.overflow = previousOverflow
      if (previousFocusRef.current instanceof HTMLElement && previousFocusRef.current.isConnected) {
        previousFocusRef.current.focus({ preventScroll: true })
      }
    }
  }, [open])

  const updateFromScroll = (items, setSelected) => (event) => {
    const index = Math.min(items.length - 1, Math.max(0, Math.round(event.currentTarget.scrollTop / 44)))
    setSelected(items[index])
  }
  const onWheelKeyDown = (items, setSelected, selected) => (event) => {
    const currentIndex = items.indexOf(selected)
    const nextIndex = event.key === 'ArrowDown' ? Math.min(items.length - 1, currentIndex + 1)
      : event.key === 'ArrowUp' ? Math.max(0, currentIndex - 1) : -1
    if (nextIndex < 0) return
    event.preventDefault()
    setSelected(items[nextIndex])
    event.currentTarget.scrollTo({ top: nextIndex * 44, behavior: 'smooth' })
  }

  return (
    <>
      <label className="event-time-label">{label}</label>
      <button type="button" className="event-time-trigger" aria-haspopup="dialog" aria-label={`${label}: ${value || 'Select time'}`} onClick={openPicker}>
        <Clock3 size={17} aria-hidden="true" />
        <span>{value || 'Select time'}</span>
        <small>24-hour time</small>
      </button>
      {open && (
        <div className="time-picker-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) setOpen(false) }}>
          <section className="time-picker-dialog" role="dialog" aria-modal="true" aria-labelledby="time-picker-title">
            <span className="explore-eyebrow">SET EVENT TIME</span>
            <h2 id="time-picker-title">{label}</h2>
            <div className="time-wheel-group">
              {[{ label: 'Hours', items: hours, selected: hour, setSelected: setHour, ref: hoursRef },
                { label: 'Minutes', items: minutes, selected: minute, setSelected: setMinute, ref: minutesRef }].map((wheel) => (
                <div key={wheel.label} className="time-wheel-column">
                  <span className="time-wheel-caption">{wheel.label}</span>
                  <div
                    className="time-wheel-scroll"
                    ref={wheel.ref}
                    role="listbox"
                    aria-label={`${wheel.label} selection`}
                    aria-activedescendant={`${wheel.label}-${wheel.selected}`}
                    tabIndex={0}
                    onScroll={updateFromScroll(wheel.items, wheel.setSelected)}
                    onKeyDown={onWheelKeyDown(wheel.items, wheel.setSelected, wheel.selected)}
                  >
                    {wheel.items.map((item, index) => (
                      <div key={item} id={`${wheel.label}-${item}`} className={`time-wheel-option ${wheel.selected === item ? 'is-selected' : ''}`} role="option" aria-selected={wheel.selected === item} onClick={() => { wheel.setSelected(item); wheel.ref.current?.scrollTo({ top: index * 44, behavior: 'smooth' }) }}>
                        {item}
                      </div>
                    ))}
                  </div>
                </div>
              ))}
            </div>
            <div className="time-picker-actions">
              <button type="button" className="profile-edit-pill" onClick={() => setOpen(false)}>Cancel</button>
              <button type="button" className="setup-submit" onClick={() => { onChange(`${hour}:${minute}`); setOpen(false) }}>Done</button>
            </div>
          </section>
        </div>
      )}
    </>
  )
}

function EventEditor({
  categories = [],
  event,
  saving,
  compressBanner,
  bannerInput,
  owner,
  duplicateState,
  onClearDuplicates,
  onOpenDuplicate,
  onClose,
  onAutoSave,
  onSave,
}) {
  const draftKey = `futapulse-event-editor-draft:${owner}:${event.id || 'new'}`
  const publishedAtOpen = ['Published', 'Live'].includes(event.status)
  const [form, setForm] = useState(() => {
    const savedDraft = publishedAtOpen ? null : readStored(draftKey, null)
    const start = toLocalDateAndTime(event.startTime || event.date || '')
    const end = toLocalDateAndTime(event.endTime || '')
    const initial = {
      ...createEmptyEvent(),
      ...event,
      clientRequestId: event.clientRequestId || savedDraft?.clientRequestId || (!event.id ? createClientRequestId() : ''),
      audience: Array.isArray(event.audience) ? event.audience : String(event.audience || '').split(',').filter(Boolean),
      bannerImages: Array.isArray(event.bannerImages) && event.bannerImages.length
        ? event.bannerImages
        : event.banner ? [event.banner] : [],
      date: start.date,
      startClock: start.time,
      endDateTime: end.date,
      endClock: end.time,
    }
    if (publishedAtOpen) return initial
    return savedDraft && typeof savedDraft === 'object'
      ? { ...initial, ...savedDraft, id: event.id || savedDraft.id || '', clientRequestId: initial.clientRequestId }
      : initial
  })
  const [banner, setBanner] = useState(() => event.bannerImages?.[0] || event.banner || '')
  const formRef = useRef(form)
  const bannerRef = useRef(banner)
  useEffect(() => { formRef.current = form }, [form])
  useEffect(() => { bannerRef.current = banner }, [banner])
  const [error, setError] = useState('')
  const [draftSaved, setDraftSaved] = useState(false)
  const [draftSyncing, setDraftSyncing] = useState(false)
  const [draftSyncError, setDraftSyncError] = useState('')
  const [bannerProcessing, setBannerProcessing] = useState(false)
  const hasEditedRef = useRef(Boolean(event.id || form.title || form.category || form.activity || form.date || form.venue || form.meetingUrl || form.banner))
  const onAutoSaveRef = useRef(onAutoSave)
  const draftSyncOnReconnectRef = useRef(null)
  const draftSyncQueueRef = useRef(Promise.resolve())
  const draftSyncCountRef = useRef(0)
  useEffect(() => { onAutoSaveRef.current = onAutoSave }, [onAutoSave])
  const persistLocalDraft = useCallback((draftForm = formRef.current, draftBanner = bannerRef.current) => {
    if (publishedAtOpen || !hasEditedRef.current) return false
    const snapshot = {
      ...draftForm,
      status: 'Draft',
      banner: draftBanner || draftForm.banner || '',
      bannerImages: Array.isArray(draftForm.bannerImages) ? draftForm.bannerImages : (draftBanner ? [draftBanner] : []),
    }
    const serialized = JSON.stringify(snapshot)
    if (serialized.length > MAX_LOCAL_DRAFT_CHARACTERS) {
      setDraftSaved(false)
      setDraftSyncError('')
      setError('This draft is too large to save on this device. Use a smaller banner image.')
      return false
    }
    const saved = safeSetStored(draftKey, serialized)
    setDraftSaved(saved)
    if (saved) {
      setDraftSyncError('')
    } else {
      setDraftSyncError('')
      setError('This draft could not be autosaved on this device. Check available browser storage.')
    }
    return saved
  }, [draftKey, publishedAtOpen])
  const update = (field, value) => {
    onClearDuplicates?.()
    hasEditedRef.current = true
    const next = { ...formRef.current, [field]: value }
    formRef.current = next
    setForm(next)
  }
  const updateBannerImages = (images) => {
    const nextImages = images.slice(0, MAX_EVENT_BANNERS)
    const primaryBanner = nextImages[0] || ''
    hasEditedRef.current = true
    bannerRef.current = primaryBanner
    setBanner(primaryBanner)
    const next = { ...formRef.current, banner: primaryBanner, bannerImages: nextImages }
    formRef.current = next
    setForm(next)
  }
  const saveDraftOnBlur = (event) => {
    if (event.relatedTarget?.type === 'submit') return
    if (publishedAtOpen || !hasEditedRef.current) return
    const currentForm = formRef.current
    const currentBanner = bannerRef.current || currentForm.banner || ''
    const snapshot = {
      ...currentForm,
      status: 'Draft',
      banner: currentBanner,
      bannerImages: Array.isArray(currentForm.bannerImages) ? currentForm.bannerImages : (currentBanner ? [currentBanner] : []),
    }
    persistLocalDraft(snapshot, currentBanner)
    const startDateTime = snapshot.date && snapshot.startClock ? `${snapshot.date}T${snapshot.startClock}` : ''
    const endDateTime = snapshot.endDateTime && snapshot.endClock ? `${snapshot.endDateTime}T${snapshot.endClock}` : ''
    draftSyncCountRef.current += 1
    setDraftSyncing(true)
    const sync = draftSyncQueueRef.current
      .catch(() => undefined)
      .then(() => onAutoSaveRef.current({
        ...snapshot,
        id: snapshot.id || formRef.current.id || '',
        date: startDateTime,
        endDateTime,
      }, currentBanner))
    draftSyncQueueRef.current = sync
    void sync.then((saved) => {
      if (!saved?.id) return
      const currentImages = formRef.current.bannerImages || []
      const serverImages = Array.isArray(saved.bannerImages) ? saved.bannerImages : snapshot.bannerImages
      const imagesUnchanged = currentImages.length === snapshot.bannerImages.length
        && currentImages.every((image, index) => image === snapshot.bannerImages[index])
      const syncedSnapshot = {
        ...snapshot,
        id: saved.id,
        ...(imagesUnchanged ? { banner: serverImages[0] || '', bannerImages: serverImages } : {}),
      }
      safeSetStored(draftKey, JSON.stringify(syncedSnapshot))
      formRef.current = {
        ...formRef.current,
        id: formRef.current.id || saved.id,
        ...(imagesUnchanged ? { banner: serverImages[0] || '', bannerImages: serverImages } : {}),
      }
      if (imagesUnchanged) {
        bannerRef.current = serverImages[0] || ''
        setBanner(serverImages[0] || '')
      }
      setDraftSaved(true)
      setError('')
      setForm((current) => ({
        ...current,
        id: current.id || saved.id,
        ...(imagesUnchanged ? { banner: serverImages[0] || '', bannerImages: serverImages } : {}),
      }))
      setDraftSyncError('')
    }).catch((saveError) => {
      setError('')
      setDraftSyncError(saveError.message || 'Draft saved on this device; server sync will retry.')
    }).finally(() => {
      draftSyncCountRef.current = Math.max(0, draftSyncCountRef.current - 1)
      if (!draftSyncCountRef.current) setDraftSyncing(false)
    })
  }
  useEffect(() => {
    draftSyncOnReconnectRef.current = saveDraftOnBlur
  })
  useEffect(() => {
    const retryDraftSync = () => draftSyncOnReconnectRef.current?.({ relatedTarget: null })
    window.addEventListener('online', retryDraftSync)
    return () => window.removeEventListener('online', retryDraftSync)
  }, [])
  const createSavePayload = (status, allowSimilar = false, sourceForm = form) => {
    const startDateTime = sourceForm.date && sourceForm.startClock ? `${sourceForm.date}T${sourceForm.startClock}` : ''
    const endDateTime = sourceForm.endDateTime && sourceForm.endClock ? `${sourceForm.endDateTime}T${sourceForm.endClock}` : ''
    return { ...sourceForm, date: startDateTime, endDateTime, status, allowSimilar }
  }

  useEffect(() => {
    if (publishedAtOpen || saving) return undefined
    const snapshot = { ...form, status: 'Draft', banner: banner || form.banner || '', bannerImages: form.bannerImages || [] }
    if (!hasEditedRef.current) return undefined
    const localSaved = () => {
      try {
        const serialized = JSON.stringify(snapshot)
        if (serialized.length > MAX_LOCAL_DRAFT_CHARACTERS) {
          setDraftSaved(false)
          setError('This draft is too large to save on this device. Use a smaller banner image.')
          return
        }
        const saved = safeSetStored(draftKey, serialized)
        setDraftSaved(saved)
        if (saved) {
          setDraftSyncError('')
          setError('')
        } else {
          setDraftSyncError('')
          setError('This draft could not be autosaved on this device. Check available browser storage.')
        }
      } catch (saveError) {
        console.error('Unable to autosave this event draft locally.', saveError)
        setDraftSaved(false)
        setDraftSyncError('')
        setError('This draft could not be autosaved on this device. Check available browser storage.')
      }
    }
    const localSaveTimer = window.setTimeout(localSaved, 250)
    return () => {
      window.clearTimeout(localSaveTimer)
    }
  }, [draftKey, form, banner, publishedAtOpen, saving])

  useEffect(() => {
    const flushDraft = () => { persistLocalDraft(formRef.current, bannerRef.current) }
    window.addEventListener('pagehide', flushDraft)
    document.addEventListener('visibilitychange', flushDraft)
    return () => {
      window.removeEventListener('pagehide', flushDraft)
      document.removeEventListener('visibilitychange', flushDraft)
    }
  }, [draftKey, publishedAtOpen, persistLocalDraft])

  const closeEditor = async () => {
    if (!publishedAtOpen && hasEditedRef.current) {
      await draftSyncQueueRef.current.catch(() => undefined)
      const currentForm = formRef.current
      const currentBanner = bannerRef.current || currentForm.banner || ''
      persistLocalDraft(currentForm, currentBanner)
      const startDateTime = currentForm.date && currentForm.startClock ? `${currentForm.date}T${currentForm.startClock}` : ''
      const endDateTime = currentForm.endDateTime && currentForm.endClock ? `${currentForm.endDateTime}T${currentForm.endClock}` : ''
      try {
        const saved = await onAutoSaveRef.current({ ...currentForm, date: startDateTime, endDateTime, status: 'Draft' }, currentBanner)
        if (saved?.id) {
          const savedImages = Array.isArray(saved.bannerImages) ? saved.bannerImages : currentForm.bannerImages || []
          const syncedDraft = {
            ...currentForm,
            id: saved.id,
            status: 'Draft',
            banner: savedImages[0] || currentBanner,
            bannerImages: savedImages,
          }
          formRef.current = syncedDraft
          setForm((current) => current.id ? current : { ...current, id: saved.id })
          safeSetStored(draftKey, JSON.stringify(syncedDraft))
        }
      } catch (saveError) {
        setDraftSyncError(saveError.message || 'Draft saved on this device; server sync will retry.')
      }
    }
    onClose()
  }

  const submit = async (eventSubmit) => {
    eventSubmit.preventDefault()
    setError('')
    try {
      if (bannerProcessing) throw new Error('Wait for the event banners to finish preparing before publishing.')
      const status = eventSubmit.nativeEvent.submitter?.dataset.status || 'Published'
      if (!publishedAtOpen) await draftSyncQueueRef.current.catch(() => undefined)
      const submitForm = formRef.current
      const submitBanner = bannerRef.current || banner
      const startDateTime = submitForm.date && submitForm.startClock ? `${submitForm.date}T${submitForm.startClock}` : ''
      const endDateTime = submitForm.endDateTime && submitForm.endClock ? `${submitForm.endDateTime}T${submitForm.endClock}` : ''
      if (status === 'Published' && (!startDateTime || !endDateTime)) throw new Error('Choose both the event start and end date and time.')
      if (status === 'Published' && new Date(endDateTime).getTime() <= new Date(startDateTime).getTime()) {
        throw new Error('The event end time must be later than the start time.')
      }
      persistLocalDraft({ ...submitForm, status: 'Draft', banner: submitBanner, bannerImages: submitForm.bannerImages || [] }, submitBanner)
      const saved = await onSave({ ...submitForm, date: startDateTime, endDateTime, status, allowSimilar: false }, submitBanner)
      if (saved) {
        localStorage.removeItem(draftKey)
        setDraftSaved(false)
      }
    } catch (saveError) {
      setError(saveError.message || 'Unable to save event.')
    }
  }

  const saveDraft = async () => {
    if (bannerProcessing) {
      setError('Wait for the event banners to finish preparing before saving the draft.')
      return
    }
    try {
      await draftSyncQueueRef.current.catch(() => undefined)
      const draftForm = formRef.current
      const draftBanner = bannerRef.current || banner
      persistLocalDraft({ ...draftForm, status: 'Draft', banner: draftBanner, bannerImages: draftForm.bannerImages || [] }, draftBanner)
      const saved = await onSave(createSavePayload('Draft', false, draftForm), draftBanner)
      if (saved) {
        localStorage.removeItem(draftKey)
        setDraftSaved(false)
      }
    } catch (saveError) {
      setError(saveError.message || 'Unable to save event draft.')
    }
  }

  return (
    <div className="sheet-backdrop" role="presentation" onMouseDown={(eventClick) => { if (eventClick.target === eventClick.currentTarget) void closeEditor() }}>
      <section className="event-creation-panel glass-panel" role="dialog" aria-modal="true" aria-labelledby="event-editor-title">
        <button type="button" className="sheet-close" aria-label="Close event creation" onClick={() => { void closeEditor() }}><X size={18} /></button>
        <span className="eyebrow-label">EVENT STUDIO</span>
        <h2 id="event-editor-title">{form.id ? 'Edit campus event' : 'Create a campus event'}</h2>
        <form className="profile-form" onSubmit={submit} onBlur={saveDraftOnBlur}>
          <label htmlFor="event-title">Event title</label><input id="event-title" value={form.title} onChange={(eventChange) => update('title', eventChange.target.value)} placeholder="Name your event" required />
          <label htmlFor="event-category">Category</label><select id="event-category" value={form.category} onChange={(eventChange) => update('category', eventChange.target.value)} required><option value="">Select category</option>{categories.map((item) => <option key={item.id} value={item.id}>{item.label}</option>)}</select>
          <label htmlFor="event-activity">Event activity</label><textarea id="event-activity" rows={3} value={form.activity} onChange={(eventChange) => update('activity', eventChange.target.value)} placeholder="What should students expect?" required />
          <label htmlFor="event-date">Start date</label><EventDateField id="event-date" label="Start date" value={form.date} onChange={(value) => update('date', value)} required={form.status !== 'Draft'} />
          <TimeWheelPicker label="Start time" value={form.startClock} onChange={(value) => update('startClock', value)} />
          <label htmlFor="event-end-date">End date</label><EventDateField id="event-end-date" label="End date" value={form.endDateTime} onChange={(value) => update('endDateTime', value)} required={form.status !== 'Draft'} />
          <TimeWheelPicker label="End time" value={form.endClock} onChange={(value) => update('endClock', value)} />
          <label htmlFor="event-venue">Venue</label><input id="event-venue" value={form.venue} onChange={(eventChange) => update('venue', eventChange.target.value)} maxLength={120} placeholder="e.g. LT1 / SEET Complex" required />
          <label htmlFor="event-landmark">Landmark &amp; directions <span className="optional-field-label">Optional</span></label><textarea id="event-landmark" rows={2} value={form.venueLandmark} onChange={(eventChange) => update('venueLandmark', eventChange.target.value)} maxLength={240} placeholder="Add a nearby landmark or directions students can follow" />
          {form.category === 'seminars' && <><label htmlFor="event-meeting-url">Online seminar link (optional)</label><input id="event-meeting-url" type="url" inputMode="url" autoComplete="url" maxLength={2048} value={form.meetingUrl || ''} onChange={(eventChange) => update('meetingUrl', eventChange.target.value)} placeholder="https://meet.google.com/..." /><small className="profile-edit-limit">Students can open this link from the full event card.</small></>}
          <label htmlFor="event-banner">Event banner (optional)</label>
          <input ref={bannerInput} id="event-banner" type="file" accept="image/*" multiple hidden onChange={async (eventChange) => {
            const files = Array.from(eventChange.target.files || [])
            eventChange.target.value = ''
            if (!files.length) return
            if ((formRef.current.bannerImages?.length || 0) + files.length > MAX_EVENT_BANNERS) {
              setError(`Choose no more than ${MAX_EVENT_BANNERS} event banners.`)
              return
            }
            if (files.some((file) => file.size > 3 * 1024 * 1024)) {
              setError('Each event banner must be smaller than 3 MB.')
              return
            }
            setBannerProcessing(true)
            try {
              const dataUrls = await Promise.all(files.map((file) => compressBanner ? compressBanner(file) : new Promise((resolve, reject) => {
                const reader = new FileReader()
                reader.onload = () => resolve(reader.result)
                reader.onerror = () => reject(new Error('Unable to read the event banner.'))
                reader.readAsDataURL(file)
              })))
              updateBannerImages([...(formRef.current.bannerImages || []), ...dataUrls])
              setError('')
            } catch (readError) { setError(readError.message) }
            finally { setBannerProcessing(false) }
          }} />
          <button
            type="button"
            className={`event-banner-upload ${(form.bannerImages?.length || banner || form.banner) ? 'has-banner' : ''}`}
            disabled={bannerProcessing}
            aria-label={(form.bannerImages?.length || banner || form.banner) ? 'Add event banners' : 'Upload images'}
            onClick={() => bannerInput.current?.click()}
          >
            {form.bannerImages?.length || banner || form.banner
              ? <><strong>Event banners ({form.bannerImages?.length || 1}/{MAX_EVENT_BANNERS})</strong><span className="event-banner-action-label">Add more images</span></>
              : <><Sparkles size={24} /><strong>Event banners</strong><span>Optional · choose up to 5 images, each under 3 MB</span><b>Upload images</b></>}
          </button>
          {(form.bannerImages || []).length > 0 && (
            <div className="event-banner-image-list">
              {form.bannerImages.map((image, index) => (
                <div className="event-banner-image-item" key={`${index}-${image.slice(0, 32)}`}>
                  <img src={image} alt={`Event banner ${index + 1}`} />
                  <button type="button" className="event-banner-clear" aria-label={`Remove event banner ${index + 1}`} onClick={() => updateBannerImages(formRef.current.bannerImages.filter((_, imageIndex) => imageIndex !== index))}>Remove</button>
                </div>
              ))}
            </div>
          )}
          <fieldset className="audience-levels"><legend>Target audience levels</legend>{[['all', 'All levels'], ['100', '100'], ['200', '200'], ['300', '300'], ['400', '400'], ['500', '500']].map(([value, label]) => <label key={value}><input type="checkbox" checked={form.audience.includes(value)} onChange={(eventChange) => update('audience', eventChange.target.checked ? [...form.audience.filter((level) => level !== 'all' && value !== 'all'), value] : form.audience.filter((level) => level !== value))} /> {label}</label>)}</fieldset>
          {draftSaved && !publishedAtOpen && <p className="event-draft-status" role="status">{draftSyncing ? 'Saving draft…' : draftSyncError ? 'Draft saved on this device; server sync will retry.' : 'Draft saved automatically.'}</p>}
          {draftSyncError && <p className="form-error" role="status">{draftSyncError}</p>}
          {duplicateState?.matches?.length > 0 && (
            <section className={`event-duplicate-notice ${duplicateState.code === 'DUPLICATE_EVENT' ? 'is-blocked' : 'is-advisory'}`} role="alert">
              <strong>{duplicateState.code === 'DUPLICATE_EVENT' ? 'This event is already posted.' : 'A similar event was found.'}</strong>
              <p>{duplicateState.code === 'DUPLICATE_EVENT'
                ? 'The title, category, venue, start and end times, and event description match an existing post. Review it below before continuing.'
                : 'Review these close matches before confirming that your event is different.'}</p>
              <div className="event-duplicate-matches">
                {duplicateState.matches.map(({ event: match, score }) => (
                <button key={getEventId(match)} type="button" className="event-duplicate-match" disabled={saving || bannerProcessing} onClick={() => onOpenDuplicate?.(match)}>
                    <span><strong>{match.title}</strong><small>{match.category} · {match.venue}</small><small>{new Date(match.date || match.startTime).toLocaleString()} – {new Date(match.endTime).toLocaleString()}</small><small>{match.activity}</small></span>
                    <b>{score}%</b>
                  </button>
                ))}
              </div>
              {duplicateState.code === 'POSSIBLE_DUPLICATE' && (
                <button type="button" className="setup-submit event-duplicate-confirm" disabled={saving || bannerProcessing} onClick={async () => {
                  await draftSyncQueueRef.current.catch(() => undefined)
                  const latestForm = formRef.current
                  const saved = await onSave(createSavePayload('Published', true, latestForm), bannerRef.current || banner)
                  if (saved) {
                    localStorage.removeItem(draftKey)
                    setDraftSaved(false)
                  }
                }}>
                  This is a different event — continue publishing
                </button>
              )}
            </section>
          )}
          {error && <p className="form-error" role="alert">{error}</p>}
          <div className="event-form-actions">{!publishedAtOpen && <button type="button" className="event-draft-btn" disabled={saving || bannerProcessing} onClick={saveDraft}>Save draft</button>}<button className="setup-submit" type="submit" data-status="Published" disabled={saving || bannerProcessing}>{bannerProcessing ? 'Preparing banners…' : 'Publish event'} <span>→</span></button></div>
        </form>
      </section>
    </div>
  )
}

export default EventEditor
