/* Notifications only: deliberately no fetch/cache interception of editor files. */
"use strict";
self.addEventListener("install", (event) => event.waitUntil(self.skipWaiting()));
self.addEventListener("activate", (event) => event.waitUntil(self.clients.claim()));
self.addEventListener("message", (event) => {
  if (!event.data || event.data.type !== "vclyps:notify" || !event.source) return;
  event.waitUntil((async () => {
    try {
      const options = event.data.options;
      options.data = { clientId: event.source.id };
      options.tag += "-" + event.source.id;
      await self.registration.showNotification(event.data.title, options);
      if (event.ports[0]) event.ports[0].postMessage(true);
    } catch (_) { if (event.ports[0]) event.ports[0].postMessage(false); }
  })());
});
self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  event.waitUntil((async () => {
    const target = new URL("index.html", self.registration.scope);
    const windows = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
    const clientId = event.notification.data && event.notification.data.clientId;
    const client = windows.find((item) => item.id === clientId) || windows.find((item) => {
      const url = new URL(item.url);
      return url.origin === target.origin && (url.pathname === target.pathname || url.pathname === new URL("./", target).pathname);
    });
    if (client) {
      await client.focus();
      client.postMessage({ type: "vclyps:open-result" });
    } else {
      target.searchParams.set("result", "ready");
      await self.clients.openWindow(target.href);
    }
  })());
});
