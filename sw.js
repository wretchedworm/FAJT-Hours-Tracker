const CACHE = "fajt-hours-v3";
const ASSETS = ["./", "./index.html", "./styles.css?v=3", "./app.js?v=8", "./calculations.js?v=8", "./sync.js?v=8", "./config.js?v=8", "./manifest.webmanifest"];
self.addEventListener("install", event => event.waitUntil(caches.open(CACHE).then(cache => cache.addAll(ASSETS))));
self.addEventListener("activate", event => event.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(key => key !== CACHE).map(key => caches.delete(key))))));
self.addEventListener("fetch", event => {
  // Never intercept Supabase traffic — sync must always go to the network.
  if (!event.request.url.startsWith(self.location.origin)) return;
  event.respondWith(fetch(event.request).catch(() => caches.match(event.request)));
});
