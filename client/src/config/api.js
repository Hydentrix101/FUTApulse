const configuredApiBaseUrl = import.meta.env.VITE_API_BASE_URL?.trim()

// Vite's dev server talks to the local Express API by default. Hosted builds can
// point at a separate API host, or leave this empty when the host proxies /api.
export const API_BASE_URL = configuredApiBaseUrl
  ? configuredApiBaseUrl.replace(/\/+$/, '')
  : import.meta.env.DEV
    ? 'http://localhost:3001'
    : ''
