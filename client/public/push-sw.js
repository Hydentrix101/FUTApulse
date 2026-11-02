const NOTIFICATION_DEDUPE_CACHE = 'futapulse-push-notification-ids-v1'

function notificationLedgerRequest(notificationId) {
  return new Request(new URL(`/__futapulse_notifications/${encodeURIComponent(notificationId)}`, self.location.origin))
}

async function hasDisplayedNotification(notificationId) {
  if (!notificationId) return false
  try {
    const cache = await caches.open(NOTIFICATION_DEDUPE_CACHE)
    const now = Date.now()
    for (const request of await cache.keys()) {
      const cachedResponse = await cache.match(request)
      const { recordedAt } = await cachedResponse.json()
      if (now - recordedAt > 30 * 24 * 60 * 60 * 1000) await cache.delete(request)
    }
    const response = await cache.match(notificationLedgerRequest(notificationId))
    if (!response) return false
    return true
  } catch (error) {
    console.warn('Push notification deduplication lookup failed.', error)
  }
  return false
}

async function recordDisplayedNotification(notificationId) {
  if (!notificationId) return
  try {
    const cache = await caches.open(NOTIFICATION_DEDUPE_CACHE)
    await cache.put(notificationLedgerRequest(notificationId), new Response(JSON.stringify({ recordedAt: Date.now() }), {
      headers: { 'Content-Type': 'application/json' },
    }))
  } catch (error) {
    console.warn('Push notification deduplication state could not be saved.', error)
  }
}

self.addEventListener('push', (event) => {
  let payload = {}
  try {
    payload = event.data?.json() || {}
  } catch {
    payload = { message: event.data?.text() || 'There is a new FUTApulse event update.' }
  }

  event.waitUntil((async () => {
    const notificationId = String(payload.notificationId || '')
    if (notificationId && await hasDisplayedNotification(notificationId)) return
    const clients = await self.clients.matchAll({ type: 'window', includeUncontrolled: true })
    for (const client of clients.filter((item) => item.visibilityState === 'visible')) {
      const accepted = await new Promise((resolve) => {
        const channel = new MessageChannel()
        const timeout = setTimeout(() => {
          channel.port1.close()
          resolve(false)
        }, 800)
        channel.port1.onmessage = (messageEvent) => {
          clearTimeout(timeout)
          channel.port1.close()
          resolve(messageEvent.data?.accepted === true)
        }
        try {
          client.postMessage({ type: 'FUTAPULSE_NOTIFICATION_CHECK', payload }, [channel.port2])
        } catch {
          clearTimeout(timeout)
          channel.port1.close()
          resolve(false)
        }
      })
      if (accepted) {
        await recordDisplayedNotification(notificationId)
        return
      }
    }
    await self.registration.showNotification(payload.title || 'FUTApulse event update', {
      body: payload.message || 'Tap to view the latest campus event update.',
      tag: notificationId || undefined,
      data: { url: payload.url || '/' },
      icon: '/icon-192.png',
      badge: '/favicon-32x32.png',
      renotify: false,
    })
    await recordDisplayedNotification(notificationId)
  })())
})

self.addEventListener('notificationclick', (event) => {
  event.notification.close()
  const requestedUrl = new URL(event.notification.data?.url || '/', self.location.origin)
  const destination = requestedUrl.origin === self.location.origin
    ? requestedUrl.href
    : new URL('/', self.location.origin).href
  event.waitUntil((async () => {
    const clients = await self.clients.matchAll({ type: 'window', includeUncontrolled: true })
    const appClient = clients[0]
    if (appClient) {
      await appClient.navigate(destination)
      await appClient.focus()
      return
    }
    await self.clients.openWindow(destination)
  })())
})
