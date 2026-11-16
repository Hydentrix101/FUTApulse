export const CREDENTIAL_REQUEST_TIMEOUT_MS = 10_000

const isCredentialEndpoint = (endpoint) => ['/api/auth/login', '/api/auth/signup'].includes(endpoint)

export async function authRequest(endpoint, options = {}, baseUrl = '', fetchRequest = globalThis.fetch) {
  const { timeoutMs = isCredentialEndpoint(endpoint) ? CREDENTIAL_REQUEST_TIMEOUT_MS : 30_000, signal: requestSignal, ...requestOptions } = options
  const timeoutSignal = AbortSignal.timeout(timeoutMs)
  try {
    const response = await fetchRequest(`${baseUrl}${endpoint}`, {
      ...requestOptions,
      credentials: 'include',
      headers: {
        ...(options.body ? { 'Content-Type': 'application/json' } : {}),
        ...options.headers,
      },
      signal: requestSignal ? AbortSignal.any([requestSignal, timeoutSignal]) : timeoutSignal,
    })
    let result
    try {
      result = await response.json()
    } catch (error) {
      if (timeoutSignal.aborted || requestSignal?.aborted) throw error
      result = {}
    }
    if (!response.ok) {
      const message = response.status === 401 && endpoint === '/api/auth/login'
        ? 'Invalid username or password. Check your details and try again.'
        : response.status === 429
          ? 'Too many attempts. Please wait a moment before trying again.'
          : response.status >= 500
            ? 'FUTApulse is temporarily unavailable. Please try again shortly.'
            : result.error || `The request could not be completed (${response.status}).`
      const error = new Error(message)
      error.status = response.status
      error.code = result.code
      throw error
    }
    return result
  } catch (error) {
    if (requestSignal?.aborted && !timeoutSignal.aborted) throw error
    if (timeoutSignal.aborted || error.name === 'AbortError' || error.name === 'TimeoutError') {
      throw new Error('Network timeout. Check your connection and try again.', { cause: error })
    }
    if (error instanceof TypeError) {
      throw new Error('Could not connect to FUTApulse. Check your internet connection and try again.', { cause: error })
    }
    throw error
  }
}
