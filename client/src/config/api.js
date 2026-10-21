import { Capacitor } from '@capacitor/core'

const configuredApiBaseUrl = import.meta.env.VITE_API_BASE_URL?.trim()
const isLocalPreview = typeof window !== 'undefined'
  && ['localhost', '127.0.0.1'].includes(window.location.hostname)
const isNativePlatform = Capacitor.isNativePlatform()

const normalizedApiBaseUrl = configuredApiBaseUrl?.replace(/\/+$/, '')

if (isNativePlatform && !normalizedApiBaseUrl) {
  throw new Error('VITE_API_BASE_URL must be set when building FUTApulse for a native platform.')
}

// The hosted web app uses Vercel's same-origin /api rewrite. Native builds run
// at https://localhost and must call the configured HTTPS API origin directly.
export const API_BASE_URL = isNativePlatform
  ? normalizedApiBaseUrl
  : import.meta.env.PROD && !isLocalPreview
    ? ''
    : normalizedApiBaseUrl || 'http://localhost:3001'
