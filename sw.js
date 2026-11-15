/* Quorum offline support: pages load from the network when there is one and from the saved copy when there is not. */
const CACHE = 'quorum-v13';
const CORE = ["./", "index.html", "app.html", "proof.html", "css/site.css", "js/analysis.js", "js/proof.js", "manifest.webmanifest", "data/validation.json", "js/formats.js", "img/icon-192.png", "img/icon-512.png", "fonts/IBMPlexSans-latin.woff2", "fonts/IBMPlexSans-latin-ext.woff2", "img/body.jpg", "img/labs.jpg", "img/today-phone.jpg", "img/today.jpg", "img/decide.jpg", "data/LSDS-8_Comprehensive_Metabolic_Panel_CMP_TRANSFORMED.csv", "data/LSDS-7_Complete_Blood_Count_CBC_TRANSFORMED.csv"];
self.addEventListener('install', e => { e.waitUntil(caches.open(CACHE).then(c => c.addAll(CORE)).then(() => self.skipWaiting())); });
self.addEventListener('activate', e => { e.waitUntil(caches.keys().then(ks => Promise.all(ks.filter(k => k !== CACHE).map(k => caches.delete(k)))).then(() => self.clients.claim())); });
self.addEventListener('fetch', e => {
  const r = e.request, u = new URL(r.url);
  if (r.method !== 'GET' || u.origin !== location.origin) return;
  e.respondWith(fetch(r).then(res => { if (res && res.ok) { const copy = res.clone(); caches.open(CACHE).then(c => c.put(r, copy)); } return res; })
    .catch(() => caches.match(r, { ignoreSearch: true }).then(m => m || (r.mode === 'navigate' ? caches.match('app.html') : Response.error()))));
});
