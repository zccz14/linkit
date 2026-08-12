self.addEventListener("install", () => self.skipWaiting())
self.addEventListener("activate", (event) => event.waitUntil(self.clients.claim()))
self.addEventListener("push", (event) => {
  const payload = event.data?.json() ?? { title: "Linkit", body: "You have a new message." }
  event.waitUntil(self.registration.showNotification(payload.title, { body: payload.body, data: payload.data }))
})
self.addEventListener("notificationclick", (event) => {
  event.notification.close()
  event.waitUntil(self.clients.openWindow(event.notification.data?.url ?? "/"))
})
