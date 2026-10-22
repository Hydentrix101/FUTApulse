const configuredApiBaseUrl = import.meta.env.VITE_API_BASE_URL?.trim()
const isLocalPreview = typeof window !== 'undefined'
  && ['localhost', '127.0.0.1'].includes(window.location.hostname)

const normalizedApiBaseUrl = configuredApiBaseUrl?.replace(/\/+$/, '')
const configuredSocketBaseUrl = import.meta.env.VITE_SOCKET_URL?.trim()

// Production uses the Vercel same-origin rewrite; local development calls the
// Express API directly unless an API origin is explicitly configured.
export const API_BASE_URL = import.meta.env.PROD && !isLocalPreview
  ? ''
  : normalizedApiBaseUrl || 'http://localhost:3001'

// Socket.IO is not proxied by Vercel, so production realtime connections go
// directly to the Render API while REST requests retain the same-origin proxy.
export const SOCKET_BASE_URL = configuredSocketBaseUrl?.replace(/\/+$/, '')
  || (import.meta.env.PROD && !isLocalPreview
    ? normalizedApiBaseUrl || 'https://futapulse.onrender.com'
    : API_BASE_URL)
