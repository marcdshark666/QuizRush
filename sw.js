/* Quiz Rush — servicearbetare (2026-09-16)
 *
 * Spelet är en enda HTML-fil plus sju modeller. Utan det här måste allt hämtas
 * på nytt varje gång, och på tunnelbanan startar det inte alls. Strategin:
 *
 *   - sidan och koden:  network-first  (en ny version ska synas direkt, men
 *                       cachen räddar starten när nätet är borta)
 *   - modeller/teckensnitt: cache-first (de ändras aldrig, bara nya filnamn)
 *   - /api/generate:    aldrig cache    (AI-svar ska vara färska, och en cachead
 *                       POST vore fel frågor till fel material)
 *
 * Höj CACHE när något av det som ligger i SKAL byts ut — gamla cachar städas
 * bort vid activate.
 */
const CACHE = 'quizrush-v2';
const SKAL = [
  './',
  './index.html',
  './js-gltfloader.js',
  './manifest.webmanifest',
];

self.addEventListener('install', (e) => {
  // Ett fel på en enskild fil får inte spräcka hela installationen.
  e.waitUntil(caches.open(CACHE).then((c) => Promise.allSettled(SKAL.map((u) => c.add(u)))).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys()
    .then((n) => Promise.all(n.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
    .then(() => self.clients.claim()));
});

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;                       // POST till /api går alltid ut på nätet
  const url = new URL(req.url);
  if (/(^|\/)api\//.test(url.pathname)) return;           // AI-frågor cachas aldrig (även under /QuizRush/)
  if (url.origin !== location.origin && !/fonts\.(googleapis|gstatic)|cdnjs\.cloudflare/.test(url.host)) return;

  const statisk = /\.(glb|woff2?|png|jpg|svg|webmanifest)$/i.test(url.pathname) || url.host !== location.host;
  if (statisk) {
    // Cache-first: filerna är oföränderliga, och en modell på 1 MB ska hämtas en gång.
    e.respondWith(caches.match(req).then((träff) => träff || fetch(req).then((r) => {
      if (r && r.ok) { const kopia = r.clone(); caches.open(CACHE).then((c) => c.put(req, kopia)); }
      return r;
    })));
    return;
  }
  // Network-first för sidan och koden: en ny version ska slå igenom direkt.
  e.respondWith(fetch(req).then((r) => {
    if (r && r.ok) { const kopia = r.clone(); caches.open(CACHE).then((c) => c.put(req, kopia)); }
    return r;
  }).catch(() => caches.match(req).then((träff) => träff || caches.match('./index.html'))));
});
