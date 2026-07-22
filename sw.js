const CACHE = "fajt-hours-v6";
const ASSETS = ["./", "./index.html", "./styles.css?v=4", "./app.js?v=11", "./calculations.js?v=11", "./sync.js?v=11", "./config.js?v=11", "./manifest.webmanifest"];
self.addEventListener("install", event => event.waitUntil(caches.open(CACHE).then(cache => cache.addAll(ASSETS))));
self.addEventListener("activate", event => event.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(key => key !== CACHE).map(key => caches.delete(key))))));
self.addEventListener("fetch", event => {
  // Never intercept Supabase traffic — sync must always go to the network.
  if (!event.request.url.startsWith(self.location.origin)) return;
  event.respondWith(fetch(event.request).catch(() => caches.match(event.request)));
});
