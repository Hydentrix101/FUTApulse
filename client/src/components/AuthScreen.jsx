import { useEffect, useRef, useState } from 'react'
import { CheckCircle2, Eye, EyeOff, LoaderCircle } from 'lucide-react'
import BrandHeart from './BrandHeart'

import { API_BASE_URL } from '../config/api'
import { isValidUsername } from '../utils/usernames'
let googleIdentityServicesPromise

async function request(endpoint, options = {}) {
  const { timeoutMs = 30000, ...requestOptions } = options
  let response
  try {
    response = await fetch(`${API_BASE_URL}${endpoint}`, {
      ...requestOptions,
      credentials: 'include',
      headers: {
        ...(options.body ? { 'Content-Type': 'application/json' } : {}),
        ...options.headers,
      },
      signal: requestOptions.signal || AbortSignal.timeout(timeoutMs),
    })
  } catch (error) {
    if (error.name === 'AbortError' || error.name === 'TimeoutError') {
      throw new Error('The FUTApulse server took too long to respond. Your details were not confirmed; please retry.', { cause: error })
    }
    if (error instanceof TypeError) {
      throw new Error('FUTApulse could not reach its server. Check your connection and retry; no action was confirmed.', { cause: error })
    }
    throw error
  }
  const result = await response.json().catch(() => ({}))
  if (!response.ok) throw new Error(result.error || `Request failed (${response.status}).`)
  return result
}

function requireSessionResponse(result) {
  if (!result?.token || !result?.user) {
    throw new Error('The FUTApulse server responded without confirming a sign-in. Please retry.')
  }
  return result
}

function suggestedUsername(name, email = '') {
  for (const candidate of [name, email.split('@')[0], 'student']) {
    const suggestion = String(candidate || '').trim().slice(0, 24)
    if (isValidUsername(suggestion)) return suggestion
  }
  return 'student'
}

async function loadGoogleIdentityServices() {
  if (window.google?.accounts?.oauth2) return window.google
  if (!googleIdentityServicesPromise) {
    googleIdentityServicesPromise = new Promise((resolve, reject) => {
      const existingScript = document.querySelector('script[data-google-identity-services]')
      const script = existingScript || document.createElement('script')
      const onLoad = () => {
        if (window.google?.accounts?.oauth2) {
          script.dataset.loaded = 'true'
          resolve(window.google)
        } else {
          reject(new Error('Google sign-in did not initialize. Please retry.'))
        }
      }
      const onError = () => {
        script.remove()
        reject(new Error('Unable to load Google sign-in. Check your connection and retry.'))
      }
      if (existingScript?.dataset.loaded === 'true') {
        reject(new Error('Google sign-in did not initialize. Reload the page and retry.'))
        return
      }
      script.addEventListener('load', onLoad, { once: true })
      script.addEventListener('error', onError, { once: true })
      if (!existingScript) {
        script.src = 'https://accounts.google.com/gsi/client'
        script.async = true
        script.defer = true
        script.dataset.googleIdentityServices = 'true'
        document.head.appendChild(script)
      }
    }).catch((error) => {
      googleIdentityServicesPromise = undefined
      throw error
    })
  }
  return googleIdentityServicesPromise
}

function getPasswordStrength(password) {
  const checks = [
    { key: 'length', label: 'More than 6 characters', met: password.length > 6 },
    { key: 'upper', label: 'Uppercase letter', met: /[A-Z]/.test(password) },
    { key: 'number', label: 'At least one number', met: /\d/.test(password) },
  ]
  const metCount = checks.filter(({ met }) => met).length
  const normalized = password ? Math.min(4, Math.max(0, Math.round((metCount / checks.length) * 4))) : 0

  const strength = !password
    ? { label: 'No password', tone: 'text-slate-300', bar: 'bg-slate-500' }
    : normalized <= 1
      ? { label: 'Weak', tone: 'text-rose-300', bar: 'bg-rose-400' }
      : normalized === 2
        ? { label: 'Fair', tone: 'text-amber-300', bar: 'bg-amber-400' }
        : normalized === 3
          ? { label: 'Good', tone: 'text-sky-300', bar: 'bg-sky-400' }
          : { label: 'Strong', tone: 'text-emerald-300', bar: 'bg-emerald-400' }

  return { ...strength, checks, metCount, normalized }
}

