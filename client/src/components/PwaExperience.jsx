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
    if (isAppleMobileDevice()) {
      return 'On iPhone or iPad, open this page in Safari, tap Share, choose “Add to Home Screen”, then tap Add. iOS does not let websites open this system prompt directly.'
    }
    if (/Android/i.test(navigator.userAgent)) {
      if (/SamsungBrowser/i.test(navigator.userAgent)) {
        return 'In Samsung Internet, open the menu, tap “Add page to”, then choose “Home screen” and confirm.'
      }
      if (/Firefox/i.test(navigator.userAgent)) {
        return 'In Firefox, open the menu (⋮), tap “Install”, then confirm.'
      }
      if (/EdgA|EdgiOS|Edg/i.test(navigator.userAgent)) {
        return 'In Microsoft Edge, open the menu (⋯), choose “Apps” or “Add to phone”, then install FUTApulse.'
      }
      return 'In Chrome, tap the menu (⋮) in the top-right. Choose “Install app” or “Add to Home screen”, then confirm. If neither option appears, open FUTApulse in Chrome (not inside another app) and check again later. The browser controls when it can show the install prompt.'
    }
    if (/Edg|Chrome/i.test(navigator.userAgent)) {
      return 'Open the browser menu and choose “Install FUTApulse” or “Install page as app”. If that option is missing, this browser has not made its install prompt available yet.'
    }
    return 'Open FUTApulse in your browser menu and look for “Install” or “Add to Home Screen”. Some browsers only offer this option from their Share or menu controls.'
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
            <span>{manualInstallAvailable ? 'Install FUTApulse on your device for a faster, app-like experience.' : 'Add FUTApulse to your device for a fast, app-like campus experience.'}</span>
          </div>
          <button className="pwa-action-button" type="button" onClick={installApp}>Install</button>
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
