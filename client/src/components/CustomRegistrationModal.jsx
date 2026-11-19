import { useEffect, useRef, useState } from 'react'
import { LoaderCircle, X } from 'lucide-react'

function getInitialAnswers(fields) {
  return Object.fromEntries(fields.map((field) => [field.id, '']))
}

function getRegistrationError(error) {
  if (error?.status === 409) return error.message || 'You are already registered for this event.'
  if (error?.status === 400) return error.message || 'Check your answers and try again.'
  return error?.message || 'Unable to submit your registration. Please try again.'
}

function CustomRegistrationModal({ event, onClose, onSubmit }) {
  const fields = Array.isArray(event?.registrationFields) ? event.registrationFields : []
  const [answers, setAnswers] = useState(() => getInitialAnswers(fields))
  const [submitting, setSubmitting] = useState(false)
  const [errorMessage, setErrorMessage] = useState('')
  const submittingRef = useRef(false)
  const dialogRef = useRef(null)

  const updateSubmitting = (value) => {
    submittingRef.current = value
    setSubmitting(value)
  }

  useEffect(() => {
    const previousFocus = document.activeElement
    const handleKeyDown = (keyboardEvent) => {
      if (keyboardEvent.key === 'Escape' && !submittingRef.current) {
        onClose()
        return
      }
      if (keyboardEvent.key !== 'Tab') return
      const focusable = dialogRef.current?.querySelectorAll('button:not(:disabled), input:not(:disabled), select:not(:disabled)')
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
    dialogRef.current?.querySelector('input:not(:disabled), select:not(:disabled)')?.focus()
    return () => {
      document.removeEventListener('keydown', handleKeyDown)
      document.body.classList.remove('registration-modal-open')
      if (previousFocus instanceof HTMLElement) previousFocus.focus()
    }
  }, [onClose])

  const updateAnswer = (fieldId, value) => {
    setAnswers((current) => ({ ...current, [fieldId]: value }))
    setErrorMessage('')
  }

  const submitRegistration = async (submitEvent) => {
    submitEvent.preventDefault()
    if (submittingRef.current) return
    updateSubmitting(true)
    setErrorMessage('')
    let closeAfterSubmit = false
    try {
      const normalizedAnswers = Object.fromEntries(
        fields.map((field) => {
          const value = answers[field.id]
          return [field.id, field.type === 'number' && value !== '' ? Number(value) : value]
        }),
      )
      const result = await onSubmit(normalizedAnswers)
      closeAfterSubmit = result?.alreadyRegistered === true || result?.success === true
    } catch (error) {
      setErrorMessage(getRegistrationError(error))
    } finally {
      updateSubmitting(false)
    }
    if (closeAfterSubmit) onClose()
  }

  return (
    <div
      className="custom-registration-backdrop"
      role="presentation"
      onMouseDown={(mouseEvent) => {
        if (mouseEvent.target === mouseEvent.currentTarget && !submitting) onClose()
      }}
    >
      <section
        ref={dialogRef}
        className="custom-registration-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="custom-registration-title"
        aria-describedby="custom-registration-description"
      >
        <button
          type="button"
          className="custom-registration-close"
          aria-label="Close registration form"
          disabled={submitting}
          onClick={onClose}
        >
          <X size={20} />
        </button>
        <span className="custom-registration-eyebrow">EVENT REGISTRATION</span>
        <h2 id="custom-registration-title">{event?.title || 'Register for this event'}</h2>
        <p id="custom-registration-description" className="custom-registration-description">
          Complete the questions below to confirm your attendance.
        </p>

        <form className="custom-registration-form" onSubmit={submitRegistration}>
          {fields.map((field) => (
            <label className="custom-registration-field" key={field.id}>
              <span>
                {field.label}
                {field.required && <strong aria-hidden="true"> *</strong>}
              </span>
              {field.type === 'select' ? (
                <select
                  required={field.required}
                  value={answers[field.id] ?? ''}
                  onChange={(changeEvent) => updateAnswer(field.id, changeEvent.target.value)}
                  disabled={submitting}
                >
                  <option value="">Choose an option</option>
                  {(Array.isArray(field.options) ? field.options : []).map((option) => (
                    <option key={option} value={option}>{option}</option>
                  ))}
                </select>
              ) : (
                <input
                  type={field.type === 'number' ? 'number' : 'text'}
                  inputMode={field.type === 'number' ? 'decimal' : undefined}
                  step={field.type === 'number' ? 'any' : undefined}
                  maxLength={field.type === 'text' ? 2000 : undefined}
                  required={field.required}
                  value={answers[field.id] ?? ''}
                  onChange={(changeEvent) => updateAnswer(field.id, changeEvent.target.value)}
                  disabled={submitting}
                />
              )}
            </label>
          ))}
          {errorMessage && <p className="custom-registration-error" role="alert">{errorMessage}</p>}
          <button type="submit" className="custom-registration-submit" disabled={submitting}>
            {submitting ? (
              <><LoaderCircle size={17} className="custom-registration-spinner" aria-hidden="true" /> Submitting…</>
            ) : 'Submit registration'}
          </button>
          <button type="button" className="custom-registration-cancel" disabled={submitting} onClick={onClose}>
            Cancel
          </button>
        </form>
      </section>
    </div>
  )
}

export default CustomRegistrationModal
