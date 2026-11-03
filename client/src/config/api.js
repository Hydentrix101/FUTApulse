const configuredApiBaseUrl = import.meta.env.VITE_API_BASE_URL?.trim()
const isLocalPreview = typeof window !== 'undefined'
  && ['localhost', '127.0.0.1'].includes(window.location.hostname)

const normalizedApiBaseUrl = configuredApiBaseUrl?.replace(/\/+$/, '')
const configuredSocketBaseUrl = import.meta.env.VITE_SOCKET_URL?.trim()

// The custom domain is the production app origin; Vercel proxies its /api
// requests to Render. Local development calls Express directly unless configured.
export const API_BASE_URL = import.meta.env.PROD && !isLocalPreview
  ? ''
  : normalizedApiBaseUrl || 'http://localhost:3001'

// Socket.IO is not proxied by Vercel, so realtime uses Render directly while
// REST requests retain the same-origin custom-domain proxy.
export const SOCKET_BASE_URL = configuredSocketBaseUrl?.replace(/\/+$/, '')
  || (import.meta.env.PROD && !isLocalPreview
    ? normalizedApiBaseUrl || 'https://futapulse.onrender.com'
    : API_BASE_URL)
