const configuredApiBaseUrl = import.meta.env.VITE_API_BASE_URL?.trim()
const isLocalPreview = typeof window !== 'undefined'
  && ['localhost', '127.0.0.1'].includes(window.location.hostname)

const normalizedApiBaseUrl = configuredApiBaseUrl?.replace(/\/+$/, '')

// Production uses the Vercel same-origin rewrite; local development calls the
// Express API directly unless an API origin is explicitly configured.
export const API_BASE_URL = import.meta.env.PROD && !isLocalPreview
  ? ''
  : normalizedApiBaseUrl || 'http://localhost:3001'
