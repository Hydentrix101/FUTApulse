self.addEventListener('push', (event) => {
  let payload = {}
  try {
    payload = event.data?.json() || {}
  } catch {
    payload = { message: event.data?.text() || 'There is a new FUTApulse event update.' }
  }

  event.waitUntil((async () => {
    const clients = await self.clients.matchAll({ type: 'window', includeUncontrolled: true })
    const visibleClient = clients.find((client) => client.visibilityState === 'visible')
    if (visibleClient) {
      visibleClient.postMessage({ type: 'FUTAPULSE_NOTIFICATION', payload })
      return
    }
    await self.registration.showNotification(payload.title || 'FUTApulse event update', {
      body: payload.message || 'Tap to view the latest campus event update.',
      tag: payload.notificationId || undefined,
      data: { url: payload.url || '/' },
      icon: '/icon-192.png',
      badge: '/favicon-32x32.png',
      renotify: false,
    })
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
