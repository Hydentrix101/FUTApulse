import { useEffect, useState } from 'react'
import { Download, RefreshCw, X } from 'lucide-react'
import { useRegisterSW } from 'virtual:pwa-register/react'

let pendingInstallPrompt = null
const installPromptSubscribers = new Set()

if (typeof window !== 'undefined') {
  pendingInstallPrompt = window.__futapulseInstallPrompt || null
  window.addEventListener('futapulse-install-prompt', () => {
    pendingInstallPrompt = window.__futapulseInstallPrompt || null
    if (pendingInstallPrompt) {
      installPromptSubscribers.forEach((subscriber) => subscriber(pendingInstallPrompt))
    }
  })
}

function isStandalone() {
  return window.matchMedia('(display-mode: standalone)').matches
    || window.navigator.standalone === true
}

export default function PwaExperience() {
  const [installPrompt, setInstallPrompt] = useState(null)
  const [installed, setInstalled] = useState(isStandalone)
  const [installDismissed, setInstallDismissed] = useState(false)
  const [errorMessage, setErrorMessage] = useState('')
  const {
    offlineReady: [offlineReady, setOfflineReady],
    needRefresh: [needRefresh, setNeedRefresh],
    updateServiceWorker,
  } = useRegisterSW({
    immediate: true,
    onRegisterError(error) {
      console.error('FUTApulse service worker registration failed.', error)
    },
  })

  useEffect(() => {
    const captureInstallPrompt = (event) => setInstallPrompt(event)
    const markInstalled = () => {
      setInstalled(true)
      pendingInstallPrompt = null
      window.__futapulseInstallPrompt = null
      setInstallPrompt(null)
      setInstallDismissed(true)
    }
    const displayMode = window.matchMedia('(display-mode: standalone)')
    const updateDisplayMode = () => setInstalled(isStandalone())

    if (pendingInstallPrompt) captureInstallPrompt(pendingInstallPrompt)
    installPromptSubscribers.add(captureInstallPrompt)
    window.addEventListener('appinstalled', markInstalled)
    displayMode.addEventListener('change', updateDisplayMode)
    return () => {
      installPromptSubscribers.delete(captureInstallPrompt)
      window.removeEventListener('appinstalled', markInstalled)
      displayMode.removeEventListener('change', updateDisplayMode)
    }
  }, [])

  const showInstall = !installed && !installDismissed

  async function installApp() {
    const promptEvent = installPrompt || pendingInstallPrompt
    if (!promptEvent) {
      setErrorMessage('Your browser has not opened its install prompt yet. Open FUTApulse in your phone’s main browser and try Install again.')
      return
    }
    try {
      await promptEvent.prompt()
      const choice = await promptEvent.userChoice
      pendingInstallPrompt = null
      window.__futapulseInstallPrompt = null
      setInstallPrompt(null)
      if (choice.outcome === 'accepted') setInstalled(true)
      else setInstallDismissed(true)
    } catch (error) {
      console.error('FUTApulse installation prompt failed.', error)
      setErrorMessage('Installation could not start. Please try again from your browser menu.')
    }
  }

  async function applyUpdate() {
    try {
      await updateServiceWorker(true)
    } catch (error) {
      console.error('FUTApulse update could not be applied.', error)
      setErrorMessage('The update could not be applied. Please reload the page and try again.')
    }
  }

  return (
    <aside className="pwa-prompts" aria-live="polite">
      {showInstall && (
        <section className="pwa-prompt-card" aria-label="Install FUTApulse">
          <div className="pwa-prompt-icon"><Download size={19} aria-hidden="true" /></div>
          <div className="pwa-prompt-copy">
            <strong>Take FUTApulse with you</strong>
            <span>Install FUTApulse on your device for a faster, app-like experience.</span>
          </div>
          <button className="pwa-action-button" type="button" onClick={installApp}>Install</button>
          <button className="pwa-dismiss-button" type="button" aria-label="Dismiss install prompt" onClick={() => setInstallDismissed(true)}><X size={17} /></button>
        </section>
      )}
      {offlineReady && (
        <section className="pwa-prompt-card pwa-status-card" role="status">
          <div className="pwa-prompt-copy">
            <strong>Offline app shell is ready</strong>
            <span>Previously saved events remain available when you reconnect.</span>
          </div>
          <button className="pwa-dismiss-button" type="button" aria-label="Dismiss offline-ready message" onClick={() => setOfflineReady(false)}><X size={17} /></button>
        </section>
      )}
      {needRefresh && (
        <section className="pwa-prompt-card" role="status">
          <div className="pwa-prompt-icon"><RefreshCw size={19} aria-hidden="true" /></div>
          <div className="pwa-prompt-copy">
            <strong>FUTApulse update ready</strong>
            <span>Refresh to use the latest version.</span>
          </div>
          <button className="pwa-action-button" type="button" onClick={applyUpdate}>Refresh</button>
          <button className="pwa-dismiss-button" type="button" aria-label="Dismiss update prompt" onClick={() => setNeedRefresh(false)}><X size={17} /></button>
        </section>
      )}
      {errorMessage && (
        <section className="pwa-prompt-card pwa-error-card" role="alert">
          <div className="pwa-prompt-copy"><span>{errorMessage}</span></div>
          <button className="pwa-dismiss-button" type="button" aria-label="Dismiss message" onClick={() => setErrorMessage('')}><X size={17} /></button>
        </section>
      )}
    </aside>
  )
}
