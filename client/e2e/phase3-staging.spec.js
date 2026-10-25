import { createInterface } from 'node:readline'
import process from 'node:process'
import { devices, expect, test } from '@playwright/test'

const PRODUCTION_HOSTS = new Set([
  'fut-apulse.vercel.app',
  'futapulse.onrender.com',
])

function getRunConfig() {
  const rawUrl = process.env.PHASE3_STAGING_URL?.trim()
  if (!rawUrl) throw new Error('Set PHASE3_STAGING_URL to the isolated staging frontend origin.')

  let stagingUrl
  try {
    stagingUrl = new URL(rawUrl)
  } catch {
    throw new Error('PHASE3_STAGING_URL must be a valid absolute URL.')
  }
  if (!['http:', 'https:'].includes(stagingUrl.protocol) || stagingUrl.pathname !== '/' || stagingUrl.search || stagingUrl.hash) {
    throw new Error('PHASE3_STAGING_URL must contain only the staging origin (no path, query, or fragment).')
  }
  if (stagingUrl.protocol !== 'https:' && !['localhost', '127.0.0.1'].includes(stagingUrl.hostname)) {
    throw new Error('Use HTTPS for a remotely hosted staging frontend.')
  }
  if (PRODUCTION_HOSTS.has(stagingUrl.hostname.toLowerCase())) {
    throw new Error('Refusing to run the Phase 3 write-flow against a known FUTApulse production host.')
  }
  const allowedHosts = (process.env.PHASE3_STAGING_ALLOWED_HOSTS || '')
    .split(',')
    .map((host) => host.trim().toLowerCase())
    .filter(Boolean)
  if (!allowedHosts.length) {
    throw new Error('Set PHASE3_STAGING_ALLOWED_HOSTS to the exact staging hostname(s) permitted for this write-flow.')
  }
  if (!allowedHosts.includes(stagingUrl.hostname.toLowerCase())) {
    throw new Error('PHASE3_STAGING_URL hostname is not listed in PHASE3_STAGING_ALLOWED_HOSTS.')
  }
  if (process.env.PHASE3_STAGING_DATABASE_ISOLATED !== 'true'
      || process.env.PHASE3_STAGING_CONFIRMATION !== 'I_CONFIRM_THIS_IS_ISOLATED_STAGING') {
    throw new Error('Confirm that the frontend and MongoDB are isolated from production before running this write-flow.')
  }

  const email = process.env.PHASE3_TEST_EMAIL?.trim()
  if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    throw new Error('Set PHASE3_TEST_EMAIL to a dedicated mailbox that can receive the signup code.')
  }
  const password = process.env.PHASE3_TEST_PASSWORD || ''
  if (password.length <= 6 || !/[A-Z]/.test(password) || !/\d/.test(password)) {
    throw new Error('Set PHASE3_TEST_PASSWORD to a throwaway QA password that meets FUTApulse signup rules.')
  }

  return { stagingUrl, email, password }
}