function PasswordField({ label, value, onChange, autoComplete, minLength = 6, placeholder, ariaInvalid = false, ariaDescribedBy }) {
  const [visible, setVisible] = useState(false)

  return (
    <label className="auth-field">
      <span>{label}</span>
      <span className="auth-password-control">
        <input
          type={visible ? 'text' : 'password'}
          autoComplete={autoComplete}
          minLength={minLength}
          maxLength={128}
          placeholder={placeholder}
          value={value}
          onChange={onChange}
          aria-invalid={ariaInvalid}
          aria-describedby={ariaDescribedBy}
          required
        />
        <button type="button" onClick={() => setVisible((current) => !current)} aria-label={visible ? `Hide ${label.toLowerCase()}` : `Show ${label.toLowerCase()}`}>
          {visible ? <EyeOff size={18} /> : <Eye size={18} />}
        </button>
      </span>
    </label>
  )
}

function PasswordStrengthMeter({ password, minLength, idPrefix, show = true }) {
  if (!show || !password) return null

  const strength = getPasswordStrength(password, minLength)

  return (
    <div id={`${idPrefix}-strength`} className="mt-2" role="status" aria-live="polite" aria-atomic="true">
      <div className="mb-1 flex items-center justify-between gap-3 text-[11px] font-medium text-slate-300">
        <span>Password strength</span>
        <span className={strength.tone}>{strength.label}</span>
      </div>
      <div className="flex gap-1" aria-hidden="true">
        {[0, 1, 2, 3].map((segment) => (
          <span
            key={segment}
            className={`h-1.5 flex-1 rounded-full ${segment < strength.normalized ? strength.bar : 'bg-slate-700'}`}
          />
        ))}
      </div>
      <ul className="mt-2 grid gap-1 text-[11px] text-slate-300">
        {strength.checks.map(({ key, label, met }) => (
          <li key={key} className={`flex items-center gap-2 ${met ? 'text-emerald-300' : 'text-slate-400'}`}>
            <span aria-hidden="true">{met ? '✓' : '•'}</span>
            <span>{label}</span>
          </li>
        ))}
      </ul>
    </div>
  )
}

function isValidNewPassword(password) {
  return password.length > 6 && /[A-Z]/.test(password) && /\d/.test(password)
}

