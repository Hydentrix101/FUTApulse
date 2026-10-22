import { useEffect, useState } from 'react'
import { Download, RefreshCw, X } from 'lucide-react'
import { useRegisterSW } from 'virtual:pwa-register/react'

function isAppleMobileDevice() {
  return /iPhone|iPad|iPod/i.test(navigator.userAgent)
    || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1)
}

function isStandalone() {
  return window.matchMedia('(display-mode: standalone)').matches
    || window.navigator.standalone === true
}

export default function PwaExperience() {
  const [installPrompt, setInstallPrompt] = useState(null)
  const [installed, setInstalled] = useState(isStandalone)
  const [installDismissed, setInstallDismissed] = useState(false)
  const [showInstallInstructions, setShowInstallInstructions] = useState(false)
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
    const captureInstallPrompt = (event) => {
      event.preventDefault()
      setInstallPrompt(event)
    }
    const markInstalled = () => {
      setInstalled(true)
      setInstallPrompt(null)
      setInstallDismissed(true)
    }
    const displayMode = window.matchMedia('(display-mode: standalone)')
    const updateDisplayMode = () => setInstalled(isStandalone())

    window.addEventListener('beforeinstallprompt', captureInstallPrompt)
    window.addEventListener('appinstalled', markInstalled)
    displayMode.addEventListener('change', updateDisplayMode)
    return () => {
      window.removeEventListener('beforeinstallprompt', captureInstallPrompt)
      window.removeEventListener('appinstalled', markInstalled)
      displayMode.removeEventListener('change', updateDisplayMode)
    }
  }, [])

  const manualInstallAvailable = !installed && !installPrompt
  const showInstall = !installed && !installDismissed

  async function installApp() {
    if (!installPrompt) {
      setShowInstallInstructions(true)
      return
    }
    try {
      await installPrompt.prompt()
      const choice = await installPrompt.userChoice
      setInstallPrompt(null)
      if (choice.outcome === 'accepted') setInstalled(true)
      else setInstallDismissed(true)
    } catch (error) {
      console.error('FUTApulse installation prompt failed.', error)
      setErrorMessage('Installation could not start. Please try again from your browser menu.')
    }
  }

  function getInstallInstructions() {
    if (isAppleMobileDevice()) return 'In Safari, tap Share, then choose “Add to Home Screen”.'
    if (/Android/i.test(navigator.userAgent)) return 'Open your browser menu (⋮), then choose “Install app” or “Add to Home screen”.'
    if (/Edg|Chrome/i.test(navigator.userAgent)) return 'Use the install icon in the address bar or choose “Install FUTApulse” from your browser menu.'
    return 'Open your browser menu and choose “Install app” or “Add to Home Screen” if available.'
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
            <span>{manualInstallAvailable ? 'Add FUTApulse to your device for a faster, app-like experience.' : 'Install FUTApulse for a fast, app-like campus experience.'}</span>
          </div>
          <button className="pwa-action-button" type="button" onClick={installApp}>{manualInstallAvailable ? 'How to install' : 'Install'}</button>
          <button className="pwa-dismiss-button" type="button" aria-label="Dismiss install prompt" onClick={() => setInstallDismissed(true)}><X size={17} /></button>
        </section>
      )}
      {showInstallInstructions && (
        <section className="pwa-prompt-card pwa-instructions" aria-label="Install FUTApulse instructions">
          <div className="pwa-prompt-copy">
            <strong>Install FUTApulse</strong>
            <span>{getInstallInstructions()}</span>
          </div>
          <button className="pwa-dismiss-button" type="button" aria-label="Close install instructions" onClick={() => setShowInstallInstructions(false)}><X size={17} /></button>
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