function nextEventDateEntry() {
  const parts = new Intl.DateTimeFormat('en', {
    timeZone: 'Africa/Lagos',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(new Date())
  const values = Object.fromEntries(parts.map(({ type, value }) => [type, value]))
  const date = new Date(Date.UTC(Number(values.year), Number(values.month) - 1, Number(values.day) + 2))
  const day = String(date.getUTCDate()).padStart(2, '0')
  const month = String(date.getUTCMonth() + 1).padStart(2, '0')
  return `${day}${month}${date.getUTCFullYear()}`
}

async function enterVerificationCode() {
  const providedCode = process.env.PHASE3_VERIFICATION_CODE?.trim()
  if (providedCode) {
    if (!/^\d{6}$/.test(providedCode)) throw new Error('PHASE3_VERIFICATION_CODE must contain exactly six digits.')
    return providedCode
  }
  if (!process.stdin.isTTY) {
    throw new Error('Run this command in an interactive terminal to enter the emailed code, or set PHASE3_VERIFICATION_CODE for this run.')
  }

  const prompt = createInterface({ input: process.stdin, output: process.stdout })
  try {
    const code = (await prompt.question('Enter the six-digit staging signup code: ')).trim()
    if (!/^\d{6}$/.test(code)) throw new Error('The verification code must contain exactly six digits.')
    return code
  } finally {
    prompt.close()
  }
}

async function setEventTime(page, label, hour, minute) {
  await page.getByRole('button', { name: new RegExp(`^${label}:`) }).click()
  const dialog = page.getByRole('dialog', { name: label })
  await dialog.getByRole('option', { name: hour, exact: true }).click()
  await dialog.getByRole('option', { name: minute, exact: true }).click()
  await dialog.getByRole('button', { name: 'Done' }).click()
  await expect(page.getByRole('button', { name: new RegExp(`^${label}: ${hour}:${minute}`) })).toBeVisible()
}

async function browseToEvent(page, title) {
  await page.getByRole('navigation', { name: 'Primary navigation' })
    .getByRole('button', { name: 'Explore', exact: true })
    .click()
  const search = page.getByRole('searchbox', { name: 'Search events by event title or organizer' })
  await search.fill(title)
  const preview = page.getByRole('button', { name: `Event preview for ${title}` })
  await expect(preview).toBeVisible()
  await preview.click()
}

function collectPageFailures(page, failures) {
  page.on('pageerror', (error) => failures.push(`Browser exception: ${error.message}`))
  page.on('response', (response) => {
    const responseUrl = new URL(response.url())
    if (responseUrl.pathname.startsWith('/api/') && response.status() >= 500) {
      failures.push(`API request failed with HTTP ${response.status()} (${responseUrl.pathname}).`)
    }
  })
}

test('mobile signup, sign-in, publishing, browsing, and cross-device interaction work on isolated staging', async ({ browser, request }) => {
  test.setTimeout(12 * 60 * 1000)
  const { stagingUrl, email, password } = getRunConfig()
  const readinessResponse = await request.get(new URL('/api/ready', stagingUrl).toString(), { timeout: 30_000 })
  expect(readinessResponse.ok(), 'The staging API /api/ready endpoint must respond successfully.').toBeTruthy()
  const readiness = await readinessResponse.json()
  expect(readiness.ready, 'The staging API must report ready.').toBe(true)
  expect(readiness.database, 'Staging must use MongoDB, not the local fallback.').toBe('mongodb')

  const failures = []
  let sessionToken = ''
  let signupStarted = false
  let firstContext
  let secondContext
  let primaryError
  let cleanupError

  const captureSession = (page) => {
    page.on('response', (response) => {
      const pathname = new URL(response.url()).pathname
      if (!response.ok() || !/^\/api\/auth\/(signup\/verify|login|session)$/.test(pathname)) return
      void response.json().then((result) => {
        if (typeof result.token === 'string' && result.token) sessionToken = result.token
      }).catch(() => failures.push(`Authenticated endpoint returned unreadable JSON (${pathname}).`))
    })
  }

  try {
    const phone = {
      ...devices['Pixel 7'],
      viewport: { width: 390, height: 844 },
      locale: 'en-NG',
      timezoneId: 'Africa/Lagos',
    }
    firstContext = await browser.newContext(phone)
    const firstPage = await firstContext.newPage()
    collectPageFailures(firstPage, failures)
    captureSession(firstPage)
    const signupUrl = new URL(stagingUrl)
    signupUrl.searchParams.set('auth', 'signup')
    await firstPage.goto(signupUrl.toString(), { waitUntil: 'domcontentloaded' })

    await firstPage.getByLabel('Email').waitFor({ state: 'visible' })
    await expect(firstPage.getByRole('region', { name: 'FUTApulse launch sponsor' })).toHaveCount(0)
    const username = `phase3${Date.now().toString(36)}`
    const signupRememberMe = firstPage.getByLabel('Remember me on this device')
    await expect(signupRememberMe).toBeChecked()
    await firstPage.getByLabel('Email').fill(email)
    await firstPage.getByLabel('Username / profile name').fill(username)
    await firstPage.getByLabel('Password', { exact: true }).fill(password)
    await firstPage.getByLabel('Confirm password', { exact: true }).fill(password)
    signupStarted = true
    await firstPage.getByRole('button', { name: 'Create account', exact: true }).click()
    const codeInput = firstPage.getByLabel('Email verification code')
    await codeInput.waitFor({ state: 'visible' })
    const verificationCode = await enterVerificationCode()
    await codeInput.fill(verificationCode)
    await firstPage.getByRole('button', { name: 'Verify email & create account' }).click()

    const profileDialog = firstPage.getByRole('dialog', { name: 'Tell FUTApulse about you' })
    await profileDialog.waitFor({ state: 'visible' })
    await profileDialog.locator('#profile-username').fill(username)
    await profileDialog.locator('#profile-faculty').selectOption('SEET')
    await profileDialog.locator('#profile-department').selectOption('MEE')
    await profileDialog.locator('#profile-level').selectOption('300')
    await profileDialog.getByRole('button', { name: 'Complete profile' }).click()
    await firstPage.getByRole('navigation', { name: 'Primary navigation' }).waitFor({ state: 'visible' })

    const guidelinesContinue = firstPage.getByRole('button', { name: 'I understand — continue' })
    if (await guidelinesContinue.count()) await guidelinesContinue.click()
    await expect.poll(() => sessionToken, { message: 'Signup verification must return a deletable staging session.' }).not.toBe('')
    await expect.poll(() => firstPage.evaluate(() => localStorage.getItem('futapulse-remember-me'))).toBe('true')

    await firstPage.getByRole('navigation', { name: 'Primary navigation' })
      .getByRole('button', { name: 'Profile', exact: true })
      .click()
    await firstPage.getByRole('button', { name: '＋ Create Event' }).click()

    const title = `Phase 3 mobile QA ${Date.now().toString(36)}`
    const dateEntry = nextEventDateEntry()
    await firstPage.locator('#event-title').fill(title)
    await firstPage.locator('#event-category').selectOption('academic')
    await firstPage.locator('#event-activity').fill('A temporary staging-only event for the Phase 3 mobile workflow check.')

    const startDate = firstPage.locator('#event-date')
    const endDate = firstPage.locator('#event-end-date')
    await expect(startDate).toHaveAttribute('inputmode', 'numeric')
    await expect(endDate).toHaveAttribute('inputmode', 'numeric')
    await startDate.fill('')
    await endDate.fill('')
    await startDate.pressSequentially(dateEntry)
    await endDate.pressSequentially(dateEntry)
    await expect(startDate).toHaveValue(`${dateEntry.slice(0, 2)}/${dateEntry.slice(2, 4)}/${dateEntry.slice(4)}`)

    await setEventTime(firstPage, 'Start time', '23', '00')
    await setEventTime(firstPage, 'End time', '23', '30')
    await firstPage.locator('#event-venue').fill('Phase 3 staging test venue')
    await firstPage.getByRole('checkbox', { name: 'All levels' }).check()
    await firstPage.getByRole('button', { name: 'Publish event' }).click()
    await expect(firstPage.locator('.profile-event-item').filter({ hasText: title })).toBeVisible()
    await expect(firstPage.locator('.app-frame')).toBeVisible()

    const firstViewportFits = await firstPage.evaluate(() => (
      document.documentElement.scrollWidth <= window.innerWidth + 1
    ))
    expect(firstViewportFits, 'The phone viewport should not overflow horizontally after publishing.').toBe(true)

    await firstPage.reload({ waitUntil: 'domcontentloaded' })
    await firstPage.getByRole('navigation', { name: 'Primary navigation' }).waitFor({ state: 'visible' })
    await browseToEvent(firstPage, title)
    await expect(firstPage.getByRole('button', { name: `Mark that you are coming to ${title}` })).toBeVisible()

    secondContext = await browser.newContext(phone)
    const secondPage = await secondContext.newPage()
    collectPageFailures(secondPage, failures)
    captureSession(secondPage)
    await secondPage.goto(stagingUrl.toString(), { waitUntil: 'domcontentloaded' })
    await secondPage.getByLabel('Email').waitFor({ state: 'visible' })
    await secondPage.getByRole('button', { name: 'Log in', exact: true }).click()
    const loginRememberMe = secondPage.getByLabel('Remember me', { exact: true })
    await expect(loginRememberMe).toBeChecked()
    await secondPage.getByLabel('Username', { exact: true }).fill(username)
    await secondPage.getByLabel('Password', { exact: true }).fill(password)
    await secondPage.getByRole('button', { name: 'Log in', exact: true }).click()
    await secondPage.getByRole('navigation', { name: 'Primary navigation' }).waitFor({ state: 'visible' })
    await expect.poll(() => sessionToken, { message: 'The second device must receive a staging session.' }).not.toBe('')
    await browseToEvent(secondPage, title)
    await secondPage.getByRole('button', { name: `Mark that you are coming to ${title}` }).click()
    await expect(secondPage.getByRole('button', { name: `You are coming to ${title}; click to undo` })).toBeVisible()

    await firstPage.reload({ waitUntil: 'domcontentloaded' })
    await firstPage.getByRole('navigation', { name: 'Primary navigation' }).waitFor({ state: 'visible' })
    await browseToEvent(firstPage, title)
    await expect(firstPage.getByRole('button', { name: `You are coming to ${title}; click to undo` })).toBeVisible()

    expect(failures, 'No uncaught browser exceptions or 5xx API responses should occur.').toEqual([])
  } catch (error) {
    primaryError = error
  } finally {
    if (sessionToken) {
      try {
        const response = await request.delete(new URL('/api/auth/account', stagingUrl).toString(), {
          headers: { Authorization: `Bearer ${sessionToken}` },
          data: { password, confirmation: 'DELETE' },
          timeout: 30_000,
        })
        if (!response.ok()) cleanupError = new Error(`Staging cleanup failed with HTTP ${response.status()}; delete the temporary QA account and its event manually.`)
      } catch {
        cleanupError = new Error('Staging cleanup could not reach the API; delete the temporary QA account and its event manually.')
      }
    } else if (signupStarted) {
      console.warn('No authenticated test session was obtained; any unverified signup challenge expires after 15 minutes.')
    }
    await secondContext?.close()
    await firstContext?.close()
  }

  if (primaryError) throw primaryError
  if (cleanupError) throw cleanupError
})
