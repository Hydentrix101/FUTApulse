const configuredApiBaseUrl = import.meta.env.VITE_API_BASE_URL?.trim()

// Vite's dev server talks to the local Express API by default. Vercel production
// leaves this empty and uses client/vercel.json to proxy /api to Render, keeping
// authenticated requests on the app origin for SameSite=Lax cookies. Other
// deployments can set VITE_API_BASE_URL to their API origin at build time.
export const API_BASE_URL = configuredApiBaseUrl
  ? configuredApiBaseUrl.replace(/\/+$/, '')
  : import.meta.env.DEV
    ? 'http://localhost:3001'
    : ''