function AuthScreen({ onAuthenticated, initialUsername = '', initialMode = 'login' }) {
  const [mode, setMode] = useState(initialMode)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [serverStatus, setServerStatus] = useState('')
  const [remember, setRemember] = useState(true)
  const [username, setUsername] = useState(initialUsername)
  const [usernameAvailability, setUsernameAvailability] = useState({ username: '', status: 'idle', message: '' })
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [googleEmail, setGoogleEmail] = useState('')
  const [googleUsername, setGoogleUsername] = useState('')
  const [googlePassword, setGooglePassword] = useState('')
  const [googleConfirmPassword, setGoogleConfirmPassword] = useState('')
  const [resetToken, setResetToken] = useState('')
  const [resetCodeVerification, setResetCodeVerification] = useState({ key: '', status: 'idle' })
  const [resetPassword, setResetPassword] = useState('')
  const [confirmResetPassword, setConfirmResetPassword] = useState('')
  const [googleSignupToken, setGoogleSignupToken] = useState('')
  const [googlePasswordSetupToken, setGooglePasswordSetupToken] = useState('')
  const [resetMessage, setResetMessage] = useState('')
  const googleTimeoutRef = useRef(null)

  const signupPasswordMismatch = mode === 'signup' && confirmPassword.length > 0 && password !== confirmPassword
  const resetPasswordMismatch = mode === 'reset' && confirmResetPassword.length > 0 && resetPassword !== confirmResetPassword
  const usernameCandidate = mode === 'signup' ? username : mode === 'google-username' ? googleUsername : ''
  const activeUsernameAvailability = usernameAvailability.username === usernameCandidate.trim()
    ? usernameAvailability
    : !usernameCandidate.trim()
      ? { username: '', status: 'idle', message: '' }
      : !isValidUsername(usernameCandidate.trim())
        ? { username: usernameCandidate.trim(), status: 'invalid', message: 'Use 3–24 characters with at least one letter. Accents and letters from any language are supported.' }
        : { username: usernameCandidate.trim(), status: 'checking', message: 'Checking username…' }
  const resetCodeKey = `${email.trim().toLowerCase()}|${resetToken}`
  const resetCodeStatus = mode === 'reset' && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim()) && /^\d{6}$/.test(resetToken)
    ? resetCodeVerification.key === resetCodeKey ? resetCodeVerification.status : 'checking'
    : 'idle'

  useEffect(() => {
    const candidate = usernameCandidate
    if (!candidate.trim()) return undefined
    const trimmed = candidate.trim()
    if (!isValidUsername(trimmed)) {
      return undefined
    }

    const controller = new AbortController()
    const timer = window.setTimeout(() => {
      request('/api/auth/username-availability', {
        method: 'POST',
        body: JSON.stringify({ username: trimmed }),
        signal: controller.signal,
      }).then((result) => {
        if (controller.signal.aborted) return
        setUsernameAvailability({
          username: trimmed,
          status: result.available ? 'available' : 'taken',
          message: result.available ? 'Username is available.' : 'That username is already taken.',
        })
      }).catch((checkError) => {
        if (controller.signal.aborted) return
        setUsernameAvailability({
          username: trimmed,
          status: 'error',
          message: checkError.message || 'Could not check this username. The server will still verify it when you continue.',
        })
      })
    }, 250)

    return () => {
      window.clearTimeout(timer)
      controller.abort()
    }
  }, [usernameCandidate])

  useEffect(() => {
    if (mode !== 'reset' || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim()) || !/^\d{6}$/.test(resetToken)) {
      return undefined
    }
    const controller = new AbortController()
    const verificationKey = `${email.trim().toLowerCase()}|${resetToken}`
    const timer = window.setTimeout(() => {
      request('/api/auth/password-reset/verify-code', {
        method: 'POST',
        body: JSON.stringify({ email: email.trim().toLowerCase(), code: resetToken }),
        signal: controller.signal,
      }).then((result) => {
        if (controller.signal.aborted) return
        setResetCodeVerification({ key: verificationKey, status: result.valid ? 'valid' : 'invalid' })
      }).catch((verificationError) => {
        if (controller.signal.aborted) return
        setResetCodeVerification({ key: verificationKey, status: 'error' })
        setError(verificationError.message || 'Could not verify the code. Check your connection and retry.')
      })
    }, 250)
    return () => {
      window.clearTimeout(timer)
      controller.abort()
    }
  }, [mode, email, resetToken])

  useEffect(() => () => window.clearTimeout(googleTimeoutRef.current), [])

  const submitAuth = async (event) => {
    event.preventDefault()
    setLoading(true)
    setError('')
    setServerStatus(
      mode === 'login' ? 'Contacting the FUTApulse server to verify your username and password…'
        : mode === 'signup' ? 'Requesting an email verification code…'
          : mode === 'verify-email' ? 'Verifying your email address and creating your account…'
        : mode === 'google-username' ? 'Creating your FUTApulse account…'
          : mode === 'google-password' ? 'Saving your FUTApulse password…'
            : mode === 'forgot' ? 'Sending your recovery request to the FUTApulse server…'
              : 'Asking the FUTApulse server to reset your password…',
    )
    try {
      if (mode === 'login' || mode === 'signup') {
        const enteredUsername = username.trim()
        if (mode === 'signup' && !isValidNewPassword(password)) {
          throw new Error('Use more than 6 characters, at least one uppercase letter, and at least one number.')
        }
        if (mode === 'signup' && password !== confirmPassword) throw new Error('Your passwords do not match.')
        if (!isValidUsername(enteredUsername)) {
          throw new Error('Use 3–24 characters with at least one letter. Accents and letters from any language are supported.')
        }
        if (mode === 'signup' && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())) {
          throw new Error('Enter a valid email address.')
        }
        const result = await request(mode === 'signup' ? '/api/auth/signup' : '/api/auth/login', {
          method: 'POST',
          timeoutMs: mode === 'signup' ? 60000 : 30000,
          body: JSON.stringify(mode === 'signup'
            ? { email: email.trim().toLowerCase(), username: enteredUsername, password, remember }
            : { username: enteredUsername, password, remember }),
        })
        if (mode === 'signup' && result.verificationRequired) {
          setMode('verify-email')
          setServerStatus(result.message)
          return
        }
        onAuthenticated(requireSessionResponse(result), remember, 'Server confirmed your sign-in.')
      } else if (mode === 'verify-email') {
        const result = await request('/api/auth/signup/verify', {
          method: 'POST',
          body: JSON.stringify({ email: email.trim().toLowerCase(), code: resetToken.trim() }),
        })
        onAuthenticated(requireSessionResponse(result), remember, 'Email verified and account created.')
      } else if (mode === 'google-username') {
        if (!googleSignupToken) throw new Error('Restart Google sign-in to continue.')
        const enteredUsername = googleUsername.trim()
        if (!isValidUsername(enteredUsername)) {
          throw new Error('Use 3–24 characters with at least one letter. Accents and letters from any language are supported.')
        }
        if (!isValidNewPassword(googlePassword)) throw new Error('Use more than 6 characters, at least one uppercase letter, and at least one number.')
        if (googlePassword !== googleConfirmPassword) throw new Error('Your passwords do not match.')
        const result = await request('/api/auth/google', {
          method: 'POST',
          body: JSON.stringify({ onboardingToken: googleSignupToken, username: enteredUsername, password: googlePassword, remember }),
        })
        if (result.usernameRequired) throw new Error('Choose a unique username to continue.')
        onAuthenticated(requireSessionResponse(result), remember, 'Your Google account and FUTApulse password are ready.')
      } else if (mode === 'google-password') {
        if (!googlePasswordSetupToken) throw new Error('Restart Google sign-in to continue.')
        if (!isValidNewPassword(googlePassword)) throw new Error('Use more than 6 characters, at least one uppercase letter, and at least one number.')
        if (googlePassword !== googleConfirmPassword) throw new Error('Your passwords do not match.')
        const result = await request('/api/auth/google/password', {
          method: 'POST',
          body: JSON.stringify({ passwordSetupToken: googlePasswordSetupToken, password: googlePassword, remember }),
        })
        onAuthenticated(requireSessionResponse(result), remember, 'Your FUTApulse password is ready.')
      } else if (mode === 'forgot') {
        const result = await request('/api/auth/forgot-password', {
          method: 'POST',
          body: JSON.stringify({ email: email.trim().toLowerCase() }),
        })
        if (typeof result.message !== 'string' && typeof result.resetToken !== 'string') {
          throw new Error('The server did not confirm receipt of your recovery request. Please retry.')
        }
        setResetToken('')
        setResetMessage(result.message || 'If an account exists for that email, a reset code was sent to its registered email address.')
        setServerStatus('Check the account email for a six-digit reset code. The code expires in 15 minutes.')
        setMode('reset')
      } else if (mode === 'reset') {
        if (resetCodeStatus !== 'valid') throw new Error('Enter a valid reset code before choosing a new password.')
        if (!isValidNewPassword(resetPassword)) {
          throw new Error('Use more than 6 characters, at least one uppercase letter, and at least one number.')
        }
        if (resetPassword !== confirmResetPassword) throw new Error('Your new passwords do not match.')
        const result = await request('/api/auth/reset-password', {
          method: 'POST',
          body: JSON.stringify({
            email: email.trim().toLowerCase(),
            code: resetToken.trim(),
            password: resetPassword,
          }),
        })
        if (typeof result.message !== 'string') {
          throw new Error('The server did not confirm the password reset. Please retry.')
        }
        setMode('login')
        setPassword('')
        setResetMessage(result.message || 'Password reset. Sign in with your new password.')
        setServerStatus(result.message || 'The server confirmed your password was reset. You can now sign in.')
      }
    } catch (submitError) {
      setError(submitError.message || 'Unable to complete this request.')
      setServerStatus('')
    } finally {
      setLoading(false)
    }
  }

  const startGoogle = async () => {
    window.clearTimeout(googleTimeoutRef.current)
    setLoading(true)
    setError('')
    setServerStatus('Connecting securely to Google…')
    try {
      const config = await request('/api/config/google')
      if (!config.configured || !config.clientId) {
        throw new Error('Google sign-in is not configured on the FUTApulse server yet.')
      }
      const google = await loadGoogleIdentityServices()
      const codeClient = google.accounts.oauth2.initCodeClient({
        client_id: config.clientId,
        scope: 'openid email profile',
        ux_mode: 'popup',
        callback: async (googleResponse) => {
          window.clearTimeout(googleTimeoutRef.current)
          googleTimeoutRef.current = null
          if (googleResponse.error || !googleResponse.code) {
            setError(googleResponse.error_description || 'Google sign-in was cancelled or could not be completed.')
            setServerStatus('')
            setLoading(false)
            return
          }
          try {
            const result = await request('/api/auth/google', {
              method: 'POST',
              headers: { 'X-FUTApulse-OAuth-Request': '1' },
              body: JSON.stringify({ code: googleResponse.code, remember, origin: window.location.origin }),
            })
            if (result.usernameRequired) {
              if (!result.signupToken || !result.email) {
                throw new Error('Google sign-in returned incomplete account setup details. Please retry.')
              }
              setGoogleSignupToken(result.signupToken)
              setGoogleEmail(result.email)
              setGoogleUsername(suggestedUsername(result.name, result.email))
              setGooglePassword('')
              setGoogleConfirmPassword('')
              setMode('google-username')
              setServerStatus('Google verified your email. Choose a username and FUTApulse password to finish account setup.')
              return
            }
            if (result.passwordRequired) {
              if (!result.passwordSetupToken || !result.email) throw new Error('Google sign-in returned incomplete password setup details. Please retry.')
              setGooglePasswordSetupToken(result.passwordSetupToken)
              setGoogleEmail(result.email)
              setGooglePassword('')
              setGoogleConfirmPassword('')
              setMode('google-password')
              setServerStatus('Google verified your account. Create a FUTApulse password to use username and password sign-in next time.')
              return
            }
            onAuthenticated(requireSessionResponse(result), remember, 'Google sign-in was confirmed by FUTApulse.')
          } catch (googleError) {
            setError(googleError.message || 'Unable to complete Google sign-in.')
            setServerStatus('')
          } finally {
            setLoading(false)
          }
        },
        error_callback: (oauthError) => {
          window.clearTimeout(googleTimeoutRef.current)
          googleTimeoutRef.current = null
          const errorType = String(oauthError.type || '').toLowerCase()
          const message = errorType.includes('popup_closed')
            ? 'Google sign-in was closed before approval. You can try again whenever you are ready.'
            : errorType.includes('popup_failed_to_open')
              ? 'The Google sign-in window could not open. Allow pop-ups for this app, then try again.'
              : oauthError.message || 'Google sign-in could not be completed. You can try again.'
          setError(message)
          setServerStatus('')
          setLoading(false)
        },
      })
      googleTimeoutRef.current = window.setTimeout(() => {
        googleTimeoutRef.current = null
        setError('Google sign-in timed out. The sign-in window may have been closed; please try again.')
        setServerStatus('')
        setLoading(false)
      }, 120_000)
      codeClient.requestCode()
    } catch (googleError) {
      window.clearTimeout(googleTimeoutRef.current)
      googleTimeoutRef.current = null
      setError(googleError.message || 'Unable to start Google sign-in.')
      setServerStatus('')
      setLoading(false)
    }
  }

  const changeMode = (nextMode) => {
    setError('')
    setServerStatus('')
    setResetMessage('')
    setMode(nextMode)
  }

  return (
    <main className="auth-screen">
      <div className="auth-hero-shape" aria-hidden="true" />
      <section className="auth-panel" aria-labelledby="auth-title">
        <div className="auth-brand-mark">
          <h1 id="auth-title">FUTApulse</h1>
          <BrandHeart className="auth-heart" size={23} />
        </div>
        <p className="auth-tagline">The heartbeat of FUTA.</p>
        <p className="auth-welcome">
          {mode === 'signup' ? 'Create your campus account' : mode === 'login' ? 'Welcome back!' : mode === 'verify-email' ? 'Verify your email address' : 'Your campus account'}
        </p>

        {(mode === 'login' || mode === 'signup') && (
          <>
            <form className="auth-form" onSubmit={submitAuth}>
              {mode === 'signup' && (
                <label className="auth-field">
                  <span>Email</span>
                  <input type="email" autoComplete="email" placeholder="yourname@futa.edu.ng" value={email} onChange={(event) => setEmail(event.target.value)} required />
                </label>
              )}
              <label className="auth-field">
                <span>{mode === 'signup' ? 'Username / profile name' : 'Username'}</span>
                <input autoComplete="username" minLength={3} maxLength={24} placeholder={mode === 'signup' ? 'Choose your primary handle' : 'Your username'} value={username} onChange={(event) => setUsername(event.target.value)} required />
                {mode === 'signup' && activeUsernameAvailability.message && <small className={`username-availability is-${activeUsernameAvailability.status}`} role="status" aria-live="polite">{activeUsernameAvailability.message}</small>}
              </label>
              <PasswordField
                label="Password"
                autoComplete={mode === 'signup' ? 'new-password' : 'current-password'}
                minLength={mode === 'signup' ? 7 : 6}
                placeholder="Enter your password"
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                ariaInvalid={Boolean(mode === 'signup' && password && !isValidNewPassword(password))}
                ariaDescribedBy={mode === 'signup' && password ? 'signup-password-strength' : undefined}
              />
              {mode === 'signup' && <PasswordStrengthMeter password={password} minLength={7} idPrefix="signup-password" show={Boolean(password)} />}
              {mode === 'signup' ? (
                <>
                  <PasswordField
                    label="Confirm password"
                    autoComplete="new-password"
                    placeholder="Re-enter your password"
                    value={confirmPassword}
                    onChange={(event) => setConfirmPassword(event.target.value)}
                    ariaInvalid={Boolean(signupPasswordMismatch)}
                    ariaDescribedBy={signupPasswordMismatch ? 'signup-password-mismatch' : undefined}
                  />
                  {signupPasswordMismatch && <p id="signup-password-mismatch" className="mt-1 text-xs text-rose-300" role="alert">Passwords do not match.</p>}
                </>
              ) : (
                <div className="auth-form-options">
                  <label className="remember-me"><input type="checkbox" checked={remember} onChange={(event) => setRemember(event.target.checked)} /> <span>Remember me</span></label>
                  <button className="forgot-password" type="button" disabled={loading} onClick={() => { setEmail(''); changeMode('forgot') }}>Forgot password?</button>
                </div>
              )}
              <button className="auth-submit" type="submit" disabled={loading}>
                {loading ? <LoaderCircle size={18} className="animate-spin" /> : mode === 'signup' ? 'Create account' : 'Log in'}
                <span className="auth-submit-pulse" />
              </button>
              {mode === 'signup' && <label className="remember-me auth-remember-signup"><input type="checkbox" checked={remember} onChange={(event) => setRemember(event.target.checked)} /> <span>Remember me on this device</span></label>}
            </form>
            <>
              <div className="auth-divider"><span>Or</span></div>
              <button className="google-login" type="button" onClick={startGoogle} disabled={loading}>
                <strong className="google-mark">G</strong>
                {loading ? 'Connecting…' : 'Continue with Google'}
              </button>
            </>
            <p className="auth-provider-note">
              {mode === 'signup' ? 'Accents and letters from any language are supported. Use an email you can access for account recovery.' : 'Sign in with your FUTApulse username and password.'}
            </p>
            <p className="auth-signup">
              {mode === 'signup' ? 'Already have an account?' : "Don't have an account?"}{' '}
              <button type="button" disabled={loading} onClick={() => changeMode(mode === 'signup' ? 'login' : 'signup')}>
                {mode === 'signup' ? 'Log in' : 'Sign up'}
              </button>
            </p>
          </>
        )}

        {mode === 'google-username' && (
          <form className="auth-subform" onSubmit={submitAuth}>
            <p className="google-account-email">{googleEmail}</p>
            <label className="auth-field"><span>Choose your username / profile name</span><input minLength={3} maxLength={24} autoComplete="username" value={googleUsername} onChange={(event) => setGoogleUsername(event.target.value)} required />{activeUsernameAvailability.message && <small className={`username-availability is-${activeUsernameAvailability.status}`} role="status" aria-live="polite">{activeUsernameAvailability.message}</small>}</label>
            <PasswordField label="Create FUTApulse password" autoComplete="new-password" minLength={7} value={googlePassword} onChange={(event) => setGooglePassword(event.target.value)} ariaInvalid={Boolean(googlePassword && !isValidNewPassword(googlePassword))} ariaDescribedBy={googlePassword ? 'google-signup-password-strength' : undefined} />
            <PasswordStrengthMeter password={googlePassword} minLength={7} idPrefix="google-signup-password" show={Boolean(googlePassword)} />
            <PasswordField label="Confirm password" autoComplete="new-password" value={googleConfirmPassword} onChange={(event) => setGoogleConfirmPassword(event.target.value)} ariaInvalid={Boolean(googleConfirmPassword && googlePassword !== googleConfirmPassword)} />
            {googleConfirmPassword && googlePassword !== googleConfirmPassword && <p className="mt-1 text-xs text-rose-300" role="alert">Passwords do not match.</p>}
            <button className="auth-submit" type="submit" disabled={loading}>{loading ? 'Please wait…' : 'Create account'}</button>
            <button className="google-back-btn" type="button" disabled={loading} onClick={() => changeMode('login')}>Back to sign in</button>
          </form>
        )}

        {mode === 'google-password' && (
          <form className="auth-subform" onSubmit={submitAuth}>
            <p className="google-account-email">{googleEmail}</p>
            <p>Create a FUTApulse password for this verified Google account. You’ll use it with your username when signing in.</p>
            <PasswordField label="Create FUTApulse password" autoComplete="new-password" minLength={7} value={googlePassword} onChange={(event) => setGooglePassword(event.target.value)} ariaInvalid={Boolean(googlePassword && !isValidNewPassword(googlePassword))} ariaDescribedBy={googlePassword ? 'google-password-strength' : undefined} />
            <PasswordStrengthMeter password={googlePassword} minLength={7} idPrefix="google-password" show={Boolean(googlePassword)} />
            <PasswordField label="Confirm password" autoComplete="new-password" value={googleConfirmPassword} onChange={(event) => setGoogleConfirmPassword(event.target.value)} ariaInvalid={Boolean(googleConfirmPassword && googlePassword !== googleConfirmPassword)} />
            {googleConfirmPassword && googlePassword !== googleConfirmPassword && <p className="mt-1 text-xs text-rose-300" role="alert">Passwords do not match.</p>}
            <button className="auth-submit" type="submit" disabled={loading}>{loading ? 'Saving…' : 'Save password'}</button>
            <button className="google-back-btn" type="button" disabled={loading} onClick={() => changeMode('login')}>Back to sign in</button>
          </form>
        )}

        {mode === 'verify-email' && (
          <form className="auth-subform" onSubmit={submitAuth}>
            <p>Enter the six-digit code sent to <strong>{email}</strong>. Codes expire after 15 minutes.</p>
            <label className="auth-field"><span>Email verification code</span><input inputMode="numeric" autoComplete="one-time-code" pattern="[0-9]{6}" maxLength={6} value={resetToken} onChange={(event) => setResetToken(event.target.value.replace(/\D/g, '').slice(0, 6))} required /></label>
            <button className="auth-submit" type="submit" disabled={loading}>{loading ? 'Verifying…' : 'Verify email & create account'}</button>
            <button className="google-back-btn" type="button" disabled={loading} onClick={() => changeMode('signup')}>Back to account details</button>
          </form>
        )}

        {mode === 'forgot' && (
          <form className="auth-subform" onSubmit={submitAuth}>
            <p>A reset code is sent only to the email address currently registered to your account.</p>
            <label className="auth-field"><span>Registered account email</span><input type="email" autoComplete="email" value={email} onChange={(event) => setEmail(event.target.value)} required /></label>
            {resetMessage && <p>{resetMessage}</p>}
            <button className="auth-submit" type="submit" disabled={loading}>{loading ? 'Requesting…' : 'Request reset'}</button>
            <button className="google-back-btn" type="button" disabled={loading} onClick={() => changeMode('login')}>Back to sign in</button>
          </form>
        )}

        {mode === 'reset' && (
          <form className="auth-subform" onSubmit={submitAuth}>
            <p>{resetMessage || 'Enter the six-digit code sent to your registered account email.'}</p>
            <label className="auth-field"><span>Email reset code</span><input inputMode="numeric" autoComplete="one-time-code" pattern="[0-9]{6}" maxLength={6} value={resetToken} onChange={(event) => { setResetToken(event.target.value.replace(/\D/g, '').slice(0, 6)); setServerStatus(''); setError('') }} required /></label>
            {resetToken.length === 6 && <p className={`mt-1 text-sm ${resetCodeStatus === 'valid' ? 'text-emerald-300' : resetCodeStatus === 'invalid' || resetCodeStatus === 'error' ? 'text-rose-300' : 'text-slate-300'}`} role="status" aria-live="polite">{resetCodeStatus === 'checking' ? 'Checking code…' : resetCodeStatus === 'valid' ? 'Code verified. You can choose a new password.' : resetCodeStatus === 'invalid' ? 'That code is invalid or expired. Check it and try again.' : resetCodeStatus === 'error' ? 'Could not verify the code. Check your connection and retry.' : ''}</p>}
            <PasswordField
              label="New password"
              minLength={7}
              autoComplete="new-password"
              value={resetPassword}
              onChange={(event) => setResetPassword(event.target.value)}
              ariaInvalid={Boolean(resetPasswordMismatch)}
              ariaDescribedBy={resetPassword ? 'reset-password-strength' : undefined}
            />
            <PasswordStrengthMeter password={resetPassword} minLength={7} idPrefix="reset-password" show={Boolean(resetPassword)} />
            <PasswordField
              label="Confirm new password"
              minLength={7}
              autoComplete="new-password"
              value={confirmResetPassword}
              onChange={(event) => setConfirmResetPassword(event.target.value)}
              ariaInvalid={Boolean(resetPasswordMismatch)}
              ariaDescribedBy={resetPasswordMismatch ? 'reset-password-mismatch' : undefined}
            />
            {resetPasswordMismatch && <p id="reset-password-mismatch" className="mt-1 text-xs text-rose-300" role="alert">Passwords do not match.</p>}
            <button className="auth-submit" type="submit" disabled={loading || resetCodeStatus !== 'valid'}>{loading ? 'Resetting…' : 'Reset password'}</button>
            <button className="google-back-btn" type="button" disabled={loading} onClick={() => changeMode('login')}>Back to sign in</button>
          </form>
        )}

        {serverStatus && (
          <p className={`auth-server-status ${loading ? 'is-pending' : ''}`} role="status" aria-live="polite">
            {loading ? <LoaderCircle size={16} className="animate-spin" aria-hidden="true" /> : <CheckCircle2 size={16} aria-hidden="true" />}
            <span>{serverStatus}</span>
          </p>
        )}
        {error && <p className="auth-error" role="alert">{error}</p>}
      </section>
    </main>
  )
}

export default AuthScreen
