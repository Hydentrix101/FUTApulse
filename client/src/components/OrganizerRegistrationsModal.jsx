import { useEffect, useRef } from 'react'
import { Download, LoaderCircle, RefreshCw, X } from 'lucide-react'
import { formatCampusDateTime } from '../utils/campusTime'

function csvCell(value) {
  const text = String(value ?? '')
  const safeText = /^[\t\r ]*[=+\-@]/.test(text) ? `'${text}` : text
  return `"${safeText.replace(/"/g, '""')}"`
}

function downloadRegistrations(event, registrations) {
  const fields = Array.isArray(event.registrationFields) ? event.registrationFields : []
  const headers = ['Attendee name', 'Username', 'Faculty', 'Level', 'Registered at', ...fields.map((field) => field.label)]
  const rows = registrations.map((registration) => {
    const answers = new Map((registration.answers || []).map((answer) => [answer.fieldId, answer.answer]))
    return [
      registration.user?.name || '',
      registration.user?.username || '',
      registration.user?.faculty || '',
      registration.user?.level || '',
      registration.createdAt || '',
      ...fields.map((field) => answers.get(field.id) ?? ''),
    ]
  })
  const content = `\uFEFF${[headers, ...rows].map((row) => row.map(csvCell).join(',')).join('\r\n')}`
  const blobUrl = URL.createObjectURL(new Blob([content], { type: 'text/csv;charset=utf-8' }))
  const anchor = document.createElement('a')
  const safeTitle = String(event.title || 'event-registrations')
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-zA-Z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .toLowerCase()
  anchor.href = blobUrl
  anchor.download = `${safeTitle || 'event'}-registrations.csv`
  document.body.append(anchor)
  anchor.click()
  anchor.remove()
  window.setTimeout(() => URL.revokeObjectURL(blobUrl), 0)
}

function OrganizerRegistrationsModal({ event, registrations, loading, error, onRetry, onClose }) {
  const dialogRef = useRef(null)

  useEffect(() => {
    const previousFocus = document.activeElement
    const handleKeyDown = (keyboardEvent) => {
      if (keyboardEvent.key === 'Escape') {
        onClose()
        return
      }
      if (keyboardEvent.key !== 'Tab') return
      const focusable = dialogRef.current?.querySelectorAll('button:not(:disabled)')
      if (!focusable?.length) return
      const first = focusable[0]
      const last = focusable[focusable.length - 1]
      if (keyboardEvent.shiftKey && document.activeElement === first) {
        keyboardEvent.preventDefault()
        last.focus()
      } else if (!keyboardEvent.shiftKey && document.activeElement === last) {
        keyboardEvent.preventDefault()
        first.focus()
      }
    }
    document.addEventListener('keydown', handleKeyDown)
    document.body.classList.add('registration-modal-open')
    dialogRef.current?.querySelector('button')?.focus()
    return () => {
      document.removeEventListener('keydown', handleKeyDown)
      document.body.classList.remove('registration-modal-open')
      if (previousFocus instanceof HTMLElement) previousFocus.focus()
    }
  }, [onClose])

  return (
    <div
      className="organizer-registrations-backdrop"
      role="presentation"
      onMouseDown={(mouseEvent) => {
        if (mouseEvent.target === mouseEvent.currentTarget) onClose()
      }}
    >
      <section
        ref={dialogRef}
        className="organizer-registrations-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="organizer-registrations-title"
        aria-busy={loading}
      >
        <button type="button" className="organizer-registrations-close" aria-label="Close registrations" onClick={onClose}>
          <X size={20} />
        </button>
        <span className="organizer-registrations-eyebrow">ATTENDEE MANAGEMENT</span>
        <h2 id="organizer-registrations-title">Registrations</h2>
        <p className="organizer-registrations-event-title">{event.title}</p>
        <div className="organizer-registrations-toolbar">
          <span role="status">{loading ? 'Loading registrations…' : `${registrations.length} ${registrations.length === 1 ? 'attendee' : 'attendees'}`}</span>
          <button
            type="button"
            className="organizer-registrations-export"
            disabled={loading || Boolean(error) || !registrations.length}
            onClick={() => downloadRegistrations(event, registrations)}
          >
            <Download size={16} aria-hidden="true" /> Download CSV
          </button>
        </div>
        {error ? (
          <div className="organizer-registrations-error" role="alert">
            <p>{error}</p>
            <button type="button" className="organizer-registrations-retry" onClick={onRetry}>
              <RefreshCw size={15} aria-hidden="true" /> Try again
            </button>
          </div>
        ) : loading ? (
          <div className="organizer-registrations-loading" role="status">
            <LoaderCircle size={23} className="organizer-registrations-spinner" aria-hidden="true" />
            Loading attendee responses…
          </div>
        ) : registrations.length ? (
          <div className="organizer-registrations-list">
            {registrations.map((registration, index) => (
              <article className="organizer-registration-card" key={`${registration.user?.id || registration.user?.username || 'attendee'}-${index}`}>
                <header className="organizer-registration-attendee">
                  <div>
                    <strong>{registration.user?.name || registration.user?.username || 'FUTApulse attendee'}</strong>
                    {registration.user?.username && <span>@{registration.user.username}</span>}
                  </div>
                  <time dateTime={registration.createdAt}>
                    {registration.createdAt ? formatCampusDateTime(registration.createdAt, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }) : 'Registration time unavailable'}
                  </time>
                </header>
                <div className="organizer-registration-badges">
                  {registration.user?.faculty && <span>{registration.user.faculty}</span>}
                  {registration.user?.level && <span>{registration.user.level}L</span>}
                </div>
                {Array.isArray(registration.answers) && registration.answers.length > 0 ? (
                  <dl className="organizer-registration-answers">
                    {registration.answers.map((answer) => (
                      <div key={answer.fieldId}>
                        <dt>{answer.label}</dt>
                        <dd>{String(answer.answer ?? '') || '—'}</dd>
                      </div>
                    ))}
                  </dl>
                ) : <p className="organizer-registration-no-answers">No custom answers were included.</p>}
              </article>
            ))}
          </div>
        ) : (
          <p className="organizer-registrations-empty">No attendees have registered for this event yet.</p>
        )}
      </section>
    </div>
  )
}

export default OrganizerRegistrationsModal
