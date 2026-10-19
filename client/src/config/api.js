const configuredApiBaseUrl = import.meta.env.VITE_API_BASE_URL?.trim()
const isLocalPreview = typeof window !== 'undefined'
  && ['localhost', '127.0.0.1'].includes(window.location.hostname)

// Vite's dev server talks to the local Express API by default. Vercel production
// leaves this empty and uses client/vercel.json to proxy /api to Render, keeping
// authenticated requests on the app origin for SameSite=Lax cookies. A Render
// API calls from a deployed phone app must use its own origin so SameSite=Lax
// refresh cookies work. Vercel rewrites /api to Render; other hosts should add
// the same kind of reverse proxy. Local development/preview can use an API URL.
export const API_BASE_URL = import.meta.env.PROD && !isLocalPreview
  ? ''
  : configuredApiBaseUrl
    ? configuredApiBaseUrl.replace(/\/+$/, '')
    : 'http://localhost:3001'
