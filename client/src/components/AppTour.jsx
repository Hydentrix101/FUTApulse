import { useCallback, useEffect, useState } from 'react'
import { ChevronLeft, ChevronRight, X } from 'lucide-react'

const STEPS = [
  { id: 'categories', target: '.category-filter-shell', eyebrow: 'STEP 1 OF 5', title: 'Browse the home feed', description: 'Filter campus events by Academic, Tech, Social, or any other category.' },
  { id: 'search', target: '.explore-search', eyebrow: 'STEP 2 OF 5', title: 'Find a specific event', description: 'Use Explore to search campus events by title or organizer.' },
  { id: 'reminders', target: '.reminders-content', eyebrow: 'STEP 3 OF 5', title: 'Keep track of what’s next', description: 'Events you’re anticipating and events you set reminders for are collected here.' },
  { id: 'create', target: '[data-tour="create-event"]', eyebrow: 'STEP 4 OF 5', title: 'Create a campus event', description: "Organizing a campus meetup? Use '+ Create Event' on your profile to publish it." },
  { id: 'event-actions', target: '.home-full-feed-view .event-card-actions-grid', eyebrow: 'STEP 5 OF 5', title: 'Interact from the full event card', description: 'On a full event card, Hype it, mark that you’re coming, set a reminder, share it, or report an issue.' },
]

function saveCompletion() {
  try { localStorage.setItem('futapulse_tour_completed', 'true') } catch { /* Storage may be disabled. */ }
}

export default function AppTour({ onClose, onStepChange }) {
  const [index, setIndex] = useState(0)
  const [targetRect, setTargetRect] = useState(null)
  const step = STEPS[index]

  const measureTarget = useCallback(() => {
    const target = document.querySelector(step.target)
    if (!target) {
      setTargetRect(null)
      return
    }
    const rect = target.getBoundingClientRect()
    setTargetRect(rect.width && rect.height ? { top: rect.top, right: rect.right, bottom: rect.bottom, left: rect.left } : null)
  }, [step.target])

  useEffect(() => {
    onStepChange?.(step.id)
    const frame = window.requestAnimationFrame(() => {
      document.querySelector(step.target)?.scrollIntoView({ block: 'center', behavior: 'smooth' })
      window.requestAnimationFrame(measureTarget)
    })
    const observer = new ResizeObserver(measureTarget)
    observer.observe(document.documentElement)
    window.addEventListener('resize', measureTarget)
    window.addEventListener('scroll', measureTarget, true)
    return () => {
      window.cancelAnimationFrame(frame)
      observer.disconnect()
      window.removeEventListener('resize', measureTarget)
      window.removeEventListener('scroll', measureTarget, true)
    }
  }, [measureTarget, onStepChange, step.id])

  const finish = () => { saveCompletion(); onClose() }
  const next = () => {
    if (index === STEPS.length - 1) finish()
    else setIndex((current) => current + 1)
  }

  return (
    <div className="app-tour" role="presentation">
      {targetRect ? <>
        <div className="app-tour-mask app-tour-mask-top" style={{ height: Math.max(0, targetRect.top - 8) }} />
        <div className="app-tour-mask app-tour-mask-left" style={{ top: Math.max(0, targetRect.top - 8), width: Math.max(0, targetRect.left - 8), height: targetRect.bottom - targetRect.top + 16 }} />
        <div className="app-tour-mask app-tour-mask-right" style={{ top: Math.max(0, targetRect.top - 8), left: targetRect.right + 8, height: targetRect.bottom - targetRect.top + 16 }} />
        <div className="app-tour-mask app-tour-mask-bottom" style={{ top: targetRect.bottom + 8 }} />
        <div className={`app-tour-spotlight${step.id === 'create' ? ' is-blocking' : ''}`} style={{ top: targetRect.top - 8, left: targetRect.left - 8, width: targetRect.right - targetRect.left + 16, height: targetRect.bottom - targetRect.top + 16 }} />
      </> : <div className="app-tour-mask app-tour-mask-full" />}
      <section className={`app-tour-card${targetRect ? ' has-target' : ''}`} role="dialog" aria-modal="true" aria-labelledby="app-tour-title">
        <button type="button" className="app-tour-close" aria-label="Skip app tour" onClick={finish}><X size={18} /></button>
        <span className="app-tour-eyebrow">{step.eyebrow}</span>
        <h2 id="app-tour-title">{step.title}</h2>
        <p>{step.description}</p>
        <div className="app-tour-progress" aria-label={`Step ${index + 1} of ${STEPS.length}`}>
          {STEPS.map((item, itemIndex) => <span key={item.id} className={itemIndex <= index ? 'is-active' : ''} />)}
        </div>
        <div className="app-tour-controls">
          <button type="button" className="app-tour-skip" onClick={finish}>Skip</button>
          <div>
            {index > 0 && <button type="button" className="app-tour-back" onClick={() => setIndex((current) => current - 1)}><ChevronLeft size={16} /> Back</button>}
            <button type="button" className="app-tour-next" onClick={next}>{index === STEPS.length - 1 ? 'Done' : 'Next'} {index < STEPS.length - 1 && <ChevronRight size={16} />}</button>
          </div>
        </div>
      </section>
    </div>
  )
}
