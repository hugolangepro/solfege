// Le réseau d'abord, en revalidant chaque fichier : une mise à jour arrive dès l'ouverture suivante. Le cache sert hors ligne.
const CACHE = 'solfege-v11';
const CORE = ['./', 'index.html', 'app.js', 'engine.js', 'pitch.js', 'chant.js', 'portee.js', 'piano.js', 'noms.js', 'glyphs.js', 'worklet-2.js', 'model.json', 'noms.json', 'manifest.webmanifest', 'icons/icon-192.png', 'icons/apple-touch-icon.png',
  ...[45, 48, 51, 54, 57, 60, 63, 66, 69, 72, 75, 78, 81, 84].map((n) => `piano/${n}.mp3`)];
self.addEventListener('install', (e) => { e.waitUntil(caches.open(CACHE).then((c) => c.addAll(CORE)).then(() => self.skipWaiting())); });
self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys().then((ks) => Promise.all(ks.filter((k) => k !== CACHE).map((k) => caches.delete(k)))).then(() => self.clients.claim()));
});
self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET' || new URL(req.url).origin !== location.origin) return;
  e.respondWith(
    fetch(req, { cache: 'no-cache' }).then((res) => {
      if (res.ok) { const copy = res.clone(); caches.open(CACHE).then((c) => c.put(req, copy)); }
      return res;
    }).catch(() => caches.match(req, { ignoreSearch: true }).then((hit) => hit || caches.match('index.html')))
  );
});
